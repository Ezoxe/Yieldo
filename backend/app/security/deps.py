from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import User
from app.security.tokens import TokenError, decode_token

_UNAUTHORIZED = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Authentification requise",
    headers={"WWW-Authenticate": "Bearer"},
)


def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    header = request.headers.get("Authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise _UNAUTHORIZED
    try:
        user_id = decode_token(token, expected_type="access")
    except TokenError as exc:
        raise _UNAUTHORIZED from exc
    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise _UNAUTHORIZED
    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="Droits administrateur requis")
    return user
