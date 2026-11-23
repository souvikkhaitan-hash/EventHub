from django.contrib.auth.models import User
from django.test import TestCase, override_settings
from django.urls import reverse

from rest_framework.test import APIClient


@override_settings(
    ALLOWED_HOSTS=["testserver", "localhost", "127.0.0.1"]
)
class AuthenticationTests(TestCase):

    def setUp(self):
        self.client = APIClient(enforce_csrf_checks=True)

        self.username = "arjun_sharma"
        self.email = "arjun.sharma@example.com"
        self.password = "Campus@2026Demo!"

    def get_csrf_token(self):
        response = self.client.get(reverse("csrf-token"))

        if response.status_code != 200:
            print("\nCSRF status:", response.status_code)
            print(
                "Request host:",
                response.wsgi_request.META.get("HTTP_HOST")
            )
            print(
                "Response:",
                response.content[:500].decode(
                    "utf-8",
                    errors="replace"
                )
            )

        self.assertEqual(response.status_code, 200)

        return response.json()["csrfToken"]

    def test_student_registration(self):
        token = self.get_csrf_token()

        response = self.client.post(
            reverse("register"),
            {
                "username": self.username,
                "email": self.email,
                "password": self.password,
                "first_name": "Arjun",
                "last_name": "Sharma",
                "roll_number": "BCA-001",
                "department": "BCA",
                "academic_year": "3",
            },
            format="json",
            HTTP_X_CSRFTOKEN=token,
        )

        self.assertEqual(response.status_code, 201)

        user = User.objects.get(username=self.username)

        self.assertTrue(user.check_password(self.password))
        self.assertNotEqual(user.password, self.password)

    def test_duplicate_registration(self):
        User.objects.create_user(
            username=self.username,
            email=self.email,
            password=self.password,
        )

        token = self.get_csrf_token()

        response = self.client.post(
            reverse("register"),
            {
                "username": self.username,
                "email": self.email,
                "password": self.password,
            },
            format="json",
            HTTP_X_CSRFTOKEN=token,
        )

        self.assertEqual(response.status_code, 400)

    def test_registration_without_csrf(self):
        response = self.client.post(
            reverse("register"),
            {
                "username": self.username,
                "email": self.email,
                "password": self.password,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 403)
        self.assertFalse(
            User.objects.filter(username=self.username).exists()
        )

    def test_login_and_current_user(self):
        User.objects.create_user(
            username=self.username,
            email=self.email,
            password=self.password,
        )

        token = self.get_csrf_token()

        response = self.client.post(
            reverse("login"),
            {
                "username": self.username,
                "password": self.password,
            },
            format="json",
            HTTP_X_CSRFTOKEN=token,
        )

        self.assertEqual(response.status_code, 200)

        response = self.client.get(reverse("current-user"))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.data["username"],
            self.username
        )

    def test_invalid_login(self):
        token = self.get_csrf_token()

        response = self.client.post(
            reverse("login"),
            {
                "username": "unknown_user",
                "password": "wrong_password",
            },
            format="json",
            HTTP_X_CSRFTOKEN=token,
        )

        self.assertEqual(response.status_code, 400)

    def test_unauthenticated_user(self):
        response = self.client.get(reverse("current-user"))

        self.assertIn(response.status_code, [401, 403])