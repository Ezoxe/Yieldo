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
