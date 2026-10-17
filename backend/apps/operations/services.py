"""Management authentication and case mutations."""

from __future__ import annotations

import hashlib
from datetime import timedelta

from django.contrib.auth.hashers import make_password
from django.contrib.auth.password_validation import validate_password
from django.db import transaction
from django.utils import timezone

from apps.audit.models import AuditAction
from apps.audit.services import record
from apps.core.crypto import hash_token, random_token
from apps.core.events import DomainEvent
from apps.core.exceptions import PermissionDenied, ValidationFailed
from apps.outbox.services import emit

from .models import (
    CaseStatus,
    ManagementReport,
    ManagementSession,
    ManagementUser,
    Priority,
    ReportSubject,
    SupportCase,
    SupportCaseMessage,
    SupportCategory,
    SupportMessageSender,
)

SESSION_HOURS = 12
LOCK_AFTER_FAILURES = 5
LOCK_MINUTES = 15


def management_payload(user: ManagementUser) -> dict:
    from .permissions import capabilities_for

    return {
        "id": str(user.id),
        "email": user.email,
        "first_name": user.first_name,
        "last_name": user.last_name,
        "display_name": user.display_name,
        "role": user.role,
        "role_label": user.get_role_display(),
        "capabilities": capabilities_for(user.role),
        "must_change_password": user.must_change_password,
        "last_login": user.last_login,
    }


def _login_aggregate(email: str) -> str:
    return hashlib.sha256(email.strip().lower().encode()).hexdigest()[:32]


def authenticate_management(*, email: str, password: str, ip_address=None, user_agent=""):
    normalized = email.strip().lower()
    user = ManagementUser.objects.filter(email=normalized).first()

    if user is None:
        # Equalise most of the password-hash work without revealing whether the
        # address is provisioned.
        make_password(password)
        record(
            action=AuditAction.LOGIN_FAILED,
            aggregate_type="management_login",
            aggregate_id=_login_aggregate(normalized),
            metadata={"reason": "invalid_credentials"},
        )
        raise PermissionDenied("Those Management sign-in details did not work.")

    if not user.is_active:
        record(
            action=AuditAction.LOGIN_FAILED,
            aggregate_type="management_user",
            aggregate_id=user.id,
            management_actor=user,
            metadata={"reason": "inactive"},
        )
        raise PermissionDenied("This Management account is inactive.")
    if user.is_locked:
        record(
            action=AuditAction.LOGIN_FAILED,
            aggregate_type="management_user",
            aggregate_id=user.id,
            management_actor=user,
            metadata={"reason": "locked"},
        )
        raise PermissionDenied("Too many attempts. Try again later.")

    if not user.check_password(password):
        user.failed_login_count += 1
        fields = ["failed_login_count", "updated_at"]
        if user.failed_login_count >= LOCK_AFTER_FAILURES:
            user.locked_until = timezone.now() + timedelta(minutes=LOCK_MINUTES)
            fields.append("locked_until")
        user.save(update_fields=fields)
        record(
            action=AuditAction.LOGIN_FAILED,
            aggregate_type="management_user",
            aggregate_id=user.id,
            management_actor=user,
            metadata={"reason": "invalid_credentials"},
        )
        raise PermissionDenied("Those Management sign-in details did not work.")

    raw_session = random_token(48)
    from .authentication import csrf_token_for

    raw_csrf = csrf_token_for(raw_session)
    now = timezone.now()
    session = ManagementSession.objects.create(
        user=user,
        token_hash=hash_token(raw_session),
        csrf_hash=hash_token(raw_csrf),
        expires_at=now + timedelta(hours=SESSION_HOURS),
        ip_address=ip_address,
        user_agent=user_agent[:300],
    )
    user.last_login = now
    user.last_login_ip = ip_address
    user.failed_login_count = 0
    user.locked_until = None
    user.save(
        update_fields=[
            "last_login",
            "last_login_ip",
            "failed_login_count",
            "locked_until",
            "updated_at",
        ]
    )
    record(
        action=AuditAction.LOGIN,
        aggregate_type="management_user",
        aggregate_id=user.id,
        management_actor=user,
        metadata={"session_id": str(session.id)},
    )
    return session, raw_session, raw_csrf


def revoke_session(*, session: ManagementSession, reason: str) -> None:
    if session.revoked_at is None:
        session.revoked_at = timezone.now()
        session.revoked_reason = reason
        session.save(update_fields=["revoked_at", "revoked_reason", "updated_at"])


@transaction.atomic
def change_password(*, user: ManagementUser, current_password: str, new_password: str) -> None:
    if not user.check_password(current_password):
        raise ValidationFailed("Your current password is not correct.")
    validate_password(new_password, user=user)
    user.set_password(new_password)
    user.must_change_password = False
    user.save(update_fields=["password", "must_change_password", "updated_at"])
    now = timezone.now()
    ManagementSession.objects.filter(user=user, revoked_at__isnull=True).update(
        revoked_at=now, revoked_reason="password_changed", updated_at=now
    )
    record(
        action=AuditAction.UPDATE,
        aggregate_type="management_user",
        aggregate_id=user.id,
        management_actor=user,
        changes={"password": ["[redacted]", "[redacted]"]},
    )


@transaction.atomic
def update_case(*, case, actor: ManagementUser, status: str, resolution_note: str = ""):
    if status not in CaseStatus.values:
        raise ValidationFailed("Choose a valid case status.")
    if status in {CaseStatus.RESOLVED, CaseStatus.DISMISSED} and not resolution_note.strip():
        raise ValidationFailed("Record the resolution before closing this case.")

    previous = case.status
    case.status = status
    case.assigned_to = actor
    case.resolution_note = resolution_note.strip()
    case.resolved_at = (
        timezone.now() if status in {CaseStatus.RESOLVED, CaseStatus.DISMISSED} else None
    )
    case.save(
        update_fields=["status", "assigned_to", "resolution_note", "resolved_at", "updated_at"]
    )
    aggregate_type = "management_report" if isinstance(case, ManagementReport) else "support_case"
    record(
        action=AuditAction.UPDATE,
        aggregate_type=aggregate_type,
        aggregate_id=case.id,
        management_actor=actor,
        changes={"status": [previous, status]},
        metadata={"resolution_note": resolution_note.strip()},
    )
    return case


def _support_body(body: str) -> str:
    text = str(body or "").strip()
    if not text:
        raise ValidationFailed("Write a message.")
    if len(text) > 2000:
        raise ValidationFailed("Keep a message under 2,000 characters.")
    return text


def _post_support_message(
    *, case: SupportCase, body: str, user=None, management_actor: ManagementUser | None = None
) -> SupportCaseMessage:
    if (user is None) == (management_actor is None):
        raise ValueError("A support message needs exactly one author.")
    now = timezone.now()
    from_management = management_actor is not None
    message = SupportCaseMessage.objects.create(
        case=case,
        sender=(SupportMessageSender.MANAGEMENT if from_management else SupportMessageSender.USER),
        author_user=None if from_management else user,
        author_management=management_actor,
        author_label=management_actor.display_name if from_management else user.display_name,
        body=_support_body(body),
    )
    case.last_message_at = now
    if from_management:
        case.management_read_at = now
        case.assigned_to = management_actor
    else:
        case.user_read_at = now
        if case.status in {CaseStatus.RESOLVED, CaseStatus.DISMISSED}:
            case.status = CaseStatus.OPEN
            case.resolved_at = None
            case.resolution_note = ""
    case.save(
        update_fields=[
            "status",
            "assigned_to",
            "resolution_note",
            "resolved_at",
            "last_message_at",
            "user_read_at",
            "management_read_at",
            "updated_at",
        ]
    )
    return message


@transaction.atomic
def create_support_case(
    *, user, category: str, summary: str, message: str, priority: str = Priority.NORMAL
) -> SupportCase:
    if category not in SupportCategory.values:
        raise ValidationFailed("Choose a valid support category.")
    clean_summary = str(summary or "").strip()
    if not clean_summary:
        raise ValidationFailed("Summarise what you need help with.")
    clean_message = _support_body(message)
    case = SupportCase.objects.create(
        user=user,
        category=category,
        summary=clean_summary[:180],
        details=clean_message,
        priority=priority,
    )
    _post_support_message(case=case, body=clean_message, user=user)
    record(
        action=AuditAction.CREATE,
        aggregate_type="support_case",
        aggregate_id=case.id,
        actor=user,
        metadata={"category": category},
    )
    return case


@transaction.atomic
def reply_to_support_case(
    *, case: SupportCase, body: str, user=None, management_actor: ManagementUser | None = None
) -> SupportCaseMessage:
    message = _post_support_message(
        case=case, body=body, user=user, management_actor=management_actor
    )
    record(
        action=AuditAction.UPDATE,
        aggregate_type="support_case",
        aggregate_id=case.id,
        actor=user,
        management_actor=management_actor,
        metadata={"message_id": str(message.id), "sender": message.sender},
    )
    return message


def mark_support_case_read(*, case: SupportCase, by_management: bool) -> None:
    field = "management_read_at" if by_management else "user_read_at"
    SupportCase.objects.filter(id=case.id).update(**{field: timezone.now()})


def assert_management_actor(user) -> ManagementUser:
    if not isinstance(user, ManagementUser):
        raise PermissionDenied("A Management account is required.")
    return user


@transaction.atomic
def create_consumer_report(
    *, user, subject_type: str, subject_id, category: str, summary: str, details: str = ""
) -> ManagementReport:
    """Open an operations report from a consumer workflow."""
    if subject_type not in ReportSubject.values:
        raise ValidationFailed("Choose a valid report subject.")
    report = ManagementReport.objects.create(
        subject_type=subject_type,
        subject_id=str(subject_id),
        reported_by=user,
        category=category[:40],
        summary=summary.strip()[:180],
        details=details.strip()[:3000],
        priority=(
            Priority.HIGH
            if category in {"host_no_show", "inappropriate_conduct"}
            else Priority.NORMAL
        ),
    )
    record(
        action=AuditAction.CREATE,
        aggregate_type="management_report",
        aggregate_id=report.id,
        actor=user,
        metadata={"subject": f"{subject_type}:{subject_id}", "category": category},
    )
    emit(
        DomainEvent(
            "operations.report_created.v1",
            "management_report",
            str(report.id),
            {"subject_type": subject_type, "subject_id": str(subject_id)},
        )
    )
    return report
