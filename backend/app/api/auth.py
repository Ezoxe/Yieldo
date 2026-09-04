from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.categorization.seed import seed_categories, seed_rules
from app.config import settings
from app.db import get_db
from app.models import User
from app.schemas.auth import LoginIn, PasswordChangeIn, ProfileIn, RegisterIn, TokenOut, UserOut
from app.security.deps import get_current_user, get_session_user
from app.security.passwords import hash_password, verify_password
from app.security.tokens import TokenError, create_access_token, create_refresh_token, decode_token

router = APIRouter(prefix="/auth", tags=["auth"])

REFRESH_COOKIE = "yieldo_refresh"


def _invalid_credentials() -> HTTPException:
    """A fresh exception per call -- a shared instance would have its __cause__
    rewritten by concurrent requests."""
    return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                         detail="Identifiants invalides")


# Hashed once at import. Verifying against this costs the same as verifying against
# a real hash, so an unknown email and a wrong password take the same work. Hashing
# per request instead would cost an EXTRA Argon2 operation on the unknown-email path
# and hand an attacker a timing oracle for enumerating accounts.
_DUMMY_HASH = hash_password("timing-equalizer")


def _set_refresh_cookie(response: Response, user_id: int) -> None:
    response.set_cookie(
        REFRESH_COOKIE,
        create_refresh_token(user_id),
        httponly=True,
        samesite="strict",
        secure=False,  # self-hosted deployments often run behind plain HTTP on a LAN
        max_age=settings.refresh_token_days * 86400,
        path="/api/auth",
    )


@router.post("/register", response_model=TokenOut, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterIn, response: Response, db: Session = Depends(get_db)) -> TokenOut:
    # BEGIN IMMEDIATE takes SQLite's write lock before the count, so two concurrent
    # registrations cannot both observe an empty table and both become admin. Every
    # exit from this block must release that lock explicitly: a request that fails
    # after this point (duplicate email, registration closed) would otherwise leave
    # the transaction open, and the next request on this connection would hit
    # "cannot start a transaction within a transaction".
    db.execute(text("BEGIN IMMEDIATE"))
    try:
        is_first_user = db.query(User).count() == 0
        if not is_first_user and not settings.registration_open:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                                detail="Les inscriptions sont fermées")

        email = payload.email.strip().lower()
        if db.query(User).filter(User.email == email).first() is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                                detail="Un compte avec cet email existe déjà")

        user = User(
            email=email,
            name=payload.name.strip(),
            password_hash=hash_password(payload.password),
            role="admin" if is_first_user else "user",
        )
        db.add(user)
        db.commit()
    except Exception:
        db.rollback()
        raise

    db.refresh(user)
    categories = seed_categories(db, user.id)
    seed_rules(db, user.id, categories)

    _set_refresh_cookie(response, user.id)
    return TokenOut(access_token=create_access_token(user.id), user=UserOut.model_validate(user))


@router.post("/login", response_model=TokenOut)
def login(payload: LoginIn, response: Response, db: Session = Depends(get_db)) -> TokenOut:
    user = db.query(User).filter(User.email == payload.email.strip().lower()).first()
    # Exactly one Argon2 verification on every path, against a precomputed dummy
    # when the account does not exist, so the two failures are indistinguishable
    # from the outside.
    stored_hash = user.password_hash if user else _DUMMY_HASH
    password_ok = verify_password(payload.password, stored_hash)
    if user is None or not user.is_active or not password_ok:
        raise _invalid_credentials()

    _set_refresh_cookie(response, user.id)
    return TokenOut(access_token=create_access_token(user.id), user=UserOut.model_validate(user))


@router.post("/refresh", response_model=TokenOut)
def refresh(request: Request, response: Response, db: Session = Depends(get_db)) -> TokenOut:
    token = request.cookies.get(REFRESH_COOKIE)
    if not token:
        raise _invalid_credentials()
    try:
        user_id = decode_token(token, expected_type="refresh")
    except TokenError as exc:
        raise _invalid_credentials() from exc
    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise _invalid_credentials()

    _set_refresh_cookie(response, user.id)
    return TokenOut(access_token=create_access_token(user.id), user=UserOut.model_validate(user))


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(response: Response) -> None:
    response.delete_cookie(REFRESH_COOKIE, path="/api/auth")


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)) -> UserOut:
    return UserOut.model_validate(user)


@router.patch("/me", response_model=UserOut)
def update_profile(
    payload: ProfileIn,
    # A session, never an agent key: an agent that could move the email could
    # move the account to an address its owner cannot sign in to.
    user: User = Depends(get_session_user),
    db: Session = Depends(get_db),
) -> UserOut:
    """Change the name and/or the email on the authenticated account.

    The email is normalised exactly as registration normalises it (stripped,
    lower-cased), because it is the key a login is looked up by — an account
    saved as "Nouveau@Example.com" here could never be signed into again.

    The uniqueness check excludes the caller's own row: re-submitting an
    unchanged form is not a conflict with oneself, and reporting one would make
    the screen unusable.
    """
    if payload.name is not None:
        user.name = payload.name

    if payload.email is not None:
        email = payload.email.strip().lower()
        taken = (
            db.query(User)
            .filter(User.email == email, User.id != user.id)
            .first()
        )
        if taken is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                                detail="Un compte avec cet email existe déjà")
        user.email = email

    db.commit()
    db.refresh(user)
    return UserOut.model_validate(user)


@router.post("/password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(
    payload: PasswordChangeIn,
    # A session, never an agent key. See `get_session_user`.
    user: User = Depends(get_session_user),
    db: Session = Depends(get_db),
) -> None:
    """Replace the account's password.

    403, not 401: the caller IS authenticated — what they got wrong is the
    current password, and a 401 here would send the front end's own
    retry-then-log-out machinery (api.ts) after a refresh it does not need,
    ending in the user being signed out for a typo.

    The refresh cookie is deliberately left alone. Every session this account
    has open keeps working, because the alternative — signing the operator out
    of the tab they just changed their password in — is what makes people stop
    changing their password. Tokens carry no jti, so revoking OTHER sessions
    specifically is not something this design can offer, and pretending
    otherwise would be worse than saying nothing.
    """
    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="Le mot de passe actuel est incorrect")

    if verify_password(payload.new_password, user.password_hash):
        # The bare literal, like every other 422 in app/api: Starlette has
        # deprecated HTTP_422_UNPROCESSABLE_ENTITY and renamed it, and this
        # file is not the place to pick a side.
        raise HTTPException(status_code=422,
                            detail="Le nouveau mot de passe doit être différent de l'actuel")

    user.password_hash = hash_password(payload.new_password)
    db.commit()
