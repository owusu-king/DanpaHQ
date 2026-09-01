"""Crypto primitives. These protect codes and sessions, so the tests are
adversarial rather than illustrative."""

import time

import pytest

from apps.core.crypto import (
    TokenExpired,
    TokenInvalid,
    hash_secret,
    hash_token,
    random_code,
    random_token,
    sign_payload,
    verify_payload,
    verify_secret,
)


class TestPepperedHashing:
    def test_correct_secret_verifies(self):
        digest = hash_secret("123456", pepper="pepper", salt="salt")
        assert verify_secret("123456", digest, pepper="pepper", salt="salt")

    def test_wrong_secret_fails(self):
        digest = hash_secret("123456", pepper="pepper", salt="salt")
        assert not verify_secret("123457", digest, pepper="pepper", salt="salt")

    def test_a_stolen_database_is_not_enough(self):
        """Without the pepper the hash cannot be reproduced, which is the whole
        reason a six-digit code is not stored under a plain digest."""
        digest = hash_secret("123456", pepper="real-pepper", salt="salt")
        assert not verify_secret("123456", digest, pepper="guessed", salt="salt")

    def test_salt_scopes_the_hash_to_one_challenge(self):
        a = hash_secret("123456", pepper="p", salt="challenge-a")
        b = hash_secret("123456", pepper="p", salt="challenge-b")
        assert a != b


class TestCodes:
    def test_code_length_is_respected(self):
        assert len(random_code(6)) == 6

    def test_codes_with_leading_zeros_are_possible(self):
        """Excluding them would shrink the space and bias the first digit."""
        codes = [random_code(4) for _ in range(4000)]
        assert any(code.startswith("0") for code in codes)

    def test_codes_are_all_digits(self):
        assert all(random_code(6).isdigit() for _ in range(50))

    @pytest.mark.parametrize("digits", [3, 11])
    def test_absurd_lengths_are_rejected(self, digits):
        with pytest.raises(ValueError):
            random_code(digits)


class TestTokens:
    def test_round_trip(self):
        token = sign_payload({"sub": "user-1"}, key="k", ttl_seconds=60)
        assert verify_payload(token, key="k")["sub"] == "user-1"

    def test_wrong_key_is_rejected(self):
        token = sign_payload({"sub": "user-1"}, key="k", ttl_seconds=60)
        with pytest.raises(TokenInvalid):
            verify_payload(token, key="other")

    def test_tampered_payload_is_rejected(self):
        token = sign_payload({"sub": "user-1", "roles": ["tenant"]}, key="k", ttl_seconds=60)
        version, body, signature = token.split(".")
        with pytest.raises(TokenInvalid):
            verify_payload(f"{version}.{body[:-2]}xx.{signature}", key="k")

    def test_expired_token_is_rejected(self):
        past = int(time.time()) - 100
        token = sign_payload({"sub": "u"}, key="k", ttl_seconds=10, now=past)
        with pytest.raises(TokenExpired):
            verify_payload(token, key="k")

    def test_malformed_token_is_rejected(self):
        with pytest.raises(TokenInvalid):
            verify_payload("not-a-token", key="k")

    def test_unknown_version_is_rejected(self):
        token = sign_payload({"sub": "u"}, key="k", ttl_seconds=60)
        _, body, signature = token.split(".")
        with pytest.raises(TokenInvalid):
            verify_payload(f"v9.{body}.{signature}", key="k")

    def test_clock_skew_beyond_tolerance_is_rejected(self):
        future = int(time.time()) + 600
        token = sign_payload({"sub": "u"}, key="k", ttl_seconds=60, now=future)
        with pytest.raises(TokenInvalid):
            verify_payload(token, key="k")


class TestLongSecrets:
    def test_refresh_tokens_are_unique(self):
        assert len({random_token() for _ in range(1000)}) == 1000

    def test_token_hash_is_stable_and_indexed_by_value(self):
        token = random_token()
        assert hash_token(token) == hash_token(token)
        assert hash_token(token) != hash_token(random_token())
