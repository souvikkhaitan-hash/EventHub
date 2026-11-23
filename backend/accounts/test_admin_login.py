from django.contrib.auth.models import (
    Permission,
    User,
)

from django.core.cache import caches
from django.test import TestCase, override_settings

from rest_framework.test import APIClient


@override_settings(
    ALLOWED_HOSTS=["testserver"],
    ACCOUNT_LOGIN_IP_RATE="1000/min",
    ACCOUNT_LOGIN_USERNAME_RATE="1000/min",
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
            "LOCATION": "admin-login-tests",
        },
    },
)
class AdminLoginTests(TestCase):

    def setUp(self):
        caches["account_security"].clear()

        self.client = APIClient(
            enforce_csrf_checks=True
        )

        self.password = "Campus!Access79"

        self.student = User.objects.create_user(
            username="login_student",
            password=self.password,
        )

        self.admin = User.objects.create_superuser(
            username="login_admin",
            email="admin@example.test",
            password=self.password,
        )

    def login_as(
        self,
        username,
        portal="admin",
        password=None,
    ):
        token = self.client.get(
            "/api/auth/csrf/"
        ).json()["csrfToken"]

        return self.client.post(
            "/api/auth/login/",
            {
                "username": username,
                "password": (
                    self.password
                    if password is None
                    else password
                ),
                "portal": portal,
            },
            format="json",
            HTTP_X_CSRFTOKEN=token,
        )

    def test_superuser_can_use_admin_portal(self):
        response = self.login_as(
            self.admin.username
        )

        self.assertEqual(
            response.status_code, 200
        )

        self.assertTrue(
            response.data["user"][
                "can_review_organizers"
            ]
        )

    def test_student_is_rejected_without_login_session(self):
        response = self.login_as(
            self.student.username
        )

        self.assertEqual(
            response.status_code, 403
        )

        self.assertIn(
            self.client.get(
                "/api/auth/me/"
            ).status_code,
            [401, 403],
        )

    def test_staff_without_permission_is_rejected(self):
        staff = User.objects.create_user(
            username="login_staff",
            password=self.password,
            is_staff=True,
        )

        response = self.login_as(
            staff.username
        )

        self.assertEqual(
            response.status_code, 403
        )

    def test_authorized_staff_can_log_in(self):
        staff = User.objects.create_user(
            username="login_reviewer",
            password=self.password,
            is_staff=True,
        )

        permission = Permission.objects.get(
            content_type__app_label="accounts",
            codename="review_organizerapplication",
        )

        staff.user_permissions.add(permission)

        self.assertEqual(
            self.login_as(
                staff.username
            ).status_code,
            200,
        )

    def test_permission_without_staff_status_is_insufficient(self):
        permission = Permission.objects.get(
            content_type__app_label="accounts",
            codename="review_organizerapplication",
        )

        self.student.user_permissions.add(
            permission
        )

        self.assertEqual(
            self.login_as(
                self.student.username
            ).status_code,
            403,
        )

    def test_ordinary_login_still_works(self):
        response = self.login_as(
            self.student.username,
            portal="account",
        )

        self.assertEqual(
            response.status_code, 200
        )

        self.assertFalse(
            response.data["user"][
                "can_review_organizers"
            ]
        )

    def test_inactive_admin_cannot_log_in(self):
        self.admin.is_active = False

        self.admin.save(
            update_fields=["is_active"]
        )

        self.assertEqual(
            self.login_as(
                self.admin.username
            ).status_code,
            400,
        )

    def test_wrong_password_is_rejected(self):
        response = self.login_as(
            self.admin.username,
            password="Incorrect!Password",
        )

        self.assertEqual(
            response.status_code, 400
        )

    def test_unknown_portal_is_rejected(self):
        response = self.login_as(
            self.admin.username,
            portal="unsupported",
        )

        self.assertEqual(
            response.status_code, 400
        )

    def test_admin_login_requires_csrf(self):
        response = self.client.post(
            "/api/auth/login/",
            {
                "username": self.admin.username,
                "password": self.password,
                "portal": "admin",
            },
            format="json",
        )

        self.assertEqual(
            response.status_code, 403
        )

    @override_settings(
        ACCOUNT_LOGIN_USERNAME_RATE="3/min",
    )
    def test_repeated_login_requests_are_limited(self):
        responses = [
            self.login_as(
                self.student.username,
                portal="account",
                password="Wrong!Password",
            )
            for _ in range(4)
        ]

        self.assertEqual(
            responses[-1].status_code,
            429,
        )

    @override_settings(
        ACCOUNT_LOGIN_IP_RATE="3/min",
    )
    def test_ip_limit_applies_across_usernames(self):
        responses = [
            self.login_as(
                f"unknown_{number}",
                portal="account",
                password="Wrong!Password",
            )
            for number in range(4)
        ]

        self.assertEqual(
            responses[-1].status_code,
            429,
        )