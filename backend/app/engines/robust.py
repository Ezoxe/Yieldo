"""Robust centre and scale, in integer cents.

Every "statistical deviation" in Yieldo goes through this module. The design
brief is explicit that the method must be robust -- median and median absolute
deviation -- so that a single 500 EUR purchase does not redefine what a normal
week costs, and that there are to be no arbitrary thresholds.

The constants below are therefore not tuned; they are the published ones:

* the modified z-score and its 0.6745 / 1.253314 constants, and the 3.5 cutoff,
  are Iglewicz & Hoaglin, *How to Detect and Handle Outliers* (ASQC Basic
  References in Quality Control, vol. 16, 1993);
* 1.4826 is the standard consistency factor making the MAD an unbiased
  estimator of the standard deviation under normality, and 1.2533 the same
  factor for the mean absolute deviation;
* 1.281552 is the standard normal 90th percentile, used to turn a scale into a
  P10/P90 band.

Pure: no session, no network, no clock.
"""

from dataclasses import dataclass

# Modified z-score, Iglewicz & Hoaglin. The MAD form is the primary one; the
# mean-absolute-deviation form is their documented fallback for samples whose
# MAD is zero -- which is the normal case for a subscription billed at the
# same amount every month.
MODIFIED_Z_MAD_CONSTANT = 0.6745
MODIFIED_Z_MEAN_AD_CONSTANT = 1.253314

# A value beyond this is an outlier. Their recommendation, not a tuned knob.
OUTLIER_Z = 3.5

# Consistency factors turning a robust dispersion into a normal-equivalent
# standard deviation.
MAD_TO_SIGMA = 1.4826
MEAN_AD_TO_SIGMA = 1.2533

# Standard normal 90th percentile: sigma * this is the half-width of a P10/P90
# band around the median.
P90_SIGMAS = 1.281552


def _half(total: int) -> int:
    """`total / 2`, rounded half away from zero, staying in integer cents.

    Floor division would bias a series of expenses (all negative) one way and a
    series of incomes the other, which is exactly the kind of silent asymmetry
    the money rule exists to prevent.
    """
    quotient, remainder = divmod(abs(total), 2)
    magnitude = quotient + remainder
    return magnitude if total >= 0 else -magnitude


def median_cents(values: list[int]) -> int:
    """The median of a sample of integer cents.

    Raises rather than returning zero on an empty sample: "no data" and "zero
    euros" are different answers, and a fallback value standing in for real
    data is precisely what the no-silent-failures rule forbids.
    """
    if not values:
        raise ValueError("La médiane d'une série vide n'existe pas")
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2 == 1:
        return ordered[middle]
    return _half(ordered[middle - 1] + ordered[middle])


def _mean_absolute(deviations: list[int]) -> int:
    """Mean of non-negative deviations, rounded half up, in integer cents."""
    count = len(deviations)
    return (sum(deviations) * 2 + count) // (2 * count)


@dataclass(frozen=True)
class Spread:
    """A robust centre and scale. Every field is in the unit of the input."""

    median: int
    mad: int
    mean_ad: int
    # Normal-equivalent standard deviation. 0 means the sample never moves --
    # not "we could not measure it", which is what `count` is for.
    sigma: int
    count: int


def describe(values: list[int]) -> Spread:
    if not values:
        raise ValueError("Impossible de décrire une série vide")
    centre = median_cents(values)
    deviations = [abs(value - centre) for value in values]
    mad = median_cents(deviations)
    mean_ad = _mean_absolute(deviations)
    if mad:
        sigma = round(MAD_TO_SIGMA * mad)
    elif mean_ad:
        sigma = round(MEAN_AD_TO_SIGMA * mean_ad)
    else:
        sigma = 0
    return Spread(median=centre, mad=mad, mean_ad=mean_ad, sigma=sigma, count=len(values))


def modified_z(value: int, spread: Spread) -> float | None:
    """How far `value` sits from the sample's centre, in robust deviations.

    `None` when the sample carries no dispersion at all: with every observation
    identical there is no scale to measure against, and any number returned
    here would be manufactured. Callers must treat `None` as "cannot say",
    never as zero.
    """
    if spread.mad:
        return MODIFIED_Z_MAD_CONSTANT * (value - spread.median) / spread.mad
    if spread.mean_ad:
        return (value - spread.median) / (MODIFIED_Z_MEAN_AD_CONSTANT * spread.mean_ad)
    return None


def quantile_offset_cents(sigma: int, sigmas: float = P90_SIGMAS) -> int:
    """Half-width, in integer cents, of a band `sigmas` standard deviations wide."""
    return round(sigma * sigmas)
