"""The marking rule, seen from the routes, and the third figure it makes possible.

`engines/transfer.py` holds the rule; this file pins that every way a row can
enter or change the ledger runs it, that a mark made by hand is never
recomputed, and that the set-aside figure is published beside the measured
capacity rather than folded into it.
"""

from app.models import Transaction


def _register(client, email: str = "max@example.com") -> dict[str, str]:
    body = client.post("/api/auth/register", json={
        "name": "Max", "email": email, "password": "motdepasse123"}).json()
    return {"Authorization": f"Bearer {body['access_token']}"}


def _account(client, headers, name: str = "Compte courant", kind: str = "checking") -> int:
    return client.post("/api/accounts", headers=headers, json={
        "name": name, "kind": kind}).json()["id"]


def _category(client, headers, slug: str) -> int:
    body = client.get("/api/categories", headers=headers).json()
    flat = []

    def walk(rows):
        for row in rows:
            flat.append(row)
            walk(row.get("children", []))

    walk(body if isinstance(body, list) else body["items"])
    return next(row["id"] for row in flat if row["slug"] == slug)


def _post(client, headers, account_id: int, **overrides) -> dict:
    payload = {
        "account_id": account_id,
        "date": "2025-03-05",
        "amount_cents": -30_000,
        "label_raw": "VIREMENT LIVRET A",
    }
    payload.update(overrides)
    return client.post("/api/transactions", headers=headers, json=payload).json()


# --- Every way in runs the rule ---------------------------------------------

def test_a_hand_typed_row_filed_under_epargne_is_a_transfer(client):
    headers = _register(client)
    account_id = _account(client, headers)
    row = _post(client, headers, account_id,
                category_id=_category(client, headers, "epargne"))

    assert row["is_transfer"] is True
    assert row["transfer_source"] == "auto"


def test_a_hand_typed_row_filed_under_an_expense_is_not(client):
    headers = _register(client)
    account_id = _account(client, headers)
    row = _post(client, headers, account_id,
                category_id=_category(client, headers, "alimentation-courses"),
                label_raw="SUPERMARCHE")

    assert row["is_transfer"] is False


def test_an_uncategorised_row_on_a_savings_account_is_a_transfer(client):
    headers = _register(client)
    livret = _account(client, headers, "Livret A", "savings")
    row = _post(client, headers, livret, amount_cents=30_000, label_raw="ZZQXJ VERSEMENT")

    assert row["is_transfer"] is True
    assert row["transfer_source"] == "auto"


def test_the_caller_may_still_declare_a_transfer_and_that_declaration_is_manual(client):
    headers = _register(client)
    account_id = _account(client, headers)
    row = _post(client, headers, account_id, is_transfer=True, label_raw="ZZQXJ REMBOURSEMENT")

    assert row["is_transfer"] is True
    assert row["transfer_source"] == "manual"


# --- A mark made by hand outranks every rule --------------------------------

def test_marking_a_row_by_hand_makes_it_manual(client):
    headers = _register(client)
    account_id = _account(client, headers)
    row = _post(client, headers, account_id, label_raw="ZZQXJ MOUVEMENT")

    patched = client.patch(f"/api/transactions/{row['id']}", headers=headers,
                           json={"is_transfer": True}).json()

    assert patched["is_transfer"] is True
    assert patched["transfer_source"] == "manual"


def test_recategorising_a_manual_row_never_unmarks_it(client):
    headers = _register(client)
    account_id = _account(client, headers)
    row = _post(client, headers, account_id, label_raw="ZZQXJ MOUVEMENT")
    client.patch(f"/api/transactions/{row['id']}", headers=headers,
                 json={"is_transfer": True})

    patched = client.patch(f"/api/transactions/{row['id']}", headers=headers, json={
        "category_id": _category(client, headers, "alimentation-courses")}).json()

    assert patched["is_transfer"] is True
    assert patched["transfer_source"] == "manual"


def test_unmarking_by_hand_is_also_a_manual_decision(client):
    headers = _register(client)
    account_id = _account(client, headers)
    row = _post(client, headers, account_id,
                category_id=_category(client, headers, "epargne"))

    patched = client.patch(f"/api/transactions/{row['id']}", headers=headers,
                           json={"is_transfer": False}).json()

    assert patched["is_transfer"] is False
    assert patched["transfer_source"] == "manual"


# --- Recategorising an automatic row re-runs the rule -----------------------

def test_filing_a_row_under_epargne_afterwards_marks_it(client):
    headers = _register(client)
    account_id = _account(client, headers)
    row = _post(client, headers, account_id, label_raw="ZZQXJ MOUVEMENT")
    assert row["is_transfer"] is False

    patched = client.patch(f"/api/transactions/{row['id']}", headers=headers, json={
        "category_id": _category(client, headers, "epargne")}).json()

    assert patched["is_transfer"] is True
    assert patched["transfer_source"] == "auto"


def test_moving_a_row_out_of_epargne_unmarks_it(client):
    headers = _register(client)
    account_id = _account(client, headers)
    row = _post(client, headers, account_id,
                category_id=_category(client, headers, "epargne"))

    patched = client.patch(f"/api/transactions/{row['id']}", headers=headers, json={
        "category_id": _category(client, headers, "alimentation-courses")}).json()

    assert patched["is_transfer"] is False


def test_clearing_the_category_of_a_row_on_a_current_account_unmarks_it(client):
    headers = _register(client)
    account_id = _account(client, headers)
    row = _post(client, headers, account_id,
                category_id=_category(client, headers, "epargne"))

    patched = client.patch(f"/api/transactions/{row['id']}", headers=headers,
                           json={"category_id": None}).json()

    assert patched["is_transfer"] is False


def test_moving_a_row_onto_a_savings_account_marks_it(client):
    headers = _register(client)
    account_id = _account(client, headers)
    livret = _account(client, headers, "Livret A", "savings")
    row = _post(client, headers, account_id, label_raw="ZZQXJ MOUVEMENT")

    patched = client.patch(f"/api/transactions/{row['id']}", headers=headers,
                           json={"account_id": livret}).json()

    assert patched["is_transfer"] is True


# --- The list hides them, and says so ---------------------------------------

def test_the_list_leaves_internal_transfers_out_by_default(client):
    headers = _register(client)
    account_id = _account(client, headers)
    _post(client, headers, account_id, category_id=_category(client, headers, "epargne"))
    _post(client, headers, account_id, label_raw="SUPERMARCHE", amount_cents=-8_450,
          category_id=_category(client, headers, "alimentation-courses"))

    body = client.get("/api/transactions", headers=headers).json()

    assert [row["label_raw"] for row in body["items"]] == ["SUPERMARCHE"]
    assert body["transfer_total"] == 1


def test_the_list_shows_them_when_asked(client):
    headers = _register(client)
    account_id = _account(client, headers)
    _post(client, headers, account_id, category_id=_category(client, headers, "epargne"))
    _post(client, headers, account_id, label_raw="SUPERMARCHE", amount_cents=-8_450,
          category_id=_category(client, headers, "alimentation-courses"))

    body = client.get("/api/transactions?include_transfers=true", headers=headers).json()

    assert len(body["items"]) == 2
    assert body["transfer_total"] == 1


# --- The third figure -------------------------------------------------------

def test_the_summary_publishes_what_was_actually_set_aside(client):
    headers = _register(client)
    account_id = _account(client, headers)
    _post(client, headers, account_id, amount_cents=250_000, label_raw="SALAIRE",
          category_id=_category(client, headers, "revenus-salaire"))
    _post(client, headers, account_id, amount_cents=-150_000, label_raw="LOYER",
          category_id=_category(client, headers, "logement-loyer"))
    _post(client, headers, account_id, amount_cents=-30_000,
          category_id=_category(client, headers, "epargne"))

    body = client.get("/api/analytics/summary", headers=headers).json()

    # The versement is a transfer, so it is in neither inflow nor outflow.
    assert body["inflow_cents"] == 250_000
    assert body["outflow_cents"] == -150_000
    assert body["net_cents"] == 100_000
    # And it is published on its own, never added to the net above.
    assert body["set_aside_cents"] == 30_000
    # What the month produced but never moved anywhere.
    assert body["set_aside_gap_cents"] == 70_000


def test_the_same_versement_seen_on_both_accounts_is_counted_once(client):
    headers = _register(client)
    account_id = _account(client, headers)
    livret = _account(client, headers, "Livret A", "savings")
    epargne = _category(client, headers, "epargne")
    _post(client, headers, account_id, amount_cents=-30_000, category_id=epargne)
    _post(client, headers, livret, amount_cents=30_000, label_raw="VIREMENT RECU",
          category_id=epargne)

    body = client.get("/api/analytics/summary", headers=headers).json()

    assert body["set_aside_cents"] == 30_000


def test_a_month_that_set_nothing_aside_says_zero(client):
    headers = _register(client)
    account_id = _account(client, headers)
    _post(client, headers, account_id, amount_cents=-8_450, label_raw="SUPERMARCHE",
          category_id=_category(client, headers, "alimentation-courses"))

    body = client.get("/api/analytics/summary", headers=headers).json()

    assert body["set_aside_cents"] == 0
    assert body["set_aside_gap_cents"] == -8_450


def test_set_aside_is_never_added_to_the_net(client):
    """The double-count this whole change exists to avoid. The net counts the
    euro once by NOT spending it; set-aside says where it went."""
    headers = _register(client)
    account_id = _account(client, headers)
    _post(client, headers, account_id, amount_cents=200_000, label_raw="SALAIRE",
          category_id=_category(client, headers, "revenus-salaire"))
    _post(client, headers, account_id, amount_cents=-50_000,
          category_id=_category(client, headers, "epargne"))

    body = client.get("/api/analytics/summary", headers=headers).json()

    assert body["net_cents"] == 200_000
    assert body["net_cents"] != body["net_cents"] + body["set_aside_cents"]


# --- Import runs the rule too -----------------------------------------------

def test_an_imported_statement_line_is_marked_like_any_other(client, db):
    headers = _register(client)
    livret = _account(client, headers, "Livret A", "savings")
    csv = b"date;libelle;montant\n05/03/2025;ZZQXJ VERSEMENT RECU;300,00\n"

    preview = client.post(
        "/api/imports/analyze", headers=headers,
        files={"file": ("releve.csv", csv, "text/csv")},
        data={"account_id": str(livret)},
    ).json()
    committed = client.post("/api/imports/commit", headers=headers, json={
        "upload_token": preview["upload_token"],
        "account_id": livret,
        "dialect": preview["dialect"],
        "mapping": preview["suggested_mapping"],
        "original_filename": preview["original_filename"],
        "overrides": {},
        "keep_duplicates": [],
    })
    assert committed.status_code == 201, committed.json()

    rows = db.query(Transaction).all()
    assert len(rows) == 1
    assert rows[0].is_transfer is True
    assert rows[0].transfer_source == "auto"


# --- The back door: a learned rule refiling old rows -------------------------

def test_a_learned_rule_that_refiles_old_rows_re_decides_their_transfer_flag(client, db):
    """The one path that changes a category without going through the PATCH
    route. Without it, correcting one row into « Épargne et investissement »
    would teach a rule, quietly refile a dozen past rows, and leave every one of
    them counted as spending -- the exact failure this whole change exists to
    remove, reintroduced by the back door."""
    headers = _register(client)
    account_id = _account(client, headers)
    for day in ("05", "12", "19"):
        _post(client, headers, account_id, date=f"2025-03-{day}",
              label_raw="VIR PERMANENT LIVRET BLEU")
    rows = client.get("/api/transactions", headers=headers).json()["items"]
    assert [row["is_transfer"] for row in rows] == [False, False, False]

    # One correction, which teaches a rule and backfills the other two.
    patched = client.patch(f"/api/transactions/{rows[0]['id']}", headers=headers, json={
        "category_id": _category(client, headers, "epargne")}).json()
    assert patched["backfilled"] >= 1

    db.expire_all()
    every = db.query(Transaction).all()
    assert [row.is_transfer for row in every] == [True, True, True]
    assert {row.transfer_source for row in every} == {"auto"}
