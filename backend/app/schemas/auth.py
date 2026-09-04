from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


class RegisterIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    password: str = Field(min_length=8, max_length=200)


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class ProfileIn(BaseModel):
    """What PATCH /auth/me accepts. Both fields optional and independent: the
    settings screen submits one form per field, and a request carrying neither
    is a no-op rather than an error."""

    name: str | None = Field(default=None, min_length=1, max_length=120)
    email: EmailStr | None = None

    @field_validator("name")
    @classmethod
    def name_is_not_blank(cls, value: str | None) -> str | None:
        """`min_length` counts characters, so "   " passes it. A name of three
        spaces is not a name."""
        if value is None:
            return None
        stripped = value.strip()
        if not stripped:
            raise ValueError("Le nom ne peut pas être vide")
        return stripped


class PasswordChangeIn(BaseModel):
    """The current password is required, and verified, even though the caller
    is already authenticated: an access token in someone else's hands must not
    be enough to lock the owner out of their own account."""

    current_password: str
    new_password: str = Field(min_length=8, max_length=200)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    name: str
    role: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut
