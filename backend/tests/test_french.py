"""French agreement: zero and one take the singular, two and more the plural."""

from app.french import counted, plural


def test_zero_and_one_take_the_singular():
    assert plural(0, "ligne", "lignes") == "ligne"
    assert plural(1, "ligne", "lignes") == "ligne"


def test_two_and_more_take_the_plural():
    assert plural(2, "ligne", "lignes") == "lignes"
    assert plural(120, "ligne", "lignes") == "lignes"


def test_counted_writes_the_figure_and_the_agreed_form():
    assert counted(0, "ordre transmis", "ordres transmis") == "0 ordre transmis"
    assert counted(3, "refusé par le mandat", "refusés par le mandat") == "3 refusés par le mandat"
