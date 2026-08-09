import time

import pytest

from app.security.crypto import decrypt_secret, encrypt_secret
from app.security.passwords import hash_password, verify_password
from app.security.tokens import TokenError, create_access_token, create_refresh_token, decode_token


def test_password_hash_is_argon2id_and_verifies():
    hashed = hash_password("correct horse battery staple")
    assert hashed.startswith("$argon2id$")
    assert verify_password("correct horse battery staple", hashed) is True
    assert verify_password("wrong password", hashed) is False


def test_password_hash_is_salted_per_call():
    assert hash_password("same") != hash_password("same")


def test_access_token_round_trips_user_id():
    token = create_access_token(42)
    assert decode_token(token, expected_type="access") == 42


def test_access_token_rejected_when_used_as_refresh():
    token = create_access_token(42)
    with pytest.raises(TokenError):
        decode_token(token, expected_type="refresh")


def test_refresh_token_round_trips_user_id():
    assert decode_token(create_refresh_token(7), expected_type="refresh") == 7


def test_tampered_token_is_rejected():
    token = create_access_token(1)
    with pytest.raises(TokenError):
        decode_token(token[:-3] + "aaa", expected_type="access")


def test_expired_token_is_rejected(monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "access_token_minutes", 0)
    token = create_access_token(1)
    time.sleep(1.1)
    with pytest.raises(TokenError):
        decode_token(token, expected_type="access")


def test_secret_round_trips_and_ciphertext_differs_from_plaintext():
    blob = encrypt_secret("finnhub-key-abc123")
    assert blob != "finnhub-key-abc123"
    assert decrypt_secret(blob) == "finnhub-key-abc123"
