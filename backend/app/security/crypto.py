import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from app.config import settings


class SecretDecryptionError(Exception):
    """Raised when a stored secret cannot be decrypted with the current SECRET_KEY."""


def _fernet() -> Fernet:
    """Derive a stable Fernet key from SECRET_KEY.

    Changing SECRET_KEY makes every previously stored secret unreadable — this is
    documented in the spec and surfaced to the operator by install.sh.
    """
    digest = hashlib.sha256(settings.secret_key.encode()).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt_secret(plain: str) -> str:
    return _fernet().encrypt(plain.encode()).decode()


def decrypt_secret(blob: str) -> str:
    try:
        return _fernet().decrypt(blob.encode()).decode()
    except InvalidToken as exc:
        raise SecretDecryptionError(
            "Secret illisible — la clé de chiffrement a probablement changé"
        ) from exc
