from django.contrib.auth.models import Group, User
from django.test import TestCase, override_settings

from rest_framework.test import APIClient

from .models import StudentProfile


@override_settings(ALLOWED_HOSTS=["testserver"])
class ProfileTests(TestCase):

    def setUp(self):
        self.client = APIClient(
            enforce_csrf_checks=True
        )

        self.user = User.objects.create_user(
            username="profile_student",
            email="profile@example.test",
            password="Campus!59River",
        )

        self.other = User.objects.create_user(
            username="another_student",
            first_name="Another",
        )

        self.details = {
            "first_name": "Souvik",
            "last_name": "Khaitan",
            "roll_number": "BCA-101",
            "department": "BCA",
            "academic_year": "3",
        }

    def csrf(self):
        response = self.client.get(
            "/api/auth/csrf/"
        )

        self.assertEqual(
            response.status_code, 200
        )

        return response.json()["csrfToken"]

    def save_profile(self, data=None):
        self.client.force_login(self.user)

        return self.client.put(
            "/api/auth/profile/",
            self.details if data is None else data,
            format="json",
            HTTP_X_CSRFTOKEN=self.csrf(),
        )

    def test_anonymous_access_is_denied(self):
        response = self.client.get(
            "/api/auth/profile/"
        )

        self.assertIn(
            response.status_code,
            [401, 403],
        )

    def test_existing_user_can_read_without_profile(self):
        self.client.force_login(self.user)

        response = self.client.get(
            "/api/auth/profile/"
        )

        self.assertEqual(
            response.status_code, 200
        )

        self.assertFalse(
            response.data["profile_complete"]
        )

        self.assertEqual(
            response.data["profile"]["roll_number"],
            "",
        )

        # Reading does not create a profile.
        self.assertFalse(
            StudentProfile.objects.exists()
        )

    def test_save_creates_profile_for_current_user(self):
        response = self.save_profile()

        self.assertEqual(
            response.status_code, 200
        )

        self.user.refresh_from_db()
        self.other.refresh_from_db()

        self.assertEqual(
            self.user.get_full_name(),
            "Souvik Khaitan",
        )

        self.assertEqual(
            self.user.student_profile.roll_number,
            "BCA-101",
        )

        self.assertEqual(
            self.other.first_name,
            "Another",
        )

        self.assertTrue(
            response.data["profile_complete"]
        )

        self.assertTrue(
            self.user.check_password(
                "Campus!59River"
            )
        )

    def test_repeated_save_updates_one_profile(self):
        self.save_profile()

        response = self.save_profile({
            **self.details,
            "department": "Computer Applications",
        })

        self.assertEqual(
            response.status_code, 200
        )

        self.assertEqual(
            StudentProfile.objects.count(), 1
        )

        self.assertEqual(
            response.data["profile"]["department"],
            "Computer Applications",
        )

    def test_update_without_csrf_is_denied(self):
        self.client.force_login(self.user)

        response = self.client.put(
            "/api/auth/profile/",
            self.details,
            format="json",
        )

        self.assertEqual(
            response.status_code, 403
        )

        self.assertFalse(
            StudentProfile.objects.exists()
        )

    def test_invalid_year_is_rejected(self):
        response = self.save_profile({
            **self.details,
            "academic_year": "99",
        })

        self.assertEqual(
            response.status_code, 400
        )

        self.assertFalse(
            StudentProfile.objects.exists()
        )

    def test_blank_roll_number_is_rejected(self):
        response = self.save_profile({
            **self.details,
            "roll_number": "   ",
        })

        self.assertEqual(
            response.status_code, 400
        )

    def test_identity_and_privilege_changes_are_rejected(self):
        for field, value in [
            ("user_id", self.other.pk),
            ("is_staff", True),
            ("is_organizer", True),
            ("email", "changed@example.test"),
        ]:
            with self.subTest(field=field):
                response = self.save_profile({
                    **self.details,
                    field: value,
                })

                self.assertEqual(
                    response.status_code, 400
                )

        self.assertFalse(
            StudentProfile.objects.exists()
        )

    def test_organizer_permissions_are_preserved(self):
        group = Group.objects.create(
            name="Organizer"
        )

        self.user.groups.add(group)

        response = self.save_profile()

        self.assertEqual(
            response.status_code, 200
        )

        self.assertTrue(
            response.data["is_organizer"]
        )

    def test_last_name_can_be_empty(self):
        response = self.save_profile({
            **self.details,
            "last_name": "",
        })

        self.assertEqual(
            response.status_code, 200
        )

        self.assertEqual(
            response.data["full_name"],
            "Souvik",
        )