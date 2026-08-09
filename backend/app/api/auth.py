from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
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
_INVALID_CREDENTIALS = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                                     detail="Identifiants invalides")


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
    db.refresh(user)
    seed_categories(db, user.id)

    _set_refresh_cookie(response, user.id)
    return TokenOut(access_token=create_access_token(user.id), user=UserOut.model_validate(user))


@router.post("/login", response_model=TokenOut)
def login(payload: LoginIn, response: Response, db: Session = Depends(get_db)) -> TokenOut:
    user = db.query(User).filter(User.email == payload.email.strip().lower()).first()
    # Always run a verification so a missing account and a wrong password take
    # comparable time and are indistinguishable from the outside.
    stored_hash = user.password_hash if user else hash_password("timing-equalizer")
    if not verify_password(payload.password, stored_hash) or user is None or not user.is_active:
        raise _INVALID_CREDENTIALS

    _set_refresh_cookie(response, user.id)
    return TokenOut(access_token=create_access_token(user.id), user=UserOut.model_validate(user))


@router.post("/refresh", response_model=TokenOut)
def refresh(request: Request, response: Response, db: Session = Depends(get_db)) -> TokenOut:
    token = request.cookies.get(REFRESH_COOKIE)
    if not token:
        raise _INVALID_CREDENTIALS
    try:
        user_id = decode_token(token, expected_type="refresh")
    except TokenError as exc:
        raise _INVALID_CREDENTIALS from exc
    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise _INVALID_CREDENTIALS

    _set_refresh_cookie(response, user.id)
    return TokenOut(access_token=create_access_token(user.id), user=UserOut.model_validate(user))


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(response: Response) -> None:
    response.delete_cookie(REFRESH_COOKIE, path="/api/auth")


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)) -> UserOut:
    return UserOut.model_validate(user)
