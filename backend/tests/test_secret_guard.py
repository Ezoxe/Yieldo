"""An instance people use never runs on the public default secret."""

import logging

import pytest

from app.security.secret_guard import DEFAULT_SECRET, check_secret, secret_problem

GOOD = "0123456789abcdef" * 4


def test_a_generated_secret_passes():
    assert secret_problem(GOOD) is None


def test_the_default_and_a_short_secret_are_problems():
    assert secret_problem(DEFAULT_SECRET) is not None
    assert secret_problem("court") is not None
    assert secret_problem("x" * 31) is not None


def test_an_instance_serving_the_interface_refuses_to_start_without_a_secret():
    with pytest.raises(RuntimeError, match="lancez ./install.sh install"):
        check_secret(DEFAULT_SECRET, serves_interface=True)


def test_a_development_server_only_warns(caplog):
    with caplog.at_level(logging.WARNING):
        check_secret(DEFAULT_SECRET, serves_interface=False)
    assert "install.sh" in caplog.text


def test_a_good_secret_is_silent_everywhere(caplog):
    with caplog.at_level(logging.WARNING):
        check_secret(GOOD, serves_interface=True)
    assert caplog.text == ""


def test_the_guard_knows_the_configured_default():
    from app.config import Settings

    assert Settings.model_fields["secret_key"].default == DEFAULT_SECRET
