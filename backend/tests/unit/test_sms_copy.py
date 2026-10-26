"""SMS copy is product surface and it costs money per segment, so it is tested."""

from apps.identity import messages

SEGMENT_LIMIT = 160


def _all_messages():
    return [
        messages.otp_continue("123456"),
        messages.otp_sign_in("123456"),
        messages.otp_sign_up("123456"),
        messages.otp_step_up("123456", "add a payout account"),
        messages.otp_change_phone("123456"),
        messages.new_device_alert("Samsung Galaxy A14"),
        messages.phone_changed_alert(),
        messages.security_hold_notice(72),
    ]


def test_every_message_fits_one_segment():
    for body in _all_messages():
        assert len(body) <= SEGMENT_LIMIT, body


def test_otp_messages_lead_with_the_code_for_autofill():
    """Both Android and iOS read the start of the message when offering to
    autofill, so the code cannot be buried after a greeting."""
    for body in (
        messages.otp_continue("123456"),
        messages.otp_sign_in("123456"),
        messages.otp_sign_up("123456"),
    ):
        assert body.startswith("123456")


def test_otp_messages_contain_no_links():
    """Teaching users that a code arrives with a tappable link is teaching them
    to be phished."""
    for body in _all_messages():
        assert "http" not in body.lower()


def test_sign_in_message_warns_against_sharing():
    assert "never ask you for it" in messages.otp_sign_in("123456")


def test_messages_identify_the_sender():
    for body in _all_messages():
        assert messages.BRAND in body


def test_phone_change_alert_does_not_name_the_new_number():
    """It goes to the number losing access. Naming the new number would hand an
    attacker's number to the victim, and the victim's to the attacker."""
    body = messages.phone_changed_alert()
    assert not any(ch.isdigit() for ch in body)
