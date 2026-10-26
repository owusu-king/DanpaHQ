"""Replaceable operation policy; approval never manufactures an identity check.

An authority/biometric adapter can implement this same policy against independent
IDENTITY records. Onboarding, terms and Management decisions do not change.
"""

from django.conf import settings
from django.utils.module_loading import import_string


class ManagementApprovalPolicy:
    def permits_provider_operations(self, user):
        from apps.trust.models import SubjectType, VerificationKind, VerificationMethod
        from apps.trust.services import current_for

        if current_for(SubjectType.USER, user.id, VerificationKind.IDENTITY) is not None:
            return True
        approval = current_for(SubjectType.USER, user.id, VerificationKind.PROVIDER)
        return bool(approval and approval.method == VerificationMethod.MANAGEMENT_APPROVAL)


def permits_provider_operations(user):
    policy = import_string(settings.PROVIDER_IDENTITY_POLICY)()
    return policy.permits_provider_operations(user)
