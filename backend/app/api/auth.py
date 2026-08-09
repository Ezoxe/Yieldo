from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.categorization.seed import seed_categories
from app.config import settings
from app.db import get_db
from app.models import User
from app.schemas.auth import LoginIn, RegisterIn, TokenOut, UserOut
from app.security.deps import get_current_user
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
    seed_categories(db, user.id)

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
