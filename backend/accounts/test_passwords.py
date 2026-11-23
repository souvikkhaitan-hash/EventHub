from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth.models import User
from django.contrib.auth.tokens import default_token_generator
from django.core import mail
from django.test import TestCase, override_settings
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode

from rest_framework.test import APIClient


@override_settings(
    ALLOWED_HOSTS=["testserver"],
    EMAIL_BACKEND=(
        "django.core.mail.backends.locmem.EmailBackend"
    ),
    FRONTEND_URL="http://localhost:5173",
    PASSWORD_RESET_TIMEOUT=1800,
    CACHES={
        "default": {
            "BACKEND": (
                "django.core.cache.backends.locmem.LocMemCache"
            ),
        },
        "account_security": {
            "BACKEND": (
                "django.core.cache.backends.locmem.LocMemCache"
            ),
            "LOCATION": "password-tests",
        },
    },
)
class PasswordTests(TestCase):

    def setUp(self):
        self.user = User.objects.create_user(
            username="password_student",
            email="student@example.test",
            password="Original!Campus58",
        )

        self.client = APIClient(
            enforce_csrf_checks=True
        )

        # Disable throttles for functional tests.
        # Test their behavior separately below.
        self.throttle_patch = patch(
            "accounts.password_views."
            "AccountThrottle.allow_request",
            return_value=True,
        )

        self.throttle_patch.start()
        self.addCleanup(self.throttle_patch.stop)

    def csrf(self, client=None):
        client = client or self.client

        return client.get(
            "/api/auth/csrf/"
        ).json()["csrfToken"]

    def post(self, path, data, client=None):
        client = client or self.client

        return client.post(
            path,
            data,
            format="json",
            HTTP_X_CSRFTOKEN=self.csrf(client),
        )

    def change(self, **overrides):
        self.client.force_login(self.user)

        return self.post(
            "/api/auth/password/change/",
            {
                "old_password": "Original!Campus58",
                "new_password1": "Changed!River79",
                "new_password2": "Changed!River79",
                **overrides,
            },
        )

    def reset_details(self):
        return {
            "uid": urlsafe_base64_encode(
                force_bytes(self.user.pk)
            ),
            "token": default_token_generator.make_token(
                self.user
            ),
            "new_password1": "Recovered!Forest92",
            "new_password2": "Recovered!Forest92",
        }

    def test_password_change_requires_login(self):
        response = self.post(
            "/api/auth/password/change/",
            {
                "old_password": "Original!Campus58",
                "new_password1": "Changed!River79",
                "new_password2": "Changed!River79",
            },
        )

        self.assertIn(
            response.status_code,
            [401, 403],
        )

    def test_password_change_requires_correct_current_password(self):
        response = self.change(
            old_password="Incorrect!Password"
        )

        self.assertEqual(
            response.status_code, 400
        )

        self.user.refresh_from_db()

        self.assertTrue(
            self.user.check_password(
                "Original!Campus58"
            )
        )

    def test_password_change_checks_confirmation(self):
        response = self.change(
            new_password2="Different!Password82"
        )

        self.assertEqual(
            response.status_code, 400
        )

    def test_weak_password_is_rejected(self):
        response = self.change(
            new_password1="12345678",
            new_password2="12345678",
        )

        self.assertEqual(
            response.status_code, 400
        )

    def test_successful_change_preserves_current_session(self):
        response = self.change()

        self.assertEqual(
            response.status_code, 200
        )

        self.user.refresh_from_db()

        self.assertTrue(
            self.user.check_password(
                "Changed!River79"
            )
        )

        self.assertFalse(
            self.user.check_password(
                "Original!Campus58"
            )
        )

        self.assertEqual(
            self.client.get(
                "/api/auth/me/"
            ).status_code,
            200,
        )

    def test_change_invalidates_another_session(self):
        other_client = APIClient(
            enforce_csrf_checks=True
        )

        other_client.force_login(self.user)

        self.assertEqual(
            self.change().status_code,
            200,
        )

        self.assertIn(
            other_client.get(
                "/api/auth/me/"
            ).status_code,
            [401, 403],
        )

    def test_change_requires_csrf(self):
        self.client.force_login(self.user)

        response = self.client.post(
            "/api/auth/password/change/",
            {
                "old_password": "Original!Campus58",
                "new_password1": "Changed!River79",
                "new_password2": "Changed!River79",
            },
            format="json",
        )

        self.assertEqual(
            response.status_code, 403
        )

    def test_reset_request_uses_generic_response(self):
        known = self.post(
            "/api/auth/password/reset/",
            {"email": "student@example.test"},
        )

        unknown = self.post(
            "/api/auth/password/reset/",
            {"email": "unknown@example.test"},
        )

        self.assertEqual(
            known.status_code, 202
        )

        self.assertEqual(
            known.data, unknown.data
        )

        self.assertEqual(
            len(mail.outbox), 1
        )

        self.assertIn(
            "http://localhost:5173/reset-password/",
            mail.outbox[0].body,
        )

    def test_inactive_account_does_not_receive_reset(self):
        self.user.is_active = False
        self.user.save(update_fields=["is_active"])

        response = self.post(
            "/api/auth/password/reset/",
            {"email": "student@example.test"},
        )

        self.assertEqual(
            response.status_code, 202
        )

        self.assertEqual(
            len(mail.outbox), 0
        )

    def test_valid_reset_and_reused_token(self):
        details = self.reset_details()

        first = self.post(
            "/api/auth/password/reset/confirm/",
            details,
        )

        second = self.post(
            "/api/auth/password/reset/confirm/",
            details,
        )

        self.assertEqual(
            first.status_code, 200
        )

        self.assertEqual(
            second.status_code, 400
        )

        self.user.refresh_from_db()

        self.assertTrue(
            self.user.check_password(
                "Recovered!Forest92"
            )
        )

    def test_invalid_token_is_rejected(self):
        details = self.reset_details()
        details["token"] = "invalid-token"

        response = self.post(
            "/api/auth/password/reset/confirm/",
            details,
        )

        self.assertEqual(
            response.status_code, 400
        )

    def test_expired_token_is_rejected(self):
        details = self.reset_details()

        future = (
            default_token_generator._now()
            + timedelta(minutes=31)
        )

        with patch.object(
            default_token_generator,
            "_now",
            return_value=future,
        ):
            response = self.post(
                "/api/auth/password/reset/confirm/",
                details,
            )

        self.assertEqual(
            response.status_code, 400
        )

    def test_reset_does_not_automatically_log_in(self):
        response = self.post(
            "/api/auth/password/reset/confirm/",
            self.reset_details(),
        )

        self.assertEqual(
            response.status_code, 200
        )

        self.assertIn(
            self.client.get(
                "/api/auth/me/"
            ).status_code,
            [401, 403],
        )

    def test_same_password_is_rejected(self):
        response = self.change(
            new_password1="Original!Campus58",
            new_password2="Original!Campus58",
        )

        self.assertEqual(
            response.status_code, 400
        )

    def test_request_limit_returns_429(self):
        self.throttle_patch.stop()

        from django.core.cache import caches

        caches["account_security"].clear()

        responses = [
            self.post(
                "/api/auth/password/reset/",
                {"email": "unknown@example.test"},
            )
            for _ in range(4)
        ]

        self.assertEqual(
            responses[-1].status_code, 429
        )

        caches["account_security"].clear()