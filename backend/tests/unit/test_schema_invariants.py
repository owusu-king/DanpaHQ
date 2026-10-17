"""Schema invariants, checked by reading the model source.

These run without a database because they answer a design question, not a
runtime one: does the schema still encode the rules we said it would? Every
assertion here corresponds to something that, if it silently disappeared in a
refactor, would be a security or correctness bug rather than a test failure.

They complement the integration tests rather than replacing them - those prove
the constraints work, these prove they are still declared.
"""

import ast
from pathlib import Path

APPS = Path(__file__).resolve().parents[2] / "apps"


def _source(app: str, module: str = "models.py") -> str:
    return (APPS / app / module).read_text()


def _class(app: str, name: str) -> ast.ClassDef:
    tree = ast.parse(_source(app))
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef) and node.name == name:
            return node
    raise AssertionError(f"{name} not found in {app}/models.py")


def _text_of(node: ast.AST) -> str:
    return ast.unparse(node)


class TestSensitiveDataIsNeverStoredInTheClear:
    def test_otp_codes_are_stored_only_as_hashes(self):
        source = _text_of(_class("identity", "AuthChallenge"))
        assert "code_hash" in source
        assert "code_salt" in source
        # A field literally holding the code would defeat the peppered hash.
        assert "code = models." not in source

    def test_refresh_tokens_are_stored_only_as_hashes(self):
        source = _text_of(_class("identity", "Session"))
        assert "refresh_token_hash" in source
        assert "refresh_token = models." not in source

    def test_national_id_is_stored_as_a_hash_and_last_four(self):
        source = _text_of(_class("identity", "Profile"))
        assert "national_id_hash" in source
        assert "national_id_last4" in source
        assert "national_id_number" not in source


class TestUniquenessRules:
    def test_phone_numbers_are_unique(self):
        """Without this one human can hold two accounts and rental history
        stops meaning anything."""
        source = _text_of(_class("identity", "User"))
        assert "phone = PhoneNumberField(unique=True)" in source

    def test_a_role_cannot_be_held_twice_while_active(self):
        source = _text_of(_class("identity", "UserRole"))
        assert "identity_unique_active_role" in source
        assert "revoked_at__isnull=True" in source

    def test_only_one_primary_role_at_a_time(self):
        source = _text_of(_class("identity", "UserRole"))
        assert "identity_single_primary_role" in source

    def test_one_device_row_per_fingerprint_per_user(self):
        assert "identity_unique_device" in _text_of(_class("identity", "Device"))

    def test_refresh_token_hashes_are_globally_unique(self):
        source = _text_of(_class("identity", "Session"))
        assert "refresh_token_hash = models.CharField(max_length=64, unique=True)" in source

    def test_only_one_live_verification_per_subject_and_kind(self):
        """Two approved identity checks on one person forces the UI to guess
        which is true, and the guess will be wrong at the worst moment."""
        source = _text_of(_class("trust", "Verification"))
        assert "trust_one_live_verification" in source


class TestVerificationIsNotABoolean:
    def test_a_verification_records_who_decided_and_when(self):
        source = _text_of(_class("trust", "Verification"))
        for field in ("decided_by", "decided_at", "expires_at", "method", "status"):
            assert field in source, f"verification must record {field}"

    def test_evidence_is_a_separate_table_with_provenance(self):
        source = _text_of(_class("trust", "VerificationEvidence"))
        for field in ("evidence_type", "collected_at", "collected_by", "checksum_at_attach"):
            assert field in source

    def test_evidence_refuses_deletion(self):
        assert "def delete" in _text_of(_class("trust", "VerificationEvidence"))

    def test_supersession_is_modelled_rather_than_overwriting(self):
        assert "supersedes" in _text_of(_class("trust", "Verification"))

    def test_expiry_is_computed_not_merely_stored(self):
        """display_state must not trust the stored status, or a stamp claims
        currency it lost between hourly sweeps."""
        source = _text_of(_class("trust", "Verification"))
        assert "def display_state" in source
        assert "is_current" in source


class TestForeignKeySafety:
    def test_no_cascade_from_verification_to_evidence_files(self):
        """A file deletion must not silently remove the evidence a dispute
        depends on."""
        source = _text_of(_class("trust", "VerificationEvidence"))
        assert "on_delete=models.PROTECT" in source

    def test_geography_is_protected_from_cascading_deletes(self):
        source = _source("geo")
        assert source.count("on_delete=models.PROTECT") >= 3


class TestAuditability:
    def test_audit_entries_refuse_modification_and_deletion(self):
        source = _text_of(_class("audit", "AuditLog"))
        assert "append-only" in source.lower()
        assert "def save" in source and "def delete" in source

    def test_the_audit_action_vocabulary_covers_identity_events(self):
        source = _source("audit")
        for action in ("LOGIN", "LOGIN_FAILED", "PERMISSION_CHANGE", "VERIFICATION_DECISION"):
            assert action in source


class TestPhase2SchemaInvariants:
    """Phase 2 — property, listing, files. AST-based so no Django setup needed."""

    def _src(self, app, filename="models.py"):
        return (APPS / app / filename).read_text()

    def test_listing_enforces_one_live_per_unit(self):
        assert "listing_one_live_per_unit" in self._src("listing")

    def test_listing_rent_is_not_a_float(self):
        """Rent must use MoneyField (BigInt minor units), never a FloatField or DecimalField."""
        src = self._src("listing")
        assert "MoneyField()" in src
        assert "rent = MoneyField()" in src

    def test_stored_file_is_usable_requires_both_conditions(self):
        """is_usable must check upload_status AND scan_status — one alone is not enough."""
        src = self._src("files")
        # Find the is_usable property body (use a larger window to capture the return line)
        idx = src.find("def is_usable")
        snippet = src[idx : idx + 600]
        assert "upload_status" in snippet, "is_usable must check upload_status"
        assert "scan_status" in snippet, "is_usable must check scan_status"

    def test_upload_key_cannot_be_influenced_by_client_filename(self):
        """build_key must derive the key from the purpose and owner, never from
        the client-supplied filename."""
        src = (APPS / "files" / "services.py").read_text()
        # Check the function signature line only: find the first line of build_key
        idx = src.find("def build_key(")
        sig_line = src[idx : src.index(")", idx) + 1]
        # "filename" must not be a parameter — it can appear in the docstring
        assert "filename" not in sig_line, f"build_key signature must not take filename: {sig_line}"

    def test_property_type_has_controlled_vocabulary(self):
        src = self._src("property")
        assert "class PropertyType(models.TextChoices)" in src
        assert "APARTMENT" in src and "HOUSE" in src

    def test_listing_advance_months_is_a_dedicated_field(self):
        """Must be a proper column, not buried in a notes text field."""
        src = self._src("listing")
        assert "advance_months = models." in src
        assert "agency_fee_months = models." in src
        assert "caution_months = models." in src

    def test_listing_media_enforces_one_cover(self):
        src = self._src("listing")
        assert "listing_one_cover" in src

    def test_stored_file_has_upload_lifecycle(self):
        src = self._src("files")
        assert "awaiting_upload" in src
        assert "upload_expires_at" in src

    def test_no_public_download_path_exists(self):
        """There must be no route that produces an unsigned URL for a file.
        Every download goes through a permission check first."""
        views_src = (APPS / "files" / "views.py").read_text()
        assert "AllowAny" not in views_src.split("class FileDownloadView")[1][:200]


class TestPhase4PropertyAccessInvariants:
    def test_organization_membership_is_time_bounded_and_unique_while_active(self):
        source = _text_of(_class("organization", "OrganizationMembership"))
        assert "ended_at" in source
        assert "org_unique_active_membership" in source

    def test_property_assignments_are_resource_scoped(self):
        source = _text_of(_class("organization", "PropertyAssignment"))
        assert "membership" in source
        assert "property" in source
        assert "ended_at" in source

    def test_invitation_stores_only_a_token_hash(self):
        source = _text_of(_class("occupancy", "PropertyInvitation"))
        assert "token_hash" in source
        assert "token = models." not in source

    def test_occupancy_keeps_optional_hostel_bed_separate_from_unit(self):
        source = _text_of(_class("occupancy", "Occupancy"))
        assert "unit" in source
        assert "bed" in source

    def test_occupancy_is_guarded_by_period_not_by_a_flag(self):
        """P1 replaced `occupancy_unique_active_bed` with range exclusion.

        The old constraint asked "is this ended", which refused two bookings of
        one bed for different months and accepted two overlapping ones. This
        pins the shape of the fix rather than a constraint name, so the next
        change to it fails for a reason worth reading.
        """
        source = _text_of(_class("occupancy", "Occupancy"))

        assert "ExclusionConstraint" in source
        assert "occupancy_no_overlapping_unit_allocation" in source
        assert "occupancy_no_overlapping_bed_allocation" in source
        assert "RangeOperators.OVERLAPS" in source
        # The flag-based constraint must not come back alongside them.
        assert "occupancy_unique_active_bed" not in source


def test_production_refuses_to_send_an_unreviewed_lease_template():
    """The release gate the legal brief promises must actually be closed.

    Every lifecycle test runs against a template marked
    `requires_ghana_legal_review`, which is correct for development — the
    workflow has to be exercisable before counsel approves wording. Production
    is the environment where that must be impossible, and a default of False in
    `base.py` means the guarantee lives entirely in this one line.
    """
    from pathlib import Path

    production = Path(__file__).resolve().parents[2] / "config/settings/production.py"
    assert "LEASE_TEMPLATE_REQUIRE_APPROVAL = True" in production.read_text(encoding="utf-8")


def test_production_never_ships_a_payment_adapter_by_default():
    """Checkout stays unavailable until somebody configures it deliberately.

    Two separate properties, and each has been true only because one line says
    so: production defaults `PAYMENT_BACKEND` to empty, and it refuses the
    signed test adapter outright. An empty backend returns
    `UnconfiguredPaymentProvider`, which refuses every operation — so no client
    is ever offered a checkout that cannot move money.
    """
    from pathlib import Path

    production = Path(__file__).resolve().parents[2] / "config/settings/production.py"
    source = production.read_text(encoding="utf-8")
    assert 'PAYMENT_BACKEND = env("PAYMENT_BACKEND", "")' in source
    assert 'if PAYMENT_BACKEND == "memory":' in source


def test_a_live_paystack_key_needs_a_second_deliberate_switch():
    """The guard that makes pasting the wrong key cost nothing.

    A secret key is a string in an environment and the difference between the
    test one and the live one is four characters. Asserted on the source rather
    than by calling, because the point is that the line exists at all.
    """
    from pathlib import Path

    adapter = Path(__file__).resolve().parents[2] / "apps/payments/paystack.py"
    source = adapter.read_text(encoding="utf-8")
    assert 'key.startswith("sk_live_")' in source
    assert 'configuration_value("PAYSTACK_ALLOW_LIVE", False)' in source
    # Defaults off, in the one place the default is set.
    base = Path(__file__).resolve().parents[2] / "config/settings/base.py"
    assert 'PAYSTACK_ALLOW_LIVE = env("PAYSTACK_ALLOW_LIVE", False, cast=bool)' in base.read_text(
        encoding="utf-8"
    )
