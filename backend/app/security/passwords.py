from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

# Tuned for interactive login on a modest self-hosted machine: ~64 MiB, ~50 ms.
_hasher = PasswordHasher(time_cost=2, memory_cost=65536, parallelism=2)


def hash_password(plain: str) -> str:
    return _hasher.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    """Return False for a wrong password and for an unusable stored hash alike.

    VerificationError covers VerifyMismatchError plus the generic failures argon2
    raises when a hash has a valid prefix but a damaged body — truncation in the
    database, an encoding accident. Those must refuse the login, not raise a 500.
    """
    try:
        return _hasher.verify(hashed, plain)
    except (VerificationError, InvalidHashError):
        return False


def needs_rehash(hashed: str) -> bool:
    """True when the stored hash was made with weaker parameters than the current ones."""
    return _hasher.check_needs_rehash(hashed)
