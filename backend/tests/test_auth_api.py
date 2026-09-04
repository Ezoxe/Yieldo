def test_first_registered_user_becomes_admin(client):
    response = client.post("/api/auth/register", json={
        "name": "Max", "email": "max@example.com", "password": "motdepasse123"})
    assert response.status_code == 201
    assert response.json()["user"]["role"] == "admin"


def test_second_registered_user_is_not_admin(client):
    client.post("/api/auth/register", json={
        "name": "Max", "email": "max@example.com", "password": "motdepasse123"})
    response = client.post("/api/auth/register", json={
        "name": "Lea", "email": "lea@example.com", "password": "motdepasse123"})
    assert response.json()["user"]["role"] == "user"


def test_register_seeds_categories_for_the_new_user(client, db):
    from app.models import Category, User

    client.post("/api/auth/register", json={
        "name": "Max", "email": "max@example.com", "password": "motdepasse123"})
    user = db.query(User).filter(User.email == "max@example.com").one()
    slugs = {c.slug for c in db.query(Category).filter(Category.user_id == user.id).all()}
    assert {"alimentation", "alimentation-courses", "revenus-salaire"} <= slugs


def test_register_rejects_duplicate_email(client):
    payload = {"name": "Max", "email": "max@example.com", "password": "motdepasse123"}
    client.post("/api/auth/register", json=payload)
    response = client.post("/api/auth/register", json=payload)
    assert response.status_code == 409
    assert "existe déjà" in response.json()["detail"]


def test_register_rejects_short_password(client):
    response = client.post("/api/auth/register", json={
        "name": "Max", "email": "max@example.com", "password": "court"})
    assert response.status_code == 422


def test_login_returns_access_token_and_refresh_cookie(client):
    client.post("/api/auth/register", json={
        "name": "Max", "email": "max@example.com", "password": "motdepasse123"})
    response = client.post("/api/auth/login", json={
        "email": "MAX@example.com", "password": "motdepasse123"})
    assert response.status_code == 200
    assert response.json()["access_token"]
    assert "yieldo_refresh" in response.cookies


def test_login_rejects_wrong_password_without_leaking_which_field(client):
    client.post("/api/auth/register", json={
        "name": "Max", "email": "max@example.com", "password": "motdepasse123"})
    response = client.post("/api/auth/login", json={
        "email": "max@example.com", "password": "mauvais-mot-de-passe"})
    assert response.status_code == 401
    assert response.json()["detail"] == "Identifiants invalides"


def test_login_rejects_unknown_email_with_identical_message(client):
    response = client.post("/api/auth/login", json={
        "email": "inconnu@example.com", "password": "motdepasse123"})
    assert response.status_code == 401
    assert response.json()["detail"] == "Identifiants invalides"


def test_me_requires_authentication(client):
    assert client.get("/api/auth/me").status_code == 401


def test_me_returns_the_authenticated_user(client):
    registered = client.post("/api/auth/register", json={
        "name": "Max", "email": "max@example.com", "password": "motdepasse123"}).json()
    response = client.get("/api/auth/me", headers={
        "Authorization": f"Bearer {registered['access_token']}"})
    assert response.json()["email"] == "max@example.com"


def test_refresh_token_cannot_be_used_as_access_token(client):
    client.post("/api/auth/register", json={
        "name": "Max", "email": "max@example.com", "password": "motdepasse123"})
    login = client.post("/api/auth/login", json={
        "email": "max@example.com", "password": "motdepasse123"})
    refresh = login.cookies["yieldo_refresh"]
    response = client.get("/api/auth/me", headers={"Authorization": f"Bearer {refresh}"})
    assert response.status_code == 401


def test_refresh_issues_a_new_access_token(client):
    client.post("/api/auth/register", json={
        "name": "Max", "email": "max@example.com", "password": "motdepasse123"})
    client.post("/api/auth/login", json={
        "email": "max@example.com", "password": "motdepasse123"})
    response = client.post("/api/auth/refresh")
    assert response.status_code == 200
    assert response.json()["access_token"]


def test_registration_can_be_closed(client, monkeypatch):
    from app.config import settings

    client.post("/api/auth/register", json={
        "name": "Max", "email": "max@example.com", "password": "motdepasse123"})
    monkeypatch.setattr(settings, "registration_open", False)
    response = client.post("/api/auth/register", json={
        "name": "Lea", "email": "lea@example.com", "password": "motdepasse123"})
    assert response.status_code == 403


def test_login_unknown_email_and_wrong_password_do_equal_argon2_work(client, monkeypatch):
    """Regression test for the timing-oracle bug fixed in this round.

    The old code hashed a fresh dummy password with Argon2 on the unknown-email path
    *in addition to* the verification both paths already run -- so an unknown email
    cost two Argon2 operations and a known email with a wrong password cost one. That
    is a measurable, reproducible difference (not a flaky wall-clock one), so it is
    asserted here as an operation count rather than a timing measurement: wrap both
    `hash_password` and `verify_password` as used by `app.api.auth` with counters and
    assert an unknown-email login and a wrong-password login perform the same total
    number of Argon2 operations. This fails against the old per-request-hash version
    (2 ops vs 1 op) and passes against the fixed, precomputed-dummy version (1 vs 1).
    """
    import app.api.auth as auth_module

    client.post("/api/auth/register", json={
        "name": "Max", "email": "max@example.com", "password": "motdepasse123"})

    real_hash_password = auth_module.hash_password
    real_verify_password = auth_module.verify_password
    counts = {"hash": 0, "verify": 0}

    def counting_hash_password(password):
        counts["hash"] += 1
        return real_hash_password(password)

    def counting_verify_password(password, hashed):
        counts["verify"] += 1
        return real_verify_password(password, hashed)

    monkeypatch.setattr(auth_module, "hash_password", counting_hash_password)
    monkeypatch.setattr(auth_module, "verify_password", counting_verify_password)

    counts["hash"] = counts["verify"] = 0
    response = client.post("/api/auth/login", json={
        "email": "inconnu@example.com", "password": "motdepasse123"})
    assert response.status_code == 401
    unknown_email_ops = counts["hash"] + counts["verify"]

    counts["hash"] = counts["verify"] = 0
    response = client.post("/api/auth/login", json={
        "email": "max@example.com", "password": "mauvais-mot-de-passe"})
    assert response.status_code == 401
    wrong_password_ops = counts["hash"] + counts["verify"]

    assert unknown_email_ops == wrong_password_ops
    assert unknown_email_ops == 1


def test_admin_role_is_granted_exactly_once_across_sequential_registrations(client, db):
    """Regression test for the TOCTOU admin race fixed in this round.

    A genuine concurrent-threads reproduction was deliberately not used here: the
    `db`/`client` fixtures (see conftest.py) bind the whole test to a single
    StaticPool SQLite connection shared by every session, which is what lets
    TestClient's worker threads see the same in-memory database. Two Python threads
    issuing `BEGIN IMMEDIATE` against that same single DBAPI connection object would
    not exercise SQLite's real inter-connection write-lock semantics -- it would only
    probe the stdlib sqlite3 module's own single-connection thread handling, which is
    a different and flakier thing to assert on, unrelated to the fix. This test
    instead locks in the invariant the guard exists to protect: however many
    registrations happen, exactly one user ends up admin.
    """
    from app.models import User

    client.post("/api/auth/register", json={
        "name": "Max", "email": "max@example.com", "password": "motdepasse123"})
    client.post("/api/auth/register", json={
        "name": "Lea", "email": "lea@example.com", "password": "motdepasse123"})

    admins = db.query(User).filter(User.role == "admin").count()
    assert admins == 1


# -- Account management -------------------------------------------------------
#
# The operator has to be able to change their own name, email and password
# without editing the database by hand. All three live under /auth because the
# session is what they alter: an email change moves the identity a login is
# looked up by, and a password change invalidates the only secret there is.


def _registered(client, password="motdepasse123"):
    """A registered user and the Authorization header for them."""
    response = client.post("/api/auth/register", json={
        "name": "Max", "email": "max@example.com", "password": password})
    token = response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_profile_update_requires_authentication(client):
    assert client.patch("/api/auth/me", json={"name": "Max"}).status_code == 401


def test_profile_update_changes_the_name(client):
    headers = _registered(client)

    response = client.patch("/api/auth/me", json={"name": "Maxime"}, headers=headers)

    assert response.status_code == 200
    assert response.json()["name"] == "Maxime"
    assert client.get("/api/auth/me", headers=headers).json()["name"] == "Maxime"


def test_profile_update_changes_the_email_and_the_login_follows_it(client):
    headers = _registered(client)

    response = client.patch("/api/auth/me", json={"email": "Nouveau@Example.com"},
                            headers=headers)

    assert response.status_code == 200
    # Normalised on the way in, exactly as registration does it.
    assert response.json()["email"] == "nouveau@example.com"
    assert client.post("/api/auth/login", json={
        "email": "nouveau@example.com", "password": "motdepasse123"}).status_code == 200
    assert client.post("/api/auth/login", json={
        "email": "max@example.com", "password": "motdepasse123"}).status_code == 401


def test_profile_update_refuses_an_email_another_account_already_uses(client):
    client.post("/api/auth/register", json={
        "name": "Lea", "email": "lea@example.com", "password": "motdepasse123"})
    headers = _registered(client)

    response = client.patch("/api/auth/me", json={"email": "lea@example.com"},
                            headers=headers)

    assert response.status_code == 409
    assert "existe déjà" in response.json()["detail"]


def test_profile_update_accepts_the_email_the_account_already_has(client):
    """Re-submitting an unchanged form is not a conflict with oneself."""
    headers = _registered(client)

    response = client.patch("/api/auth/me", json={"email": "max@example.com"},
                            headers=headers)

    assert response.status_code == 200


def test_profile_update_refuses_a_blank_name(client):
    headers = _registered(client)

    assert client.patch("/api/auth/me", json={"name": "   "},
                        headers=headers).status_code == 422


def test_profile_update_with_nothing_to_change_leaves_the_account_alone(client):
    headers = _registered(client)

    response = client.patch("/api/auth/me", json={}, headers=headers)

    assert response.status_code == 200
    assert response.json()["name"] == "Max"
    assert response.json()["email"] == "max@example.com"


def test_password_change_requires_authentication(client):
    response = client.post("/api/auth/password", json={
        "current_password": "motdepasse123", "new_password": "nouveaumotdepasse"})
    assert response.status_code == 401


def test_password_change_replaces_the_password(client):
    headers = _registered(client)

    response = client.post("/api/auth/password", json={
        "current_password": "motdepasse123",
        "new_password": "nouveaumotdepasse"}, headers=headers)

    assert response.status_code == 204
    assert client.post("/api/auth/login", json={
        "email": "max@example.com", "password": "nouveaumotdepasse"}).status_code == 200
    assert client.post("/api/auth/login", json={
        "email": "max@example.com", "password": "motdepasse123"}).status_code == 401


def test_password_change_refuses_a_wrong_current_password(client):
    headers = _registered(client)

    response = client.post("/api/auth/password", json={
        "current_password": "paslebon", "new_password": "nouveaumotdepasse"},
        headers=headers)

    assert response.status_code == 403
    assert "actuel" in response.json()["detail"]
    # And the old password still works, which is the point of refusing.
    assert client.post("/api/auth/login", json={
        "email": "max@example.com", "password": "motdepasse123"}).status_code == 200


def test_password_change_refuses_a_short_new_password(client):
    headers = _registered(client)

    response = client.post("/api/auth/password", json={
        "current_password": "motdepasse123", "new_password": "court"}, headers=headers)

    assert response.status_code == 422


def test_password_change_refuses_the_password_already_in_use(client):
    """Not a validation nicety: a form that reports success without changing
    anything teaches the operator that the button does nothing."""
    headers = _registered(client)

    response = client.post("/api/auth/password", json={
        "current_password": "motdepasse123", "new_password": "motdepasse123"},
        headers=headers)

    assert response.status_code == 422
    assert "différent" in response.json()["detail"]
