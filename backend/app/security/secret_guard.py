"""The one secret everything else is derived from, checked at startup.

`SECRET_KEY` signs every session token and derives the Fernet key every stored
credential is encrypted with. The default is public -- it is in this
repository -- so an instance running on it has forgeable sessions and readable
broker keys. `install.sh` generates 64 hex characters once; this module makes
sure a deployed instance never runs without one.

"Deployed" is read from what the process does rather than from a flag nobody
remembers to set: an instance that serves the built interface is one people
use. A development server (Vite serves the interface) only gets a warning.

Kept free of any import from `app.config`, which names the same default: the
config module is imported by everything, and `test_secret_guard` pins the two
strings equal instead.
"""

import logging

logger = logging.getLogger(__name__)

DEFAULT_SECRET = "dev-insecure-key-change-me"
MIN_SECRET_LENGTH = 32

_MESSAGE = (
    "Clé secrète absente ou trop courte : lancez ./install.sh install, qui en "
    "génère une et la garde dans .env."
)


def secret_problem(secret: str) -> str | None:
    if secret == DEFAULT_SECRET or len(secret) < MIN_SECRET_LENGTH:
        return _MESSAGE
    return None


def check_secret(secret: str, *, serves_interface: bool) -> None:
    problem = secret_problem(secret)
    if problem is None:
        return
    if serves_interface:
        raise RuntimeError(problem)
    logger.warning(problem)
