"""Which provider answers, built from what the household stored.

One function, and it is the ONLY place a decision provider is constructed.
Every caller in `app/trading/` takes a `DecisionProvider` it was handed, so a
test passes `ReplayProvider()` without a database and production passes
whatever Investissement → Modèle de décision holds.

**The key is decrypted here and nowhere else**, on the way into the provider,
exactly as `market/client` does for a market key and `llm/client` for a model
key. It is never returned by a route, never logged, and never stored on the
provider as anything but a private attribute.

**No provider means no decision.** A household that has not configured one gets
`NO_MODEL` with the sentence naming the screen to open -- never the
deterministic engine standing in silently for a model that was never chosen.
"""

from app.decision.contract import (
    DecisionFailureCause,
    DecisionProvider,
    decision_error,
)
from app.decision.jev import JevProvider
from app.decision.local import LocalProvider
from app.decision.replay import ReplayProvider
from app.models import DecisionSettings
from app.security.crypto import SecretDecryptionError, decrypt_secret

# A decision that has not arrived in this long is one taken on a market that
# has moved. Two seconds is generous for a constrained small model (tens of
# milliseconds is typical) and tight enough that a run cannot hang on it.
DEFAULT_TIMEOUT_MS = 2_000


def build_provider(row: DecisionSettings | None) -> DecisionProvider:
    if row is None:
        raise decision_error(DecisionFailureCause.NO_MODEL, "local")

    timeout_ms = row.timeout_ms or DEFAULT_TIMEOUT_MS

    api_key: str | None = None
    if row.api_key_encrypted:
        try:
            api_key = decrypt_secret(row.api_key_encrypted)
        except SecretDecryptionError as exc:
            raise decision_error(
                DecisionFailureCause.MODEL_REJECTED, row.provider,
                "la clé enregistrée est illisible avec la clé de chiffrement actuelle",
            ) from exc

    if row.provider == "replay":
        return ReplayProvider()
    if row.provider == "jev":
        return JevProvider(
            endpoint_url=row.endpoint_url, model_name=row.model_name,
            api_key=api_key, timeout_ms=timeout_ms,
        )
    if row.provider == "local":
        if not row.endpoint_url:
            raise decision_error(
                DecisionFailureCause.NO_MODEL, "local",
            )
        return LocalProvider(
            endpoint_url=row.endpoint_url, model_name=row.model_name or "",
            api_key=api_key, timeout_ms=timeout_ms,
        )
    raise decision_error(
        DecisionFailureCause.NO_MODEL, row.provider,
    )
