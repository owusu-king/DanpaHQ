"""Outbound message copy.

Kept in one file because SMS copy is product surface, not a string literal buried
in a service. Every message here obeys the same rules:

* **Under 160 characters.** A second segment doubles the cost, and at OTP volume
  that is real money.
* **The code comes first.** Android and iOS both offer to autofill from the
  notification preview, and both read the beginning of the message.
* **No links in an OTP message.** Teaching users that a code arrives with a link
  to tap is teaching them to be phished.
* **A warning that we never ask for the code.** The commonest attack here is a
  phone call claiming to be support.
* The sender identity is stated, because an unlabelled code is indistinguishable
  from a scam.
"""

from __future__ import annotations

BRAND = "Rentals GH"


def otp_continue(code: str) -> str:
    return f"{code} is your {BRAND} code. It expires in 5 minutes. We will never ask you for it."


def otp_sign_in(code: str) -> str:
    return f"{code} is your {BRAND} code. It expires in 5 minutes. We will never ask you for it."


def otp_sign_up(code: str) -> str:
    return f"{code} is your {BRAND} code to finish signing up. Expires in 5 minutes."


def otp_step_up(code: str, action: str) -> str:
    return (
        f"{code} is your {BRAND} code to {action}. If you did not request this, "
        f"do not share it and contact us."
    )


def otp_change_phone(code: str) -> str:
    return (
        f"{code} is your {BRAND} code to change the number on your account. Expires in 5 minutes."
    )


def otp_recover_account(code: str) -> str:
    return f"{code} is your {BRAND} code to reset your password. Expires in 5 minutes."


def password_changed() -> str:
    """Sent after any password change, including a reset.

    The person who just changed it learns nothing new. The point is the person
    who did *not*: this is how someone finds out their account was taken over
    while they still have the number to do something about it.
    """
    return (
        f"{BRAND}: your password was changed and other devices were signed out. "
        f"If this was not you, contact us immediately."
    )


def new_device_alert(label: str) -> str:
    return f"{BRAND}: a new device ({label}) signed in to your account. Not you? Contact us now."


def phone_changed_alert() -> str:
    """Sent to the OLD number.

    This is the single most important security message in the product: it is how
    a real owner finds out their number is being moved off their account, and it
    goes to the number that is losing access, not the one gaining it.
    """
    return (
        f"{BRAND}: the number on your account is being changed. If this was not you, "
        f"contact us immediately."
    )


def security_hold_notice(hours: int) -> str:
    return (
        f"{BRAND}: for your safety, payouts are paused for {hours} hours after a number "
        f"or SIM change."
    )


BY_PURPOSE = {
    "continue": otp_continue,
    "sign_in": otp_sign_in,
    "sign_up": otp_sign_up,
    "change_phone": otp_change_phone,
    "recover_account": otp_recover_account,
}


def email_verification(code: str) -> tuple[str, str]:
    """Subject and plain-text body for confirming an email address.

    The SMS rules hold here too: the code first, no link, and the warning. The
    subject carries the code as well, so it can be read from a notification
    without opening the message.
    """
    return (
        f"{code} is your Danpa HQ email code",
        (
            f"{code}\n\n"
            "Enter this code in Danpa HQ to confirm this email address. "
            "It expires in 5 minutes.\n\n"
            "We will never ask you for this code. If you did not ask for it, "
            "ignore this email and nothing will change.\n\n"
            "Danpa HQ"
        ),
    )
