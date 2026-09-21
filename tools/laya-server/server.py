"""Laya behind HTTP, for Yieldo.

Laya (`convaiinnovations/laya`) is a Python library: `laya.load(...)` then
`agent.predict(state, questions)`. It ships no server. This one exposes it in
the Jev dialect Yieldo already speaks -- `POST /v1/systemone` -- and adds what
Laya returns that Jev does not: the probability mass per option and per level,
the act probability of its act/escalate head, the input token count, and the
raw `predict()` result untouched, so nothing unknown is lost. `GET /health`
says which checkpoint is loaded, on what, and how fast it has been answering.

Run it with `install.sh` (systemd, port 8100) or by hand:

    LAYA_SERVE=1 LAYA_CHECKPOINT=typed-decisions \\
        uvicorn server:app --host 0.0.0.0 --port 8100

`create_app(agent)` takes the agent so the tests can pass a fake one and never
import torch.
"""

from __future__ import annotations

import os
import time
from collections import deque
from datetime import UTC, datetime
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

REPO = "convaiinnovations/laya"
# The most recent latencies kept for the percentiles: enough for a p95 that
# means something, small enough never to matter in memory.
WINDOW = 200
# What of a Laya answer travels under its own name. `legend` (the score
# levels repeated) and `action` (flattened to `act_probability`) do not.
ANSWER_FIELDS = ("choice", "score", "noul", "confidence", "probabilities")


class SystemOneIn(BaseModel):
    state: dict[str, Any] | list[Any] | str
    questions: dict[str, dict[str, Any]] = Field(min_length=1)
    # Jev's body carries a model name; the checkpoint here is decided by the
    # server, so it is accepted and ignored.
    model: str | None = None


def _percentile(values: list[int], share: float) -> int:
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, round(share * (len(ordered) - 1))))
    return ordered[index]


def _version(package: str) -> str | None:
    try:
        from importlib.metadata import version

        return version(package)
    except Exception:  # noqa: BLE001 - absent in tests, reported as null
        return None


def create_app(
    agent: Any,
    *,
    checkpoint: str,
    threads: int,
    api_key: str | None = None,
    warmup_ms: int | None = None,
) -> FastAPI:
    app = FastAPI(title="Laya pour Yieldo", docs_url=None, redoc_url=None)
    latencies: deque[int] = deque(maxlen=WINDOW)
    counter = {"predictions": 0}
    loaded_at = datetime.now(UTC).isoformat()
    cfg = getattr(agent, "cfg", None) or {}
    model_name = str(cfg.get("model_name") or checkpoint)

    def require_key(authorization: str | None = Header(default=None)) -> None:
        if not api_key:
            return
        if authorization != f"Bearer {api_key}":
            raise HTTPException(status_code=401, detail="Clé absente ou incorrecte.")

    @app.get("/health")
    def health() -> dict[str, Any]:
        values = list(latencies)
        return {
            "status": "ok",
            "checkpoint": model_name,
            "repo": REPO,
            "device": str(getattr(agent, "device", "cpu")),
            "threads": threads,
            "context_tokens": cfg.get("max_len"),
            "temperatures": cfg.get("temperature_by_options"),
            "laya_version": _version("laya"),
            "torch_version": _version("torch"),
            "loaded_at": loaded_at,
            "warmup_ms": warmup_ms,
            "predictions": counter["predictions"],
            "latency_p50_ms": _percentile(values, 0.5) if values else None,
            "latency_p95_ms": _percentile(values, 0.95) if values else None,
        }

    @app.post("/v1/systemone", dependencies=[Depends(require_key)])
    def systemone(payload: SystemOneIn) -> dict[str, Any]:
        started = time.perf_counter()
        try:
            raw = agent.predict(payload.state, payload.questions)
        except Exception as exc:  # noqa: BLE001 - the cause IS the message
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        latency_ms = int((time.perf_counter() - started) * 1000)
        latencies.append(latency_ms)
        counter["predictions"] += 1

        answers: dict[str, Any] = {}
        for key, answer in (raw.get("answers") or {}).items():
            out: dict[str, Any] = {"type": answer.get("type")}
            for field in ANSWER_FIELDS:
                if field in answer:
                    out[field] = answer[field]
            action = answer.get("action") or {}
            if "act_probability" in action:
                out["act_probability"] = action["act_probability"]
            answers[key] = out

        usage = raw.get("usage") or {}
        return {
            "model": model_name,
            "latency_ms": latency_ms,
            "input_tokens": usage.get("input_tokens"),
            "answers": answers,
            "raw": raw,
        }

    return app


def load_app() -> FastAPI:
    """What uvicorn imports: load the checkpoint, warm it up, serve."""
    import laya  # noqa: PLC0415 - only here, so the tests never need torch
    import torch  # noqa: PLC0415

    checkpoint = os.environ.get("LAYA_CHECKPOINT", "multilingual").strip()
    threads = int(os.environ.get("LAYA_THREADS") or os.cpu_count() or 1)
    torch.set_num_threads(threads)
    subfolder = None if checkpoint in ("", "base") else checkpoint
    agent = laya.load(REPO, subfolder=subfolder)

    # One prediction before the first real one: the first call pays for
    # allocations the next ones do not, and its cost is worth reporting.
    started = time.perf_counter()
    agent.predict(
        {"note": "chauffe"},
        {"q": {"type": "noul", "instructions": "Le serveur est prêt.",
               "criteria": {"true": "vrai", "false": "faux"}}},
    )
    warmup_ms = int((time.perf_counter() - started) * 1000)
    return create_app(
        agent, checkpoint=checkpoint, threads=threads,
        api_key=os.environ.get("LAYA_API_KEY") or None, warmup_ms=warmup_ms,
    )


if os.environ.get("LAYA_SERVE") == "1":
    app = load_app()
