"""What a search box's raw text actually means, before any SQL is written."""

from datetime import date

from app.engines.search import parse_query


def test_plain_text_carries_through_with_no_number_and_no_date() -> None:
    terms = parse_query("carrefour market")
    assert terms.text == "carrefour market"
    assert terms.amount_cents is None
    assert terms.on_date is None


def test_a_whole_number_is_read_as_euros() -> None:
    assert parse_query("12").amount_cents == 1200


def test_a_comma_decimal_is_read_as_euros_and_centimes() -> None:
    assert parse_query("12,50").amount_cents == 1250


def test_a_dot_decimal_is_read_the_same_way() -> None:
    assert parse_query("12.50").amount_cents == 1250


def test_a_currency_sign_and_spaces_do_not_stop_the_reading() -> None:
    assert parse_query("  12,50 €  ").amount_cents == 1250


def test_a_sign_is_dropped_because_the_search_is_on_the_size() -> None:
    # A household looking for "45,90" means the 45,90 they spent; the ledger
    # stores it negative. Matching on the absolute value is the only reading
    # that finds it.
    assert parse_query("-45.90").amount_cents == 4590


def test_a_thousands_space_is_read_as_one_number() -> None:
    assert parse_query("1 200,00").amount_cents == 120000


def test_a_third_decimal_is_not_a_money_amount() -> None:
    assert parse_query("12.505").amount_cents is None


def test_words_are_not_an_amount() -> None:
    assert parse_query("abc").amount_cents is None


def test_a_number_inside_a_sentence_is_not_the_amount() -> None:
    # "carte 12" is a label fragment, not a search for 12,00 €.
    assert parse_query("carte 12").amount_cents is None


def test_an_iso_date_is_read_as_a_date() -> None:
    assert parse_query("2026-03-12").on_date == date(2026, 3, 12)


def test_a_french_date_is_read_as_a_date() -> None:
    assert parse_query("12/03/2026").on_date == date(2026, 3, 12)


def test_a_french_date_keeps_its_text_so_the_label_is_still_searched() -> None:
    terms = parse_query("12/03/2026")
    assert terms.text == "12/03/2026"


def test_an_impossible_date_is_not_a_date() -> None:
    assert parse_query("32/03/2026").on_date is None


def test_a_date_is_never_also_an_amount() -> None:
    assert parse_query("2026-03-12").amount_cents is None


def test_an_empty_query_carries_nothing() -> None:
    terms = parse_query("   ")
    assert terms.text == ""
    assert terms.amount_cents is None
    assert terms.on_date is None
