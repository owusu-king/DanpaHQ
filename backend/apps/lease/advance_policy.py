"""How much rent may be taken in advance.

This is the single most consequential term in a Ghanaian tenancy. The Rent Act
1963 (Act 220) is generally read as limiting advance rent on a monthly tenancy
to six months; in practice one and two year advances are routine, and a tenant
who cannot pay two years up front simply does not get the room.

### What this module does and does not decide

It does **not** determine what the law requires. Whether Act 220 applies to a
given tenancy, whether it has been amended or superseded, and what the
consequences of exceeding it are, are questions for a Ghanaian lawyer. Nothing
here should be shown to a user as legal advice, and the wording of every
message below needs that review before launch - see
``docs/known-limitations.md``.

What it does is make the *product's* stance an explicit, configurable decision
rather than a number buried in a comparison:

* ``allow``  - record what was agreed, say nothing.
* ``warn``   - record it, state the threshold plainly to both parties, and keep
               the acknowledgement. **The default**, because it is the only
               stance that is safe while the legal position is unconfirmed: it
               informs without refusing a lease the law may well permit.
* ``block``  - refuse to execute the agreement.

``block`` exists so that an operator who has taken legal advice can act on it
without a code change. It is deliberately not the default: refusing leases on an
unconfirmed reading of a statute would impose a legal interpretation this
codebase is not entitled to make, and would do it to the party with less power.

Configure with, in settings::

    RENT_ADVANCE_POLICY = {"stance": "warn", "threshold_months": 6}
"""

from __future__ import annotations

from dataclasses import dataclass

from django.conf import settings

#: The threshold the product states. Named, and configurable, so that the
#: reason it is six survives - and so that changing it is an operator decision
#: rather than an edit to a comparison.
DEFAULT_THRESHOLD_MONTHS = 6
DEFAULT_STANCE = "warn"

ALLOW = "allow"
WARN = "warn"
BLOCK = "block"

STANCES = (ALLOW, WARN, BLOCK)


@dataclass(frozen=True)
class AdvanceAssessment:
    """What the policy says about one lease's advance, and why."""

    stance: str
    months: int
    threshold_months: int
    exceeds: bool
    message: str = ""

    @property
    def blocks(self) -> bool:
        return self.stance == BLOCK and self.exceeds

    @property
    def requires_acknowledgement(self) -> bool:
        """Whether the parties must be shown this and confirm they read it."""
        return self.stance == WARN and self.exceeds


def configured() -> tuple[str, int]:
    """The operator's stance and threshold, with the safe defaults."""
    raw = getattr(settings, "RENT_ADVANCE_POLICY", None) or {}

    stance = str(raw.get("stance", DEFAULT_STANCE)).lower()
    if stance not in STANCES:
        # A typo in configuration must not silently disable the warning, and
        # must not silently start blocking leases either.
        stance = DEFAULT_STANCE

    try:
        threshold = int(raw.get("threshold_months", DEFAULT_THRESHOLD_MONTHS))
    except (TypeError, ValueError):
        threshold = DEFAULT_THRESHOLD_MONTHS
    if threshold < 0:
        threshold = DEFAULT_THRESHOLD_MONTHS

    return stance, threshold


def assess(*, advance_months: int, rent_period: str = "monthly") -> AdvanceAssessment:
    """Judge an advance against the configured policy.

    The threshold is stated for monthly tenancies. A yearly or weekly rent means
    "six months of advance" does not have the same meaning, and rather than
    guess at a conversion this returns `allow` - the product declines to make a
    claim it cannot support.
    """
    stance, threshold = configured()
    months = int(advance_months or 0)

    if rent_period != "monthly":
        return AdvanceAssessment(
            stance=ALLOW, months=months, threshold_months=threshold, exceeds=False
        )

    exceeds = months > threshold
    if not exceeds or stance == ALLOW:
        return AdvanceAssessment(
            stance=stance, months=months, threshold_months=threshold, exceeds=exceeds
        )

    # Phrased as what this agreement says against a stated threshold. It does
    # not tell either party what the law entitles them to, or what will happen
    # to them - because this codebase does not know.
    noun = "month" if threshold == 1 else "months"
    message = (
        f"This agreement asks for {months} months' rent in advance. "
        f"The Rent Act 1963 (Act 220) is generally understood to limit advance "
        f"rent on a monthly tenancy to {threshold} {noun}. "
        "This is not legal advice - if it matters to you, take advice on it "
        "before you pay."
    )
    if stance == BLOCK:
        message = (
            f"This agreement asks for {months} months' rent in advance, which is "
            f"more than the {threshold} {noun} this platform accepts."
        )

    return AdvanceAssessment(
        stance=stance,
        months=months,
        threshold_months=threshold,
        exceeds=True,
        message=message,
    )
