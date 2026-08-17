import pytest

from app.engines.robust import (
    OUTLIER_Z,
    P90_SIGMAS,
    describe,
    median_cents,
    modified_z,
    quantile_offset_cents,
)


def test_median_of_an_odd_sample_is_the_middle_value():
    assert median_cents([300, 100, 200]) == 200


def test_median_of_an_even_sample_rounds_half_away_from_zero():
    """Cents are integers. 100.5 rounds to 101, and -100.5 to -101 -- never
    toward zero on one side and away on the other, which would bias a series of
    expenses upward and a series of incomes downward."""
    assert median_cents([100, 101]) == 101
    assert median_cents([-100, -101]) == -101


def test_median_of_an_empty_sample_is_an_error_not_a_zero():
    with pytest.raises(ValueError):
        median_cents([])


def test_describe_of_an_empty_sample_is_an_error_not_a_zero():
    with pytest.raises(ValueError):
        describe([])


def test_describe_reports_median_mad_and_a_normal_equivalent_scale():
    spread = describe([1000, 1100, 1200, 1300, 1400])
    assert spread.count == 5
    assert spread.median == 1200
    # deviations: 200, 100, 0, 100, 200 -> median 100
    assert spread.mad == 100
    assert spread.mean_ad == 120
    assert spread.sigma == round(1.4826 * 100)


def test_an_extreme_value_does_not_move_the_centre():
    """The whole point of the median: one 500 EUR outlier must not redefine
    what a normal week costs."""
    normal = describe([1000, 1100, 1200, 1300, 1400])
    with_outlier = describe([1000, 1100, 1200, 1300, 1400, 50000])
    assert with_outlier.median == 1250
    assert abs(with_outlier.median - normal.median) < 100


def test_modified_z_flags_a_clear_outlier():
    values = [1000, 1050, 1100, 1150, 1200, 1100, 1050, 1150, 1100, 1000]
    spread = describe(values)
    assert modified_z(1100, spread) == pytest.approx(0.0, abs=0.5)
    assert modified_z(50000, spread) > OUTLIER_Z


def test_modified_z_falls_back_to_the_mean_deviation_when_the_mad_is_zero():
    """A subscription billed at exactly the same amount most months has a MAD of
    zero, and dividing by it would raise. Iglewicz & Hoaglin's own documented
    alternative is the mean absolute deviation with the 1.253314 constant --
    not an invented threshold."""
    values = [1549, 1549, 1549, 1549, 1549, 1549, 1549, 1549, 1549, 1999]
    spread = describe(values)
    assert spread.mad == 0
    assert spread.mean_ad > 0
    assert modified_z(1999, spread) > OUTLIER_Z


def test_modified_z_is_none_when_the_sample_never_moves():
    """Ten identical amounts carry no scale. No value can be called an outlier
    against them, and returning a number here would be inventing one."""
    spread = describe([1549] * 10)
    assert spread.mad == 0
    assert spread.mean_ad == 0
    assert modified_z(9999, spread) is None


def test_quantile_offset_is_an_integer_number_of_cents():
    offset = quantile_offset_cents(10000)
    assert isinstance(offset, int)
    assert offset == round(10000 * P90_SIGMAS)
