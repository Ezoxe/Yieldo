# Laya derrière le pilote : Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put Laya (a self-hosted System One encoder on CPU) behind the
Investissement pilot, show everything it returns — mass per option, per
level, confidence, act probability, health of the server — and keep the
deterministic engine's second opinion beside every decision, per spec
`docs/superpowers/specs/2026-09-21-yieldo-laya-design.md`.

**Architecture:** A standalone FastAPI server in `tools/laya-server/`
(torch never enters the Yieldo image) speaks the Jev dialect enriched with
distributions. In the backend a fourth `DecisionProvider`, `decision/laya.py`,
shares the Jev question payload through a new `decision/systemone.py`, and
`Decision` gains `mass_bps` / `act_bps` outside `canonical()`. The trading
service asks the deterministic engine beside any real model and stores its
canonical answers in a new nullable JSON column; a pure engine turns those
into an agreement rate. Three screens read the new fields.

**Tech Stack:** Python 3.12 (backend) / 3.13 (LXC), FastAPI, httpx, SQLAlchemy
+ Alembic (SQLite), pytest; React 19 + TypeScript, vitest + Testing Library;
`laya 0.3.4`, `torch 2.14 cpu` on the LXC.

## Global Constraints

- Money in integer cents; probabilities and masses in integer basis points
  (`bps`, 10 000 = 100 %); never a `float` on a stored figure — parse with
  `Decimal`, quantize half-up.
- `Decision.canonical()` does not change: `mass_bps`, `act_bps`,
  `confidence_bps`, `latency_ms` stay out of it.
- Every business query filters on `user_id`.
- User-facing text in French with French typography (« », `&nbsp;:`); code,
  comments and commits in English.
- No `except: pass`; every refusal names its cause and its remedy.
- Frontend: no hex in a component, figures in `.yd-num`, status as a pill,
  no colour alone, 1440 and 390, light and dark, judged in a browser.
- `ruff check app tests` clean on touched files; `npx tsc -b` zero errors;
  `npm test` green; backend suite green.
- One Conventional Commit per task, ending with
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

### Task 1: The Laya server — `tools/laya-server/`

**Files:**
- Create: `tools/laya-server/server.py`
- Create: `tools/laya-server/test_server.py`
- Create: `tools/laya-server/requirements.txt`
- Create: `tools/laya-server/laya.service`
- Create: `tools/laya-server/install.sh`
- Create: `tools/laya-server/README.md`

**Interfaces:**
- Produces: `GET /health` → `HealthOut`; `POST /v1/systemone` with body
  `{state: dict|str, questions: {key: {type, instructions, criteria}}}` →
  `{model, latency_ms, input_tokens, answers: {key: {type, choice?|score?|noul?,
  confidence?, probabilities?, act_probability?}}, raw}`.
- `create_app(agent, *, api_key: str | None = None, checkpoint: str, threads: int) -> FastAPI`.

- [x] **Step 1: Write the failing tests** (`tools/laya-server/test_server.py`)

```python
"""The Laya server, tested without torch: a fake agent stands in for laya."""

from fastapi.testclient import TestClient

from server import create_app


class FakeAgent:
    cfg = {"model_name": "laya-typed-decisions", "max_len": 1024,
           "temperature_by_options": {"choice:3-5": 1.76}}
    device = "cpu"
    calls = 0

    def predict(self, state, questions):
        self.calls += 1
        answers = {}
        for key, question in questions.items():
            if question["type"] == "choice":
                options = list(question["criteria"])
                answers[key] = {"type": "choice", "choice": options[-1],
                                "probabilities": {o: 1 / len(options) for o in options},
                                "confidence": 0.0039, "action": {"act_probability": 1.0}}
            elif question["type"] == "score":
                levels = question["criteria"]
                answers[key] = {"type": "score", "score": 4.2882,
                                "probabilities": {l: 1 / len(levels) for l in levels},
                                "confidence": 0.04, "action": {"act_probability": 0.9}}
            else:
                answers[key] = {"type": "noul", "noul": 0.289, "confidence": 0.711,
                                "action": {"act_probability": 1.0}}
        return {"model": "laya-rl-agent", "answers": answers,
                "usage": {"input_tokens": 208, "output_tokens": 0}}


DIRECTION = {"type": "choice", "instructions": "Quelle action ?",
             "criteria": {"acheter": "acheter", "vendre": "vendre",
                          "ne rien faire": "ne rien faire"}}


def client(**kwargs) -> TestClient:
    return TestClient(create_app(FakeAgent(), checkpoint="typed-decisions", threads=4, **kwargs))


def test_health_names_the_checkpoint_and_the_machine():
    body = client().get("/health").json()
    assert body["status"] == "ok"
    assert body["checkpoint"] == "laya-typed-decisions"
    assert body["device"] == "cpu"
    assert body["threads"] == 4
    assert body["context_tokens"] == 1024
    assert body["predictions"] == 0
    assert body["latency_p50_ms"] is None
    assert body["temperatures"] == {"choice:3-5": 1.76}


def test_systemone_answers_in_the_jev_dialect_with_the_mass():
    response = client().post("/v1/systemone", json={"state": {"x": 1}, "questions": {"q": DIRECTION}})
    assert response.status_code == 200
    body = response.json()
    answer = body["answers"]["q"]
    assert answer["choice"] == "ne rien faire"
    assert set(answer["probabilities"]) == {"acheter", "vendre", "ne rien faire"}
    assert answer["act_probability"] == 1.0
    assert body["model"] == "laya-typed-decisions"
    assert body["input_tokens"] == 208
    assert body["raw"]["model"] == "laya-rl-agent"
    assert isinstance(body["latency_ms"], int)


def test_health_counts_predictions_and_reports_percentiles():
    c = client()
    for _ in range(3):
        c.post("/v1/systemone", json={"state": "s", "questions": {"q": DIRECTION}})
    body = c.get("/health").json()
    assert body["predictions"] == 3
    assert isinstance(body["latency_p50_ms"], int)
    assert isinstance(body["latency_p95_ms"], int)


def test_a_key_when_configured_is_required():
    c = client(api_key="secret")
    assert c.post("/v1/systemone", json={"state": "s", "questions": {"q": DIRECTION}}).status_code == 401
    ok = c.post("/v1/systemone", json={"state": "s", "questions": {"q": DIRECTION}},
                headers={"Authorization": "Bearer secret"})
    assert ok.status_code == 200


def test_a_malformed_body_is_a_422():
    assert client().post("/v1/systemone", json={"state": "s"}).status_code == 422


def test_a_failing_agent_is_a_500_naming_the_error():
    class Broken(FakeAgent):
        def predict(self, state, questions):
            raise RuntimeError("poids introuvables")

    c = TestClient(create_app(Broken(), checkpoint="x", threads=1))
    response = c.post("/v1/systemone", json={"state": "s", "questions": {"q": DIRECTION}})
    assert response.status_code == 500
    assert "poids introuvables" in response.json()["detail"]
```

- [x] **Step 2: Run to see them fail**

Run: `cd tools/laya-server && ../../backend/.venv/Scripts/python.exe -m pytest test_server.py -q`
Expected: `ModuleNotFoundError: No module named 'server'`.

- [x] **Step 3: Write `server.py`**

```python
"""Laya behind HTTP, for Yieldo.

Laya (`convaiinnovations/laya`) is a Python library: `laya.load(...)` then
`agent.predict(state, questions)`. It ships no server. This one exposes it in
the Jev dialect Yieldo already speaks — `POST /v1/systemone` — and adds what
Laya returns that Jev does not: the probability mass per option and per level,
the act probability, the input token count, and the raw `predict()` result
untouched so nothing unknown is lost. `GET /health` says which checkpoint is
loaded, on what, and how fast it has been answering.

Run it with `install.sh` (systemd, port 8100) or by hand:

    LAYA_CHECKPOINT=typed-decisions uvicorn server:app --host 0.0.0.0 --port 8100

`create_app(agent)` takes the agent so the tests can pass a fake one and never
import torch.
"""

from __future__ import annotations

import os
import statistics
import time
from collections import deque
from datetime import UTC, datetime
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

REPO = "convaiinnovations/laya"
# The 200 most recent latencies: enough for a p95 that means something,
# small enough to never matter in memory.
WINDOW = 200


class SystemOneIn(BaseModel):
    state: dict[str, Any] | list[Any] | str
    questions: dict[str, dict[str, Any]] = Field(min_length=1)
    model: str | None = None


def _percentile(values: list[int], share: float) -> int:
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, round(share * (len(ordered) - 1))))
    return ordered[index]


def create_app(
    agent: Any, *, checkpoint: str, threads: int, api_key: str | None = None,
    warmup_ms: int | None = None,
) -> FastAPI:
    app = FastAPI(title="Laya pour Yieldo", docs_url=None, redoc_url=None)
    latencies: deque[int] = deque(maxlen=WINDOW)
    counter = {"predictions": 0}
    loaded_at = datetime.now(UTC).isoformat()
    cfg = getattr(agent, "cfg", {}) or {}
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
        except Exception as exc:  # noqa: BLE001 - the cause is the message
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        latency_ms = int((time.perf_counter() - started) * 1000)
        latencies.append(latency_ms)
        counter["predictions"] += 1

        answers: dict[str, Any] = {}
        for key, answer in (raw.get("answers") or {}).items():
            out: dict[str, Any] = {"type": answer.get("type")}
            for field in ("choice", "score", "noul", "confidence", "probabilities"):
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


def _version(package: str) -> str | None:
    try:
        from importlib.metadata import version
        return version(package)
    except Exception:  # noqa: BLE001 - absent in tests, reported as null
        return None


def load_app() -> FastAPI:
    """What uvicorn imports: load the checkpoint, warm it up, serve."""
    import laya  # noqa: PLC0415 - only here, so the tests never need torch
    import torch  # noqa: PLC0415

    checkpoint = os.environ.get("LAYA_CHECKPOINT", "typed-decisions").strip()
    threads = int(os.environ.get("LAYA_THREADS") or os.cpu_count() or 1)
    torch.set_num_threads(threads)
    agent = laya.load(REPO, subfolder=None if checkpoint in ("", "base") else checkpoint)

    started = time.perf_counter()
    agent.predict({"note": "chauffe"}, {"q": {
        "type": "noul", "instructions": "Le serveur est prêt.",
        "criteria": {"true": "vrai", "false": "faux"},
    }})
    warmup_ms = int((time.perf_counter() - started) * 1000)
    return create_app(
        agent, checkpoint=checkpoint, threads=threads,
        api_key=os.environ.get("LAYA_API_KEY") or None, warmup_ms=warmup_ms,
    )


if os.environ.get("LAYA_SERVE") == "1":
    app = load_app()
```

- [x] **Step 4: Run the tests**

Run: `cd tools/laya-server && ../../backend/.venv/Scripts/python.exe -m pytest test_server.py -q`
Expected: 6 passed. (`fastapi` is a backend dependency; the backend venv has it.)

- [x] **Step 5: Write `requirements.txt`, `laya.service`, `install.sh`, `README.md`**

`requirements.txt`:
```
laya>=0.3.4
fastapi>=0.115
uvicorn[standard]>=0.30
```

`laya.service`:
```ini
[Unit]
Description=Laya pour Yieldo (System One, CPU)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=/etc/default/laya
Environment=LAYA_SERVE=1
WorkingDirectory=/opt/laya
ExecStart=/opt/laya/venv/bin/uvicorn server:app --host 0.0.0.0 --port ${LAYA_PORT}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

`install.sh` (idempotent; `set -euo pipefail`; requires root):
```bash
#!/usr/bin/env bash
# Installs or updates the Laya server for Yieldo on a Debian/Ubuntu host.
# Idempotent: run it again to update server.py or the packages.
set -euo pipefail

RAW="https://raw.githubusercontent.com/Ezoxe/Yieldo/master/tools/laya-server"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${LAYA_PORT:-8100}"

[ "$(id -u)" -eq 0 ] || { echo "Lancez ce script en root." >&2; exit 1; }

apt-get update -qq && apt-get install -y -qq python3 python3-venv curl >/dev/null
mkdir -p /opt/laya
[ -x /opt/laya/venv/bin/python ] || python3 -m venv /opt/laya/venv
/opt/laya/venv/bin/pip install -q --upgrade pip
/opt/laya/venv/bin/pip install -q torch --index-url https://download.pytorch.org/whl/cpu
/opt/laya/venv/bin/pip install -q "laya>=0.3.4" "fastapi>=0.115" "uvicorn[standard]>=0.30"

fetch() {  # copies from the checkout when run from it, downloads otherwise
  if [ -f "$HERE/$1" ]; then cp "$HERE/$1" "$2"; else curl -fsSL "$RAW/$1" -o "$2"; fi
}
fetch server.py /opt/laya/server.py
fetch laya.service /etc/systemd/system/laya.service

if [ ! -f /etc/default/laya ]; then
  cat > /etc/default/laya <<EOF
LAYA_CHECKPOINT=typed-decisions
LAYA_PORT=$PORT
LAYA_THREADS=$(nproc)
LAYA_API_KEY=
EOF
fi

systemctl daemon-reload
systemctl enable --now laya.service
systemctl restart laya.service

echo "Chargement du modèle…"
for _ in $(seq 1 120); do
  if curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
    curl -fsS "http://127.0.0.1:$PORT/health"; echo
    echo "Laya répond sur le port $PORT."
    exit 0
  fi
  sleep 2
done
echo "Laya n'a pas répondu en quatre minutes : journalctl -u laya -e" >&2
exit 1
```

`README.md`: French operator doc — what Laya is (encoder, not an LLM, no
vLLM/llama.cpp), the LXC (Debian, 4–6 cores, 8 GB, 24 GB, port 8100), the
one-line install, `/etc/default/laya` keys, the three checkpoints and how
to switch (`LAYA_CHECKPOINT=base|multilingual|typed-decisions`, then
`systemctl restart laya`), reading `/health`, logs
(`journalctl -u laya -f`), the zero-shot caveat and the second-opinion panel.

- [x] **Step 6: Commit**

```bash
git add tools/laya-server
git commit -m "feat(invest): a Laya server for Yieldo, in the Jev dialect with the mass"
```

---

### Task 2: `decision/systemone.py` shared by Jev and Laya; `Decision.mass_bps` / `act_bps`

**Files:**
- Create: `backend/app/decision/systemone.py`
- Modify: `backend/app/decision/jev.py` (import from systemone; no behaviour change)
- Modify: `backend/app/decision/contract.py` (`Decision` fields, `PROVIDERS`, `PROVIDER_LABELS`)
- Modify: `backend/app/trading/service.py:216-223` (`_decision_payload`)
- Test: `backend/tests/test_decision_contract.py`

**Interfaces:**
- Produces: `systemone.questions_payload(question) -> dict`,
  `systemone.to_decimal(value) -> Decimal`, `systemone.bps(value: Decimal) -> int`,
  `systemone.CONTEXT`.
- `Decision(..., mass_bps: dict[str, int] | None = None, act_bps: int | None = None)`.
- `PROVIDERS == ("local", "jev", "laya", "replay")`, `PROVIDER_LABELS["laya"] == "Laya (auto-hébergé)"`.

- [x] **Step 1: Failing tests** (append to `tests/test_decision_contract.py`)

```python
def test_mass_and_act_probability_stay_out_of_the_canonical_form():
    decision = Decision(
        question_key="direction", kind="choice", choice="acheter", score_value=None,
        probability_bps=None, latency_ms=12, provider="laya", model="m", raw="{}",
        confidence_bps=40, mass_bps={"acheter": 6_000, "vendre": 1_000, "ne rien faire": 3_000},
        act_bps=10_000,
    )
    assert "mass_bps" not in decision.canonical()
    assert "act_bps" not in decision.canonical()
    assert decision.mass_bps["acheter"] == 6_000


def test_laya_is_a_named_provider():
    assert "laya" in PROVIDERS
    assert PROVIDER_LABELS["laya"] == "Laya (auto-hébergé)"
```

- [x] **Step 2: Run** — `pytest tests/test_decision_contract.py -q` — FAIL (`unexpected keyword 'mass_bps'`).

- [x] **Step 3: Implement**

`contract.py`: `PROVIDERS = ("local", "jev", "laya", "replay")`; label
`"laya": "Laya (auto-hébergé)"`; on `Decision`, after `confidence_bps`:

```python
    # The model's whole distribution, when the provider exposes it: option →
    # bps for a choice, level → bps for a score. Laya returns it; an
    # OpenAI-compatible endpoint does not. Like `confidence_bps` it describes
    # this run's output and stays out of `canonical()`.
    mass_bps: dict[str, int] | None = None
    # Laya's act/escalate head: how sure it is that acting is right at all.
    act_bps: int | None = None
```

`systemone.py`: move `_questions_payload`, `_decimal`, `_CONTEXT` out of
`jev.py` as `questions_payload`, `to_decimal`, `CONTEXT`, and add
`bps(value: Decimal) -> int` (`quantize(multiply(value, 10_000), 1)`) and
`mass_bps(probabilities: Any) -> dict[str, int] | None` (a dict of
`str → Decimal|int` becomes `{str: bps}`; anything else returns `None`).
`jev.py` imports them; `_confidence_bps` uses `bps(to_decimal(...))`.

`service.py` `_decision_payload`: add `payload["mass_bps"] = decision.mass_bps`
and `payload["act_bps"] = decision.act_bps`.

- [x] **Step 4: Run** — `pytest tests/test_decision_contract.py tests/test_trading_pipeline.py tests/test_invest_api.py -q` — PASS. Then `cd frontend && npx vitest run src/features/invest/vocabulary.test.ts` — FAIL on the missing `laya` label (fixed in Task 7; note it).

- [x] **Step 5: Commit** — `feat(invest): the decision carries the model's mass, and laya is a provider`.

---

### Task 3: `decision/laya.py` — the provider and its probe

**Files:**
- Create: `backend/app/decision/laya.py`
- Modify: `backend/app/decision/registry.py`
- Test: `backend/tests/test_laya_provider.py`

**Interfaces:**
- `LayaProvider(endpoint_url: str, model_name: str | None, api_key: str | None, timeout_ms: int)`
  with `.decide(question, context) -> Decision` and `.probe() -> dict[str, Any]`.
- Registry: `provider == "laya"` requires `endpoint_url` else `NO_MODEL`.

- [x] **Step 1: Failing tests** (`tests/test_laya_provider.py`; monkeypatch
`httpx.post` / `httpx.get` with a stub returning `httpx.Response`)

Cases: a conforming choice answer is parsed with `mass_bps` in bps and
`act_bps`; a score answer `4.2882` on 0–10 becomes `score_value == 4` with
an 11-key mass; a `noul` of `0.289` becomes `probability_bps == 2_890`; a
choice outside the options is `OFF_CONTRACT`; no key configured still
posts (no `Authorization` header); a 401 is `MODEL_REJECTED`; a timeout is
`TOO_SLOW`; `probe()` returns the `/health` body; `build_provider` on a
`DecisionSettings(provider="laya", endpoint_url=None)` raises `NO_MODEL`.

- [x] **Step 2: Run** — FAIL (`No module named app.decision.laya`).

- [x] **Step 3: Implement** — same structure as `JevProvider.decide`, with:
  - URL `f"{endpoint_url.rstrip('/')}/v1/systemone"`; header only when a key exists.
  - `json.loads(raw, parse_float=Decimal)`; `answer = body["answers"]["q"]`.
  - After the typed parse, `mass_bps=systemone.mass_bps(answer.get("probabilities"))`
    and `act_bps=bps(to_decimal(answer["act_probability"]))` when present.
  - Score: Laya's `score` is a continuous position from 0; level =
    `int(quantize(position)) + question.minimum`, range-checked.
  - `probe()`: `httpx.get(f"{endpoint}/health", timeout=...)`; non-200 or
    transport error → `SERVICE_UNREACHABLE`; returns the JSON dict.
  - Registry: branch `if row.provider == "laya": if not row.endpoint_url: raise NO_MODEL; return LayaProvider(...)`.
  - `failure_message` for `NO_MODEL` already names the screen.

- [x] **Step 4: Run** — `pytest tests/test_laya_provider.py -q` — PASS. `ruff check app/decision tests/test_laya_provider.py`.

- [x] **Step 5: Commit** — `feat(invest): the Laya provider, with the mass and the health probe`.

---

### Task 4: The model route returns Laya's health card and the test answer's mass

**Files:**
- Modify: `backend/app/api/invest_model.py`
- Modify: `backend/app/schemas/invest.py` (`DecisionModelCheckOut`)
- Test: `backend/tests/test_invest_api.py`

**Interfaces:**
- `DecisionModelCheckOut` gains `health: dict[str, Any] | None = None`,
  `mass_bps: dict[str, int] | None = None`, `act_bps: int | None = None`,
  `choice: str | None = None`.

- [x] **Step 1: Failing tests** — with `httpx.post`/`httpx.get` stubbed:
`PUT /invest/model {"provider": "laya", "endpoint_url": "http://laya:8100"}`
→ `valid` true, `health["checkpoint"] == "laya-typed-decisions"`,
`mass_bps` has three keys, `choice == "ne rien faire"`; without
`endpoint_url` → 422 naming the address; `GET /invest/model` echoes
`provider == "laya"`.

- [x] **Step 2: Run** — FAIL.

- [x] **Step 3: Implement** — in `write_model`: the `local`-style 422 check
extended to `laya` (`"Laya a besoin de l'adresse de son serveur (par exemple http://192.168.1.172:8100)."`);
after `decision = provider.decide(...)`, `health = provider.probe() if hasattr(provider, "probe") else None`
inside the same `try`; return `choice=decision.choice, mass_bps=decision.mass_bps, act_bps=decision.act_bps, health=health`.
The 404 sentence lists four providers.

- [x] **Step 4: Run** — `pytest tests/test_invest_api.py -q` — PASS.

- [x] **Step 5: Commit** — `feat(invest): saving Laya shows its health card and the test answer's mass`.

---

### Task 5: The second opinion — column, migration, service, engine, routes

**Files:**
- Modify: `backend/app/models/trade_decision.py` (column `second_opinion`)
- Create: `backend/alembic/versions/c7d8e9f0a1b2_second_opinion.py`
- Create: `backend/app/engines/second_opinion.py`
- Modify: `backend/app/trading/service.py` (ask the engine beside a real model)
- Modify: `backend/app/api/invest_run.py`, `backend/app/schemas/invest.py`
- Test: `backend/tests/test_second_opinion.py`, `tests/test_trading_pipeline.py`,
  `tests/test_invest_api.py`, `tests/test_migrations.py`

**Interfaces:**
- `TradeDecision.second_opinion: dict | None` — `{"direction": canonical, "conviction"?: canonical, "continuation"?: canonical}`.
- `engines.second_opinion.compare(rows: Iterable[Opinion]) -> Agreement` with
  `Opinion(decision_id, symbol, created_at, model_choice: str | None, rules_choice: str | None)`
  and `Agreement(compared, agreed, agreement_bps, disagreements: tuple[Disagreement, ...])`,
  `Disagreement(decision_id, symbol, model_choice, rules_choice, created_at)`.
- `OverviewOut.second_opinion: SecondOpinionOut`; `DecisionDetailOut.second_opinion: dict | None`.

- [x] **Step 1: Failing tests**

`tests/test_second_opinion.py` (pure): three opinions, two agreeing → `compared 3, agreed 2, agreement_bps 6667`, one disagreement first; rows with a `None` on either side are not compared; an empty input gives `0, 0, 0, ()`; disagreements are capped at 8, most recent first.

`tests/test_trading_pipeline.py`: with a stub provider that always answers « acheter » / 7 / 0.6, the stored row has `second_opinion["direction"]["choice"] in ("acheter", "vendre", "ne rien faire")`; with `ReplayProvider()` it is `None`.

`tests/test_invest_api.py`: `GET /invest/overview` has `second_opinion.compared`; `GET /invest/decisions/{id}` has `second_opinion`.

`tests/test_migrations.py`: `SECOND_OPINION_REVISION = "c7d8e9f0a1b2"`; upgrade from `INVESTMENT_REVISION` adds a nullable `second_opinion` column to `trade_decisions` matching `_reference_schema`; downgrade removes it; it is the single head.

- [x] **Step 2: Run** — FAIL.

- [x] **Step 3: Implement**

Model: `second_opinion: Mapped[dict | None] = mapped_column(JSON, nullable=True)` with a comment (the deterministic engine's canonical answers on the same context, when the provider was a real model; never executed).

Migration (SQLite: `batch_alter_table` add/drop column), `down_revision = "a1b2c3d4e5f6"`.

Service, in `run_cycle` after the three questions succeed (inside the `try`, after `continuation`):
```python
        second_opinion = None
        if provider_name != "replay":
            second_opinion = _second_opinion(context)
```
with
```python
def _second_opinion(context: dict[str, Any]) -> dict[str, Any]:
    """The deterministic engine's answers on the same context, canonical only.
    Never sized, never sent to the mandate: a yardstick beside the model."""
    rules = ReplayProvider()
    out = {DIRECTION.key: rules.decide(DIRECTION, context).canonical()}
    if out[DIRECTION.key]["choice"] != HOLD:
        out[CONVICTION.key] = rules.decide(CONVICTION, context).canonical()
        out[CONTINUATION.key] = rules.decide(CONTINUATION, context).canonical()
    return out
```
and `_record(..., second_opinion=second_opinion)` on the held/refused/ordered paths (`None` on the failed path).

Engine `engines/second_opinion.py`: frozen dataclasses above; `compare()` skips rows where either choice is `None`, `agreement_bps = round(agreed * 10_000 / compared)` via `Decimal`, disagreements sorted by `created_at` desc, `[:8]`.

Routes: `overview` builds `Opinion`s from `rows` (`model_choice = row.answers.get("direction", {}).get("choice")`, `rules_choice = (row.second_opinion or {}).get("direction", {}).get("choice")`); `read_decision` adds `second_opinion=row.second_opinion`.

- [x] **Step 4: Run** — the four files, then the whole backend suite. PASS. `alembic upgrade head` on the dev DB.

- [x] **Step 5: Commit** — `feat(invest): the deterministic engine's second opinion beside every model decision`.

---

### Task 6: `install.sh` on the LXC, end to end

- [x] Push `master`; on the LXC: `curl -fsSL https://raw.githubusercontent.com/Ezoxe/Yieldo/master/tools/laya-server/install.sh | bash`.
- [x] `curl http://192.168.1.172:8100/health` from the workstation; one `POST /v1/systemone` with the three questions; note p50.
- [x] No commit (operations).

---

### Task 7: Modèle de décision — the Laya option and the health card

**Files:**
- Modify: `frontend/src/features/invest/vocabulary.ts` (`PROVIDER_LABELS.laya`)
- Modify: `frontend/src/lib/types.ts` (`InvestModelCheck` + `InvestAnswer.mass_bps/act_bps`, `InvestOverview.second_opinion`, `InvestDecisionDetail.second_opinion`)
- Modify: `frontend/src/features/invest/ModelPage.tsx`
- Create: `frontend/src/features/invest/MassBars.tsx` (+ styles in `invest.css`)
- Test: `frontend/src/features/invest/ModelPage.test.tsx` (new), `MassBars.test.tsx` (new)

**Interfaces:**
- `<MassBars mass={Record<string, number>} chosen={string | null} labels?={Record<string,string>} />`
  renders one `role="listitem"` per key with the label, a bar sized by bps and
  the `%` in `.yd-num`; the chosen key carries `aria-current="true"` and the
  `CheckIcon`.

- [x] **Step 1: Failing tests** — `MassBars` renders three items, marks the chosen one, prints `35,0 %`; `ModelPage` shows the fourth radio « Laya (auto-hébergé) », the address placeholder `http://192.168.1.172:8100`, no « Nom du modèle » field for laya, and after save with a stubbed `PUT` answering `health` + `mass_bps`, the card prints the checkpoint, `p50`, `threads` and the mass bars.
- [x] **Step 2: Run** — FAIL.
- [x] **Step 3: Implement** — `PROVIDERS = ["local", "jev", "laya", "replay"]`; a `PROVIDER_NOTES.laya` (encoder, not an LLM; CPU 0,6 s per question; zero-shot caveat, the second-opinion panel); fields: address (placeholder above), key, timeout — no name field when `provider === "laya"`; the result block gains a `<dl className="yd-health">` when `result.health` exists (Checkpoint, Machine, Threads, Contexte, Chauffe, Médiane, p95, Prédictions) and `<MassBars>` when `result.mass_bps` exists, headed « Ce qu'il a répondu à la question de test ».
- [x] **Step 4: Run** — vitest on the two files + `vocabulary.test.ts`; `npx tsc -b`.
- [x] **Step 5: Commit** — `feat(invest): Laya in Modèle de décision, with its health card`.

---

### Task 8: Décisions — the mass under each question, the rules beside it

**Files:**
- Modify: `frontend/src/features/invest/DecisionDetail.tsx`
- Test: `frontend/src/features/invest/DecisionDetail.test.tsx` (new)

- [x] **Step 1: Failing tests** — a detail with `answers.direction.mass_bps` renders `MassBars` with « acheter » chosen; a `continuation` with `probability_bps: 2890` renders two bars « Se poursuit 28,9 % » / « S'inverse 71,1 % »; `act_bps` prints « agir : 100 % »; a `second_opinion.direction.choice === "ne rien faire"` beside a model « acheter » prints the pill « Les règles auraient dit : ne rien faire » with the negative tone, and the positive tone when equal; no `second_opinion` prints nothing.
- [x] **Step 2: Run** — FAIL.
- [x] **Step 3: Implement** — after the answer line: `MassBars` for `choice`/`score` masses; for a probability, a two-key mass built from `probability_bps`; a `yd-feed__time` « agir : … » when `act_bps`; the rules pill from `detail.second_opinion?.[question.key]`.
- [x] **Step 4: Run** — PASS; `tsc`.
- [x] **Step 5: Commit** — `feat(invest): a decision shows the model's whole distribution and the rules' verdict`.

---

### Task 9: Salle de contrôle — « Le modèle contre les règles »

**Files:**
- Modify: `frontend/src/features/invest/ControlRoomPage.tsx`
- Test: `frontend/src/features/invest/ControlRoomPage.test.tsx`

- [x] **Step 1: Failing tests** — with `second_opinion: {compared: 12, agreed: 9, agreement_bps: 7500, disagreements: [...]}` the panel prints « 75,0 % », « 12 décisions comparées », and one row per disagreement with symbol, model choice, rules choice and a link to `/invest/decisions`; with `compared: 0` an `EmptyState` says the second opinion is kept only beside a model other than the built-in engine.
- [x] **Step 2: Run** — FAIL.
- [x] **Step 3: Implement** — a `BentoCell span={{ base: 1, md: 6, lg: 5 }}` after « Le modèle dit-il vrai ? », `PanelHead` « Le modèle contre les règles » with `InfoTip` (judged on direction only); big figure `.yd-invest-kpi`; list `.yd-feed` of disagreements.
- [x] **Step 4: Run** — PASS; `tsc`; full `npm test`.
- [x] **Step 5: Commit** — `feat(invest): the Salle de contrôle scores the model against the rules`.

---

### Task 10: Judge in the browser, both widths and themes

- [x] Dev servers up; Modèle de décision → Laya at `http://192.168.1.172:8100` → « Enregistrer et interroger » → the card and the bars, 1440 and 390, light and dark.
- [x] Run three tours; open a decision; the mass bars and the rules pill; the new panel on the Salle de contrôle.
- [x] Fix what the browser shows; commit as `fix(invest): …`; push.
