import logging

from urllib.parse import urlsplit

from django.conf import settings

from django.contrib.auth import (
    get_user_model,
    logout,
    update_session_auth_hash,
)

from django.contrib.auth.forms import (
    PasswordChangeForm,
    PasswordResetForm,
    SetPasswordForm,
)

from django.contrib.auth.tokens import (
    default_token_generator,
)

from django.core.cache import caches
from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils.crypto import salted_hmac
from django.utils.decorators import method_decorator
from django.utils.encoding import force_str
from django.utils.http import urlsafe_base64_decode
from django.views.decorators.csrf import csrf_protect

from rest_framework import serializers, status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import SimpleRateThrottle
from rest_framework.views import APIView


logger = logging.getLogger(__name__)

RESET_MESSAGE = (
    "If an eligible account exists for this email, "
    "a password reset link will be sent. "
    "Check your inbox and spam folder."
)


# ============================================================
# REQUEST LIMITS
# ============================================================

class AccountThrottle(SimpleRateThrottle):
    cache = caches["account_security"]

    def cache_key(self, identifier):
        return self.cache_format % {
            "scope": self.scope,
            "ident": identifier,
        }


class ResetRequestIPThrottle(AccountThrottle):
    scope = "password_reset_ip"
    rate = "10/hour"

    def get_cache_key(self, request, view):
        return self.cache_key(
            self.get_ident(request)
        )


class ResetRequestEmailThrottle(AccountThrottle):
    scope = "password_reset_email"
    rate = "3/hour"

    def get_cache_key(self, request, view):
        if not isinstance(request.data, dict):
            return None

        email = request.data.get("email", "")

        if not isinstance(email, str):
            return None

        email = email.strip().lower()[:254]

        if not email:
            return None

        # Do not store the actual address in cache keys.
        identifier = salted_hmac(
            "eventhub.password-reset-email",
            email,
        ).hexdigest()

        return self.cache_key(identifier)


class ResetConfirmThrottle(AccountThrottle):
    scope = "password_reset_confirm"
    rate = "20/hour"

    def get_cache_key(self, request, view):
        return self.cache_key(
            self.get_ident(request)
        )


class PasswordChangeThrottle(AccountThrottle):
    scope = "password_change"
    rate = "10/hour"

    def get_cache_key(self, request, view):
        identifier = (
            f"user-{request.user.pk}"
            if request.user.is_authenticated
            else self.get_ident(request)
        )

        return self.cache_key(identifier)


# ============================================================
# INPUT VALIDATION
# ============================================================

class PasswordChangeInput(serializers.Serializer):
    old_password = serializers.CharField(
        trim_whitespace=False,
        max_length=1024,
        write_only=True,
    )

    new_password1 = serializers.CharField(
        trim_whitespace=False,
        max_length=128,
        write_only=True,
    )

    new_password2 = serializers.CharField(
        trim_whitespace=False,
        max_length=128,
        write_only=True,
    )


class PasswordResetRequestInput(serializers.Serializer):
    email = serializers.EmailField(
        max_length=254
    )


class PasswordResetConfirmInput(serializers.Serializer):
    uid = serializers.CharField(
        max_length=128
    )

    token = serializers.CharField(
        max_length=128
    )

    new_password1 = serializers.CharField(
        trim_whitespace=False,
        max_length=128,
        write_only=True,
    )

    new_password2 = serializers.CharField(
        trim_whitespace=False,
        max_length=128,
        write_only=True,
    )


# ============================================================
# CHANGE PASSWORD WHILE SIGNED IN
# ============================================================

@method_decorator(csrf_protect, name="dispatch")
class ChangePasswordView(APIView):
    permission_classes = [IsAuthenticated]

    throttle_classes = [
        PasswordChangeThrottle,
    ]

    def post(self, request):
        serializer = PasswordChangeInput(
            data=request.data
        )

        serializer.is_valid(
            raise_exception=True
        )

        with transaction.atomic():
            user = (
                get_user_model()
                .objects
                .select_for_update()
                .get(pk=request.user.pk)
            )

            form = PasswordChangeForm(
                user=user,
                data=serializer.validated_data,
            )

            if not form.is_valid():
                return Response(
                    dict(form.errors),
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if user.check_password(
                form.cleaned_data["new_password1"]
            ):
                return Response(
                    {
                        "new_password1": [
                            "Choose a password different "
                            "from your current password."
                        ]
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            user = form.save()

        # Keep this browser signed in after the password changes.
        update_session_auth_hash(
            request,
            user,
        )

        return Response({
            "message": (
                "Your password has been changed. "
                "Other sessions will need to sign in again."
            )
        })


# ============================================================
# REQUEST PASSWORD RESET EMAIL
# ============================================================

@method_decorator(csrf_protect, name="dispatch")
class RequestPasswordResetView(APIView):
    permission_classes = [AllowAny]

    throttle_classes = [
        ResetRequestIPThrottle,
        ResetRequestEmailThrottle,
    ]

    def post(self, request):
        serializer = PasswordResetRequestInput(
            data=request.data
        )

        serializer.is_valid(
            raise_exception=True
        )

        form = PasswordResetForm(
            data=serializer.validated_data
        )

        if not form.is_valid():
            return Response(
                dict(form.errors),
                status=status.HTTP_400_BAD_REQUEST,
            )

        frontend = urlsplit(
            settings.FRONTEND_URL
        )

        try:
            form.save(
                request=request,
                use_https=(
                    frontend.scheme == "https"
                ),
                domain_override=frontend.netloc,
                from_email=settings.DEFAULT_FROM_EMAIL,
                subject_template_name=(
                    "accounts/password_reset_subject.txt"
                ),
                email_template_name=(
                    "accounts/password_reset_email.txt"
                ),
            )

        except Exception:
            # Do not log email contents, reset links or tokens.
            # Keep the public response consistent.
            logger.error(
                "Password reset email delivery failed."
            )

        # Same response for eligible and unknown accounts.
        return Response(
            {"message": RESET_MESSAGE},
            status=status.HTTP_202_ACCEPTED,
        )


# ============================================================
# CONFIRM PASSWORD RESET
# ============================================================

@method_decorator(csrf_protect, name="dispatch")
class ConfirmPasswordResetView(APIView):
    permission_classes = [AllowAny]

    throttle_classes = [
        ResetConfirmThrottle,
    ]

    def post(self, request):
        serializer = PasswordResetConfirmInput(
            data=request.data
        )

        serializer.is_valid(
            raise_exception=True
        )

        data = serializer.validated_data
        User = get_user_model()

        invalid_link = {
            "message": (
                "This reset link is invalid or has expired. "
                "Please request a new link."
            )
        }

        try:
            user_id = force_str(
                urlsafe_base64_decode(data["uid"])
            )

        except (
            ValueError,
            TypeError,
            OverflowError,
            UnicodeDecodeError,
        ):
            return Response(
                invalid_link,
                status=status.HTTP_400_BAD_REQUEST,
            )

        with transaction.atomic():
            try:
                user = (
                    User.objects
                    .select_for_update()
                    .get(pk=user_id)
                )

            except (
                User.DoesNotExist,
                ValueError,
                TypeError,
                OverflowError,
                ValidationError,
            ):
                return Response(
                    invalid_link,
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if (
                not user.is_active
                or not user.has_usable_password()
                or not default_token_generator.check_token(
                    user,
                    data["token"],
                )
            ):
                return Response(
                    invalid_link,
                    status=status.HTTP_400_BAD_REQUEST,
                )

            form = SetPasswordForm(
                user=user,
                data=data,
            )

            if not form.is_valid():
                return Response(
                    dict(form.errors),
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if user.check_password(
                form.cleaned_data["new_password1"]
            ):
                return Response(
                    {
                        "new_password1": [
                            "Choose a password different "
                            "from your current password."
                        ]
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            form.save()

        # Reset does not automatically log the account in.
        if (
            request.user.is_authenticated
            and request.user.pk == user.pk
        ):
            logout(request)

        return Response({
            "message": (
                "Your password has been reset. "
                "Sign in with your new password."
            )
        })