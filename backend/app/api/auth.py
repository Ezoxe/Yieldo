from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.categorization.seed import seed_categories, seed_rules
from app.config import settings
from app.db import get_db
from app.models import AgentKey, User
from app.schemas.auth import LoginIn, PasswordChangeIn, ProfileIn, RegisterIn, TokenOut, UserOut
from app.security import throttle
from app.security.deps import get_current_user, get_session_user
from app.security.passwords import hash_password, verify_password
from app.security.tokens import TokenError, create_access_token, create_refresh_token, decode_claims

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


def _set_refresh_cookie(response: Response, user: User) -> None:
    response.set_cookie(
        REFRESH_COOKIE,
        create_refresh_token(user.id, user.session_version),
        httponly=True,
        samesite="strict",
        secure=False,  # self-hosted deployments often run behind plain HTTP on a LAN
        max_age=settings.refresh_token_days * 86400,
        path="/api/auth",
    )


def _issue_session(response: Response, user: User) -> TokenOut:
    """A fresh access token and refresh cookie, under the user's current version."""
    _set_refresh_cookie(response, user)
    return TokenOut(
        access_token=create_access_token(user.id, user.session_version),
        user=UserOut.model_validate(user),
    )


def _end_other_sessions(db: Session, user: User) -> None:
    """Every token issued before now stops working, and so does the agent key.

    The key goes too: whoever changes their password because they fear someone
    else holds it must not leave a second way in open for 24 hours. The next
    visit to Réglages issues a new key, as it does after any expiry.
    """
    user.session_version += 1
    db.query(AgentKey).filter(AgentKey.user_id == user.id).delete()
    db.commit()
    db.refresh(user)


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

    return _issue_session(response, user)


@router.post("/login", response_model=TokenOut)
def login(
    payload: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)
) -> TokenOut:
    email = payload.email.strip().lower()
    # The address as uvicorn resolved it: behind a reverse proxy it is the
    # client's own only when the proxy is trusted (FORWARDED_ALLOW_IPS).
    address = request.client.host if request.client is not None else "inconnue"
    wait = throttle.login_throttle.retry_after(address, email)
    if wait is not None:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=throttle.wait_message(wait),
            headers={"Retry-After": str(wait)},
        )

    user = db.query(User).filter(User.email == email).first()
    # Exactly one Argon2 verification on every path, against a precomputed dummy
    # when the account does not exist, so the two failures are indistinguishable
    # from the outside.
    stored_hash = user.password_hash if user else _DUMMY_HASH
    password_ok = verify_password(payload.password, stored_hash)
    if user is None or not user.is_active or not password_ok:
        throttle.login_throttle.record_failure(address, email)
        raise _invalid_credentials()

    throttle.login_throttle.record_success(address, email)
    return _issue_session(response, user)


@router.post("/refresh", response_model=TokenOut)
def refresh(request: Request, response: Response, db: Session = Depends(get_db)) -> TokenOut:
    token = request.cookies.get(REFRESH_COOKIE)
    if not token:
        raise _invalid_credentials()
    try:
        claims = decode_claims(token, expected_type="refresh")
    except TokenError as exc:
        raise _invalid_credentials() from exc
    user = db.get(User, claims.user_id)
    # A cookie issued under an older version belongs to a session the owner
    # ended -- by changing the password or signing the other devices out.
    if user is None or not user.is_active or claims.session_version != user.session_version:
        raise _invalid_credentials()

    return _issue_session(response, user)


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


@router.post("/password", response_model=TokenOut)
def change_password(
    payload: PasswordChangeIn,
    response: Response,
    # A session, never an agent key. See `get_session_user`.
    user: User = Depends(get_session_user),
    db: Session = Depends(get_db),
) -> TokenOut:
    """Replace the account's password.

    403, not 401: the caller IS authenticated — what they got wrong is the
    current password, and a 401 here would send the front end's own
    retry-then-log-out machinery (api.ts) after a refresh it does not need,
    ending in the user being signed out for a typo.

    Every OTHER session ends here: the version the tokens carry is bumped and
    the agent key is deleted -- whoever changes a password because someone else
    may hold it must not leave that someone signed in. This session does not
    end: the response carries a fresh access token and cookie under the new
    version, which the screen applies, so the operator is not signed out of the
    tab they are using.
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
    _end_other_sessions(db, user)
    return _issue_session(response, user)


@router.post("/sessions/revoke-others", response_model=TokenOut)
def revoke_other_sessions(
    response: Response,
    # A session, never an agent key: a key must not be able to sign its owner
    # out, nor to outlive the revocation it would be asking for.
    user: User = Depends(get_session_user),
    db: Session = Depends(get_db),
) -> TokenOut:
    """« Déconnecter les autres appareils » : every other browser and the agent
    key lose access; this tab carries on with the session returned here."""
    _end_other_sessions(db, user)
    return _issue_session(response, user)
