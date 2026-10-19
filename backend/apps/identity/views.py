"""Identity API.

The endpoint set is deliberately small. Every one of them is either part of
proving who someone is, or part of letting them see and control that.
"""

from __future__ import annotations

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import ViewSet

from apps.core.context import get_context
from apps.core.exceptions import Conflict, NotFound, PermissionDenied, ValidationFailed

from . import services
from .authentication import require_live_session
from .models import (
    AgentProfile,
    Device,
    LandlordProfile,
    Profile,
    Role,
    Session,
    TenantProfile,
)
from .otp_policy import CODE_TTL_SECONDS, MAX_VERIFY_ATTEMPTS, resend_delay
from .permissions import IsPhoneVerified, IsRegistrationComplete
from .serializers import (
    AgentProfileSerializer,
    ChallengeIssuedSerializer,
    ChangePasswordSerializer,
    ChooseWorkspaceSerializer,
    CompletePasswordResetSerializer,
    CompleteRegistrationSerializer,
    ConfirmPhoneVerificationSerializer,
    DeviceContextSerializer,
    DeviceSerializer,
    GoogleCredentialSerializer,
    GoogleSignInSerializer,
    LandlordProfileSerializer,
    MeSerializer,
    PasswordSignInSerializer,
    ProfileSerializer,
    SessionSerializer,
    StartChallengeSerializer,
    StartPasswordResetSerializer,
    StartPhoneVerificationSerializer,
    StartProviderVerificationSerializer,
    TenantProfileSerializer,
    VerifyChallengeSerializer,
    VerifyPasswordResetSerializer,
)
from .services import REFRESH_TOKEN_TTL_DAYS
from .throttling import GoogleAuthThrottle, OtpVerifyThrottle, PhoneNumberThrottle


class StartChallengeView(APIView):
    """POST /auth/challenge — send a one-time code.

    Public by necessity. Protected by a per-number throttle, a per-IP throttle
    and an escalating resend cooldown, and it returns the same shape whether or
    not the number is known.
    """

    permission_classes = [AllowAny]
    throttle_classes = [PhoneNumberThrottle]

    def post(self, request):
        payload = StartChallengeSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = payload.validated_data

        ctx = get_context()
        challenge = services.start_challenge(
            raw_phone=data["phone"],
            purpose=data["purpose"],
            ip_address=ctx.ip_address,
            device_fingerprint=data.get("device_fingerprint", ""),
        )

        from apps.core.phone import format_national

        body = ChallengeIssuedSerializer(
            {
                "challenge_id": challenge.id,
                "phone_display": format_national(challenge.phone),
                "expires_in": CODE_TTL_SECONDS,
                "resend_in": resend_delay(challenge.send_count),
                "attempts_allowed": MAX_VERIFY_ATTEMPTS,
            }
        ).data
        return Response(body, status=status.HTTP_201_CREATED)


class VerifyChallengeView(APIView):
    """POST /auth/verify — confirm the code and open a session."""

    permission_classes = [AllowAny]
    throttle_classes = [OtpVerifyThrottle]

    def post(self, request):
        payload = VerifyChallengeSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = payload.validated_data
        ctx = get_context()

        challenge = services.verify_challenge(
            challenge_id=data["challenge_id"], code=data["code"], ip_address=ctx.ip_address
        )

        result = services.complete_sign_in(
            challenge=challenge,
            device_fingerprint=data.get("device_fingerprint", ""),
            platform=data["platform"],
            device_label=data.get("device_label", ""),
            app_version=data.get("app_version", ""),
            os_version=data.get("os_version", ""),
            ip_address=ctx.ip_address,
            user_agent=ctx.user_agent,
        )

        # A number with no account behind it. No session, because there is
        # nobody to open one for yet — the ticket is spent at /me/registration/,
        # which is where the account gets made.
        if result.get("registration_required"):
            return Response(result, status=status.HTTP_200_OK)

        return _token_response(
            request,
            {
                "access_token": result["access_token"],
                "refresh_token": result["refresh_token"],
                "expires_in": result["expires_in"],
                "is_new_account": result["created"],
                "user": MeSerializer(result["user"]).data,
            },
        )


#: Where a browser's refresh token lives. Scoped to the auth endpoints so it is
#: not attached to every API request, which keeps its exposure to the two calls
#: that actually need it.
REFRESH_COOKIE = "danpahq_refresh"
REFRESH_COOKIE_PATH = "/api/v1/auth/"


def _is_browser(request) -> bool:
    """Browsers get a cookie; native apps get the token in the body.

    The split is deliberate. A browser cannot hold a secret safely in script -
    anything JavaScript can read, injected JavaScript can steal - so the refresh
    token goes somewhere script cannot reach. A mobile app has the Keychain and
    the Keystore, which are better than a cookie, and no XSS surface to worry
    about.
    """
    return request.headers.get("X-Client", "").strip().lower() == "web"


def _token_response(request, payload: dict, *, status_code: int = status.HTTP_200_OK) -> Response:
    """Return a token payload, routing the refresh token by client type."""
    if not _is_browser(request):
        return Response(payload, status=status_code)

    refresh_token = payload.pop("refresh_token", None)
    response = Response(payload, status=status_code)
    if refresh_token:
        response.set_cookie(
            REFRESH_COOKIE,
            refresh_token,
            max_age=REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60,
            httponly=True,
            # Same-site covers localhost:3000 -> localhost:8000 and
            # app.example.com -> api.example.com, because "site" ignores the
            # port and the subdomain. Strict would break the sign-in redirect.
            samesite="Lax",
            secure=not settings.DEBUG,
            path=REFRESH_COOKIE_PATH,
        )
    return response


class RefreshView(APIView):
    """POST /auth/refresh — rotate the session.

    A browser may send nothing at all: its refresh token is in the httpOnly
    cookie set at sign-in, which is the point - script on the page cannot read
    it, so an XSS bug cannot walk off with a 30-day credential.
    """

    permission_classes = [AllowAny]

    def post(self, request):
        token = request.data.get("refresh_token") or request.COOKIES.get(REFRESH_COOKIE)
        if not token:
            raise ValidationFailed("Sign in again.")
        payload = DeviceContextSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = payload.validated_data
        ctx = get_context()

        result = services.rotate_session(
            refresh_token=token,
            ip_address=ctx.ip_address,
            user_agent=ctx.user_agent,
            device_fingerprint=data.get("device_fingerprint", ""),
            platform=data["platform"],
            device_label=data.get("device_label", ""),
            app_version=data.get("app_version", ""),
            os_version=data.get("os_version", ""),
        )
        return _token_response(
            request,
            {
                "access_token": result["access_token"],
                "refresh_token": result["refresh_token"],
                "expires_in": result["expires_in"],
            },
        )


class SignOutView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        session = require_live_session(request)
        if request.data.get("everywhere"):
            count = services.sign_out_everywhere(user=request.user)
            response = Response({"signed_out": count})
        else:
            services.sign_out(session=session)
            response = Response(status=status.HTTP_204_NO_CONTENT)
        response.delete_cookie(REFRESH_COOKIE, path=REFRESH_COOKIE_PATH)
        return response


class PasswordSignInView(APIView):
    """POST /auth/sign-in — phone and password.

    Throttled per number like the OTP endpoints, because an unthrottled password
    endpoint is a credential-stuffing target and the phone number space here is
    small enough to enumerate.
    """

    permission_classes = [AllowAny]
    throttle_classes = [PhoneNumberThrottle]

    def post(self, request):
        payload = PasswordSignInSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = payload.validated_data
        ctx = get_context()

        result = services.sign_in_with_password(
            raw_phone=data["phone"],
            password=data["password"],
            device_fingerprint=data.get("device_fingerprint", ""),
            platform=data["platform"],
            device_label=data.get("device_label", ""),
            app_version=data.get("app_version", ""),
            os_version=data.get("os_version", ""),
            ip_address=ctx.ip_address,
            user_agent=ctx.user_agent,
        )
        return _token_response(
            request,
            {
                "access_token": result["access_token"],
                "refresh_token": result["refresh_token"],
                "expires_in": result["expires_in"],
                "user": MeSerializer(result["user"]).data,
            },
        )


class GoogleSignInView(APIView):
    """POST /auth/google — verify GIS on the server, then sign in or continue registration."""

    permission_classes = [AllowAny]
    throttle_classes = [GoogleAuthThrottle]

    def post(self, request):
        payload = GoogleSignInSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = payload.validated_data
        ctx = get_context()

        from .google_identity import verify_google_credential

        claims = verify_google_credential(data["credential"])
        result = services.authenticate_with_google(
            claims=claims,
            account_type=data["account_type"],
            device_fingerprint=data.get("device_fingerprint", ""),
            platform=data["platform"],
            device_label=data.get("device_label", ""),
            app_version=data.get("app_version", ""),
            os_version=data.get("os_version", ""),
            ip_address=ctx.ip_address,
            user_agent=ctx.user_agent,
        )
        if result.get("registration_required"):
            return Response(result)

        return _token_response(
            request,
            {
                "access_token": result["access_token"],
                "refresh_token": result["refresh_token"],
                "expires_in": result["expires_in"],
                "is_new_account": False,
                "user": MeSerializer(result["user"]).data,
            },
        )


class StartPasswordResetView(APIView):
    """POST /auth/password-reset — send a recovery code.

    Refuses an unregistered number with NO_ACCOUNT before anything is sent. It
    used to answer identically either way and let the code step discover there
    was no account, which spent an SMS and a wait to deliver a dead end. The
    enumeration this gives up is the trade already made for sign-up, and the
    per-number and per-IP throttles bound it the same way.
    """

    permission_classes = [AllowAny]
    throttle_classes = [PhoneNumberThrottle]

    def post(self, request):
        payload = StartPasswordResetSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = payload.validated_data
        ctx = get_context()

        challenge = services.start_challenge(
            raw_phone=data["phone"],
            purpose="recover_account",
            ip_address=ctx.ip_address,
            device_fingerprint=data.get("device_fingerprint", ""),
        )
        from apps.core.phone import format_national

        return Response(
            ChallengeIssuedSerializer(
                {
                    "challenge_id": challenge.id,
                    "phone_display": format_national(challenge.phone),
                    "expires_in": CODE_TTL_SECONDS,
                    "resend_in": resend_delay(challenge.send_count),
                    "attempts_allowed": MAX_VERIFY_ATTEMPTS,
                }
            ).data,
            status=status.HTTP_201_CREATED,
        )


class VerifyPasswordResetView(APIView):
    """POST /auth/password-reset/verify — trade the code for a reset token.

    Returns a token that authorises exactly one password change and no session,
    so proving the number never becomes a way to read the account.
    """

    permission_classes = [AllowAny]
    throttle_classes = [OtpVerifyThrottle]

    def post(self, request):
        payload = VerifyPasswordResetSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        ctx = get_context()

        token = services.verify_password_reset(
            challenge_id=payload.validated_data["challenge_id"],
            code=payload.validated_data["code"],
            ip_address=ctx.ip_address,
        )
        return Response(
            {
                "reset_token": token,
                "expires_in": services.PASSWORD_RESET_TOKEN_TTL_SECONDS,
            }
        )


class CompletePasswordResetView(APIView):
    """POST /auth/password-reset/complete — set the new password and sign in."""

    permission_classes = [AllowAny]

    def post(self, request):
        payload = CompletePasswordResetSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = payload.validated_data
        ctx = get_context()

        user = services.complete_password_reset(
            reset_token=data["reset_token"],
            new_password=data["new_password"],
        )
        # Straight into a session: the person just proved the number and set the
        # credential, and making them immediately retype it would be friction
        # with nothing behind it.
        result = services._establish_session(
            user=user,
            created=False,
            device_fingerprint=data.get("device_fingerprint", ""),
            platform=data["platform"],
            device_label=data.get("device_label", ""),
            app_version=data.get("app_version", ""),
            os_version=data.get("os_version", ""),
            ip_address=ctx.ip_address,
            user_agent=ctx.user_agent,
            audit_metadata={"method": "password_reset"},
        )
        return _token_response(
            request,
            {
                "access_token": result["access_token"],
                "refresh_token": result["refresh_token"],
                "expires_in": result["expires_in"],
                "user": MeSerializer(result["user"]).data,
            },
        )


class ChangePasswordView(APIView):
    """POST /me/password — change a known password."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        payload = ChangePasswordSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        services.change_password(
            user=request.user,
            current_password=payload.validated_data["current_password"],
            new_password=payload.validated_data["new_password"],
            except_session=require_live_session(request),
        )
        return Response({"changed": True})


class WorkspaceView(APIView):
    """POST /me/workspace — move between the tenant and provider experiences.

    This is what the welcome screen's choice maps to after sign-in, and it is
    the answer to "an existing tenant taps *I own or manage property*". It puts
    them in the provider experience — which for an unverified account means the
    verification screen, not the workspace — while their tenant side carries on
    untouched. Switching back is the same call in reverse: a navigation change,
    not a cancellation, a conversion, or a second account.
    """

    permission_classes = [IsAuthenticated, IsRegistrationComplete]

    def get(self, request):
        capabilities = services.account_capabilities(request.user)
        return Response(
            {
                "active_workspace": capabilities["active_workspace"],
                "available_workspaces": capabilities["available_workspaces"],
            }
        )

    def post(self, request):
        payload = ChooseWorkspaceSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        services.choose_workspace(user=request.user, workspace=payload.validated_data["workspace"])
        return Response(MeSerializer(request.user).data)


class CompleteRegistrationView(APIView):
    """POST /me/registration — create the account.

    Open, because this is the step that turns a proved number into an account
    and there is nothing to authenticate as until it succeeds. The registration
    ticket from /auth/verify is the credential: signed, expiring, and good for
    creating an account on exactly one number.

    A bearer token still works, for rows left unfinished before tickets existed.
    """

    permission_classes = [AllowAny]

    def post(self, request):
        payload = CompleteRegistrationSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = payload.validated_data
        ticket = data.pop("registration_ticket", "")
        google_ticket = data.pop("google_registration_ticket", "")
        ctx = get_context()

        signed_in = getattr(request.user, "is_authenticated", False)
        if not signed_in and not ticket and not google_ticket:
            raise PermissionDenied("Confirm your phone number or Google account first.")

        user = services.complete_registration(
            user=request.user if signed_in else None,
            ticket=ticket,
            google_ticket=google_ticket,
            data=data,
        )

        # The ticket path has no session yet, so it opens one here: the person
        # just proved their number and set a password, and asking them to sign
        # in again on the next screen would be friction with nothing behind it.
        if signed_in:
            return Response(MeSerializer(user).data, status=status.HTTP_201_CREATED)

        result = services._establish_session(
            user=user,
            created=True,
            device_fingerprint=data.get("device_fingerprint", ""),
            platform=data["platform"],
            device_label=data.get("device_label", ""),
            app_version=data.get("app_version", ""),
            os_version=data.get("os_version", ""),
            ip_address=ctx.ip_address,
            user_agent=ctx.user_agent,
            audit_metadata={
                "method": "google_registration" if google_ticket else "registration"
            },
        )
        return _token_response(
            request,
            {
                "access_token": result["access_token"],
                "refresh_token": result["refresh_token"],
                "expires_in": result["expires_in"],
                "user": MeSerializer(result["user"]).data,
            },
            status_code=status.HTTP_201_CREATED,
        )


class GoogleLinkView(APIView):
    """POST /me/google — link one verified Google subject to this live session."""

    permission_classes = [IsAuthenticated, IsRegistrationComplete]
    throttle_classes = [GoogleAuthThrottle]

    def post(self, request):
        require_live_session(request)
        payload = GoogleCredentialSerializer(data=request.data)
        payload.is_valid(raise_exception=True)

        from .google_identity import verify_google_credential

        claims = verify_google_credential(payload.validated_data["credential"])
        services.link_google_identity(user=request.user, claims=claims)
        return Response(MeSerializer(request.user).data)


class PhoneVerificationView(APIView):
    """POST /me/phone — send an OTP to add a phone to a federated account."""

    permission_classes = [IsAuthenticated, IsRegistrationComplete]
    throttle_classes = [PhoneNumberThrottle]

    def post(self, request):
        require_live_session(request)
        payload = StartPhoneVerificationSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        ctx = get_context()
        challenge = services.start_phone_verification(
            user=request.user,
            raw_phone=payload.validated_data["phone"],
            ip_address=ctx.ip_address,
            device_fingerprint=payload.validated_data.get("device_fingerprint", ""),
        )
        from apps.core.phone import format_national

        return Response(
            ChallengeIssuedSerializer(
                {
                    "challenge_id": challenge.id,
                    "phone_display": format_national(challenge.phone),
                    "expires_in": CODE_TTL_SECONDS,
                    "resend_in": resend_delay(challenge.send_count),
                    "attempts_allowed": MAX_VERIFY_ATTEMPTS,
                }
            ).data,
            status=status.HTTP_201_CREATED,
        )


class ConfirmPhoneVerificationView(APIView):
    """POST /me/phone/verify — attach the number; never create a session."""

    permission_classes = [IsAuthenticated, IsRegistrationComplete]
    throttle_classes = [OtpVerifyThrottle]

    def post(self, request):
        require_live_session(request)
        payload = ConfirmPhoneVerificationSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        ctx = get_context()
        user = services.confirm_phone_verification(
            user=request.user,
            challenge_id=payload.validated_data["challenge_id"],
            code=payload.validated_data["code"],
            ip_address=ctx.ip_address,
        )
        return Response(MeSerializer(user).data)


class ProviderVerificationView(APIView):
    """GET/POST /me/provider-verification — ask to operate as a provider.

    Deliberately not per property. This decides whether the person may operate
    here at all; whether they control any particular address is a separate
    review against separate evidence.
    """

    permission_classes = [IsAuthenticated, IsPhoneVerified, IsRegistrationComplete]

    def get(self, request):
        return Response(services.account_capabilities(request.user)["provider"])

    def post(self, request):
        payload = StartProviderVerificationSerializer(data=request.data)
        payload.is_valid(raise_exception=True)

        from apps.files.models import StoredFile

        documents = []
        for row in payload.validated_data["documents"]:
            file = StoredFile.objects.filter(id=row["file_id"]).first()
            if file is None:
                raise NotFound("We could not find one of those uploads.")
            documents.append({"file": file, "evidence_type": row["evidence_type"]})

        services.start_provider_verification(user=request.user, documents=documents)
        return Response(
            services.account_capabilities(request.user)["provider"],
            status=status.HTTP_201_CREATED,
        )


class MeView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(MeSerializer(request.user).data)

    def patch(self, request):
        allowed = {
            "first_name",
            "last_name",
            "preferred_name",
            "email",
            "preferred_language",
            "data_saver",
        }
        payload = {k: v for k, v in request.data.items() if k in allowed}

        # An address reaches the account only through its code (/me/email/).
        # Sending back the one already on file, or clearing it, is still fine
        # here — forms that save every field at once do both — but a new
        # address written directly would be an unproven one.
        if "email" in payload:
            proposed = str(payload["email"] or "").strip().lower()
            if not proposed:
                payload.pop("email")
                if request.user.email:
                    from .email_verification import clear_email

                    clear_email(user=request.user)
            elif proposed == (request.user.email or ""):
                payload.pop("email")
            else:
                raise ValidationFailed(
                    "Confirm a new email address with the code we send to it.",
                    details={
                        "fields": {
                            "email": ["Confirm a new email address with the code we send to it."]
                        }
                    },
                )
        if not payload:
            return Response(MeSerializer(request.user).data)

        serializer = MeSerializer(request.user, data=payload, partial=True)
        serializer.is_valid(raise_exception=True)

        before = {k: getattr(request.user, k) for k in payload}
        serializer.save()

        from apps.audit.models import AuditAction
        from apps.audit.services import record

        record(
            action=AuditAction.UPDATE,
            aggregate_type="user",
            aggregate_id=request.user.id,
            actor=request.user,
            changes={k: [before[k], payload[k]] for k in payload},
        )
        return Response(serializer.data)


class EmailView(APIView):
    """POST /me/email — send a code to an address; DELETE — take it off.

    POST is both "add" and "change", and asking again for the same address is a
    resend. Nothing changes on the account until /me/email/verify succeeds.
    """

    permission_classes = [IsAuthenticated, IsRegistrationComplete]

    def post(self, request):
        from .email_verification import start_email_verification
        from .serializers import StartEmailVerificationSerializer

        payload = StartEmailVerificationSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        verification = start_email_verification(
            user=request.user, raw_email=payload.validated_data["email"]
        )
        return Response(
            {
                "verification_id": verification.id,
                "email": verification.email,
                "expires_in": CODE_TTL_SECONDS,
                "resend_in": resend_delay(verification.send_count),
                "attempts_allowed": MAX_VERIFY_ATTEMPTS,
            },
            status=status.HTTP_201_CREATED,
        )

    def delete(self, request):
        from .email_verification import clear_email

        user = clear_email(user=request.user)
        return Response(MeSerializer(user).data)


class VerifyEmailView(APIView):
    """POST /me/email/verify — confirm the code; the address joins the account."""

    permission_classes = [IsAuthenticated, IsRegistrationComplete]
    throttle_classes = [OtpVerifyThrottle]

    def post(self, request):
        from .email_verification import verify_email
        from .serializers import VerifyEmailSerializer

        payload = VerifyEmailSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        user = verify_email(
            user=request.user,
            verification_id=payload.validated_data["verification_id"],
            code=payload.validated_data["code"],
        )
        return Response(MeSerializer(user).data)


class ProfileView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        profile, _ = Profile.objects.get_or_create(user=request.user)
        return Response(ProfileSerializer(profile, context={"request": request}).data)

    def patch(self, request):
        profile, _ = Profile.objects.get_or_create(user=request.user)
        # The request goes into the context because setting a profile photo needs
        # to know who is asking: the file being attached has to belong to them.
        serializer = ProfileSerializer(
            profile, data=request.data, partial=True, context={"request": request}
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


ROLE_PROFILES = {
    Role.TENANT: (TenantProfile, TenantProfileSerializer),
    Role.LANDLORD: (LandlordProfile, LandlordProfileSerializer),
    Role.AGENT: (AgentProfile, AgentProfileSerializer),
}


class RoleProfileView(APIView):
    """GET/PATCH /me/profile/<role>/ — the role-specific part of a profile."""

    permission_classes = [IsAuthenticated]

    def _resolve(self, request, role):
        if role not in ROLE_PROFILES:
            raise NotFound("There is no profile of that kind.")
        if not request.user.has_role(role):
            raise PermissionDenied(f"Add the {role} role to your account first.")
        model, serializer_class = ROLE_PROFILES[role]
        instance, _ = model.objects.get_or_create(user=request.user)
        return instance, serializer_class

    def get(self, request, role):
        instance, serializer_class = self._resolve(request, role)
        return Response(serializer_class(instance).data)

    def patch(self, request, role):
        instance, serializer_class = self._resolve(request, role)
        serializer = serializer_class(instance, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class RoleView(APIView):
    """POST /me/roles/ — add a role to your own account.

    Only tenant. It was previously landlord and agent too, on the reasoning that
    a role is a statement of intent and the verification behind it is what
    unlocks anything. That reasoning was wrong in one specific way: roles decide
    which workspace a client is offered, so self-granting landlord handed anyone
    the provider interface without a single check having been made. Provider
    standing is now granted by the backend when provider verification is
    approved, and by nothing else.

    Tenant stays self-grantable because it opens only actions the other party
    has to agree to.
    """

    permission_classes = [IsAuthenticated, IsPhoneVerified]

    SELF_GRANTABLE = {Role.TENANT}

    def post(self, request):
        role = request.data.get("role")
        if role not in self.SELF_GRANTABLE:
            raise ValidationFailed(
                "Only a tenant role can be added directly. To operate as a property "
                "provider, submit provider verification."
            )
        if not request.user.is_registration_complete:
            raise ValidationFailed("Finish setting up your account first.")

        services.grant_role(user=request.user, role=role, granted_by=request.user)
        return Response(MeSerializer(request.user).data, status=status.HTTP_201_CREATED)

    def delete(self, request):
        role = request.data.get("role")
        services.revoke_role(
            user=request.user, role=role, revoked_by=request.user, reason="removed by user"
        )
        return Response(status=status.HTTP_204_NO_CONTENT)


class OnboardingRoleView(APIView):
    """Select initial find/list/both intent after the minimum name step."""

    permission_classes = [IsAuthenticated, IsPhoneVerified]

    def post(self, request):
        services.select_onboarding_role(
            user=request.user,
            intent=request.data.get("intent"),
            role=request.data.get("role"),
        )
        data = MeSerializer(request.user).data
        # One-release compatibility for clients that still call the role-shaped
        # endpoint. New clients use /me/onboarding/intent/ and receive the
        # organization-first route.
        selected = request.data.get("intent")
        if selected in {"list_property", "both"}:
            data["entry_routes"] = {**data["entry_routes"], "web": "/provider"}
        return Response(data)


class OnboardingIntentView(APIView):
    """Select a product journey; this never grants resource authority."""

    permission_classes = [IsAuthenticated, IsPhoneVerified]

    def post(self, request):
        services.select_onboarding_intent(
            user=request.user,
            intent=request.data.get("intent"),
        )
        return Response(MeSerializer(request.user).data)


class OnboardingView(APIView):
    """Save first and last name before initial intent selection."""

    permission_classes = [IsAuthenticated, IsPhoneVerified]

    def post(self, request):
        services.complete_onboarding(user=request.user, data=request.data)
        return Response(MeSerializer(request.user).data)


class DeviceViewSet(ViewSet):
    """The device list a person can actually act on.

    Showing someone every device on their account, with a way to remove one, is
    the cheapest real defence a user has against a compromised session.

    Two actions, because there are two intentions and one of them used to be
    charged the other's price. Signing a device out is the everyday one and is
    reversible — the installation can sign in again with a one-time code, and
    its owner gets the unfamiliar-device alert when it does. Reporting a handset
    lost or stolen bars it, and only Management can lift that.
    """

    permission_classes = [IsAuthenticated]

    def list(self, request):
        session = require_live_session(request)
        devices = Device.objects.filter(
            user=request.user,
            blocked_at__isnull=True,
            removed_at__isnull=True,
        ).order_by("-last_seen_at")
        return Response(
            DeviceSerializer(
                devices,
                many=True,
                context={"current_device_id": session.device_id},
            ).data
        )

    def _other_device(self, request, pk):
        current = require_live_session(request)
        device = Device.objects.filter(
            user=request.user,
            id=pk,
            blocked_at__isnull=True,
            removed_at__isnull=True,
        ).first()
        if device is None:
            raise NotFound("That device is not on your account.")
        if device.id == current.device_id:
            raise Conflict("Use the main sign-out action to sign out this device.")
        return device

    def destroy(self, request, pk=None):
        """Sign an installation out. It may sign in again; that is the point."""
        device = self._other_device(request, pk)
        revoked = services.forget_device(device=device, actor=request.user)
        return Response({"sessions_ended": revoked, "blocked": False})

    def block(self, request, pk=None):
        """Report the handset lost or stolen, and bar it until support lifts it."""
        from apps.operations.configuration import value as configuration_value

        if not configuration_value("STOLEN_DEVICE_REPORTING_ENABLED", True):
            raise PermissionDenied("Lost or stolen device reporting is currently unavailable.")
        device = self._other_device(request, pk)
        revoked = services.block_device(
            device=device,
            reason="reported lost or stolen by owner",
            actor=request.user,
        )
        return Response({"sessions_ended": revoked, "blocked": True})


class SessionViewSet(ViewSet):
    permission_classes = [IsAuthenticated]

    def list(self, request):
        current = require_live_session(request)
        sessions = (
            Session.objects.filter(
                user=request.user,
                revoked_at__isnull=True,
                expires_at__gt=timezone.now(),
            )
            .select_related("device")
            .order_by("-issued_at")
        )
        return Response(
            SessionSerializer(sessions, many=True, context={"current_session_id": current.id}).data
        )

    @transaction.atomic
    def destroy(self, request, pk=None):
        current = require_live_session(request)
        target = (
            Session.objects.select_for_update()
            .filter(
                id=pk,
                user=request.user,
                revoked_at__isnull=True,
                expires_at__gt=timezone.now(),
            )
            .first()
        )
        if target is None:
            raise NotFound("That signed-in session is no longer active.")
        if target.id == current.id:
            raise Conflict("Use the main sign-out action to sign out this device.")

        services.sign_out(session=target, reason="signed_out_from_session_list")
        return Response(status=status.HTTP_204_NO_CONTENT)


class SecurityStatusView(APIView):
    """GET /me/security/ — what the person needs to know about their own account.

    Written for a user, not an analyst: what is protecting the account, what is
    currently held and why, and what to do about it.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from apps.operations.configuration import value as configuration_value

        session = require_live_session(request)
        assessment = services.assess_user_risk(request.user, device=session.device)

        return Response(
            {
                "level": assessment.level,
                "reasons": list(assessment.reasons),
                "payouts_held": assessment.blocks_money_movement,
                "hold_remaining_hours": round(assessment.hold_remaining_hours, 1),
                "active_sessions": Session.objects.filter(
                    user=request.user, revoked_at__isnull=True
                ).count(),
                "devices": Device.objects.filter(
                    user=request.user, blocked_at__isnull=True
                ).count(),
                "phone_verified": request.user.is_phone_verified,
                "stolen_device_reporting_enabled": bool(
                    configuration_value("STOLEN_DEVICE_REPORTING_ENABLED", True)
                ),
            }
        )


class StepUpView(APIView):
    """POST /auth/step-up/ — prove the number again before a sensitive action."""

    permission_classes = [IsAuthenticated]
    throttle_classes = [OtpVerifyThrottle]

    def post(self, request):
        action_name = request.data.get("action", "")
        if not action_name:
            raise ValidationFailed("Say which action needs confirming.")

        ctx = get_context()
        challenge = services.require_step_up(
            user=request.user, action=action_name, ip_address=ctx.ip_address
        )
        return Response(
            {"challenge_id": challenge.id, "expires_in": CODE_TTL_SECONDS},
            status=status.HTTP_201_CREATED,
        )
