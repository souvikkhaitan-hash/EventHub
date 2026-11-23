from django.contrib.auth.models import (
    Group,
    Permission,
    User,
)

from django.test import TestCase, override_settings

from rest_framework.test import APIClient

from .models import (
    OrganizerApplication,
    OrganizerApplicationHistory,
    StudentProfile,
)


@override_settings(ALLOWED_HOSTS=["testserver"])
class OrganizerApplicationTests(TestCase):

    def setUp(self):
        self.student = User.objects.create_user(
            username="applicant",
            email="applicant@example.test",
            password="Campus!Applicant58",
            first_name="Ananya",
            last_name="Rao",
        )

        StudentProfile.objects.create(
            user=self.student,
            roll_number="BCA-201",
            department="BCA",
            academic_year="3",
        )

        self.admin = User.objects.create_superuser(
            username="review_admin",
            email="admin@example.test",
            password="Campus!Reviewer79",
        )

        self.client = APIClient(
            enforce_csrf_checks=True
        )

        self.application_url = (
            "/api/auth/organizer-application/"
        )

        self.admin_url = (
            "/api/auth/admin/organizer-applications/"
        )

        self.payload = {
            "organization": "Campus Coding Club",
            "position": "Student coordinator",
            "reason": (
                "I coordinate workshops and coding "
                "events for our department."
            ),
            "revision": 0,
        }

    def post_as(self, user, url, data):
        self.client.force_login(user)

        token = self.client.get(
            "/api/auth/csrf/"
        ).json()["csrfToken"]

        return self.client.post(
            url,
            data,
            format="json",
            HTTP_X_CSRFTOKEN=token,
        )

    def submit(self):
        return self.post_as(
            self.student,
            self.application_url,
            self.payload,
        )

    def application(self):
        self.submit()

        return OrganizerApplication.objects.get(
            user=self.student
        )

    def decide(
        self,
        application,
        decision="approved",
        revision=None,
        note="",
        reviewer=None,
    ):
        return self.post_as(
            reviewer or self.admin,
            f"{self.admin_url}{application.pk}/",
            {
                "decision": decision,
                "revision": (
                    application.revision
                    if revision is None
                    else revision
                ),
                "decision_note": note,
            },
        )

    def test_anonymous_cannot_view_or_submit(self):
        self.assertIn(
            self.client.get(
                self.application_url
            ).status_code,
            [401, 403],
        )

        self.assertIn(
            self.client.post(
                self.application_url,
                self.payload,
                format="json",
            ).status_code,
            [401, 403],
        )

    def test_submission_creates_pending_application_and_history(self):
        response = self.submit()

        self.assertEqual(
            response.status_code, 201
        )

        application = OrganizerApplication.objects.get(
            user=self.student
        )

        self.assertEqual(
            application.status, "pending"
        )

        self.assertEqual(
            application.revision, 1
        )

        self.assertEqual(
            application.history.count(), 1
        )

        self.assertFalse(
            self.student.groups.filter(
                name="Organizer"
            ).exists()
        )

    def test_incomplete_profile_cannot_apply(self):
        StudentProfile.objects.filter(
            user=self.student
        ).delete()

        self.assertEqual(
            self.submit().status_code,
            400,
        )

        self.assertFalse(
            OrganizerApplication.objects.exists()
        )

    def test_pending_application_cannot_be_submitted_twice(self):
        self.assertEqual(
            self.submit().status_code, 201
        )

        self.assertEqual(
            self.submit().status_code, 409
        )

        self.assertEqual(
            OrganizerApplication.objects.count(),
            1,
        )

        self.assertEqual(
            OrganizerApplicationHistory.objects.count(),
            1,
        )

    def test_applicant_cannot_set_status_or_another_user(self):
        for field, value in [
            ("status", "approved"),
            ("user", self.admin.pk),
            ("reviewed_by", self.admin.pk),
        ]:
            with self.subTest(field=field):
                response = self.post_as(
                    self.student,
                    self.application_url,
                    {
                        **self.payload,
                        field: value,
                    },
                )

                self.assertEqual(
                    response.status_code, 400
                )

        self.assertFalse(
            OrganizerApplication.objects.exists()
        )

    def test_application_status_is_private(self):
        self.application()

        other = User.objects.create_user(
            username="other_student"
        )

        self.client.force_login(other)

        response = self.client.get(
            self.application_url
        )

        self.assertEqual(
            response.status_code, 200
        )

        self.assertIsNone(
            response.data["application"]
        )

    def test_student_cannot_access_admin_list_or_decisions(self):
        application = self.application()

        self.client.force_login(self.student)

        self.assertEqual(
            self.client.get(
                self.admin_url
            ).status_code,
            403,
        )

        self.assertEqual(
            self.decide(
                application,
                reviewer=self.student,
            ).status_code,
            403,
        )

    def test_staff_without_review_permission_is_denied(self):
        staff = User.objects.create_user(
            username="ordinary_staff",
            is_staff=True,
        )

        self.client.force_login(staff)

        self.assertEqual(
            self.client.get(
                self.admin_url
            ).status_code,
            403,
        )

    def test_authorized_staff_can_review(self):
        application = self.application()

        staff = User.objects.create_user(
            username="authorized_staff",
            is_staff=True,
        )

        permission = Permission.objects.get(
            content_type__app_label="accounts",
            codename="review_organizerapplication",
        )

        staff.user_permissions.add(permission)

        self.assertEqual(
            self.decide(
                application,
                reviewer=staff,
            ).status_code,
            200,
        )

    def test_approval_grants_only_organizer_membership(self):
        application = self.application()

        self.assertEqual(
            self.decide(application).status_code,
            200,
        )

        self.student.refresh_from_db()
        application.refresh_from_db()

        self.assertTrue(
            self.student.groups.filter(
                name="Organizer"
            ).exists()
        )

        self.assertFalse(self.student.is_staff)
        self.assertFalse(self.student.is_superuser)

        self.assertEqual(
            application.status, "approved"
        )

        self.assertEqual(
            application.reviewed_by_id,
            self.admin.pk,
        )

        self.assertEqual(
            application.history.count(), 2
        )

    def test_admin_cannot_review_own_application(self):
        application = OrganizerApplication.objects.create(
            user=self.admin,
            organization="Admin club",
            position="Coordinator",
            reason="Organizing campus events.",
        )

        self.assertEqual(
            self.decide(application).status_code,
            403,
        )

        application.refresh_from_db()

        self.assertEqual(
            application.status, "pending"
        )

    def test_rejection_requires_explanation(self):
        application = self.application()

        self.assertEqual(
            self.decide(
                application,
                decision="rejected",
            ).status_code,
            400,
        )

        application.refresh_from_db()

        self.assertEqual(
            application.status, "pending"
        )

    def test_resubmission_preserves_history_and_increments_revision(self):
        application = self.application()

        self.decide(
            application,
            decision="changes_requested",
            note="Please clarify your club position.",
        )

        response = self.post_as(
            self.student,
            self.application_url,
            {
                **self.payload,
                "position": "Club secretary",
                "revision": 1,
            },
        )

        self.assertEqual(
            response.status_code, 200
        )

        application.refresh_from_db()

        self.assertEqual(
            application.status, "pending"
        )

        self.assertEqual(
            application.revision, 2
        )

        self.assertEqual(
            application.history.count(), 3
        )

        self.assertIsNone(
            application.reviewed_by
        )

        self.assertEqual(
            application.decision_note, ""
        )

        first_submission = (
            application.history
            .filter(action="submitted")
            .get()
        )

        self.assertEqual(
            first_submission.application_data["position"],
            "Student coordinator",
        )

    def test_outdated_review_is_rejected(self):
        application = self.application()

        response = self.decide(
            application,
            revision=2,
        )

        self.assertEqual(
            response.status_code, 409
        )

        self.assertFalse(
            self.student.groups.filter(
                name="Organizer"
            ).exists()
        )

    def test_second_decision_cannot_overwrite_first(self):
        application = self.application()

        self.assertEqual(
            self.decide(application).status_code,
            200,
        )

        self.assertEqual(
            self.decide(
                application,
                decision="rejected",
                note="Another decision.",
            ).status_code,
            409,
        )

        application.refresh_from_db()

        self.assertEqual(
            application.status, "approved"
        )

        self.assertEqual(
            application.history.count(), 2
        )

    def test_existing_organizer_keeps_access(self):
        group, _ = Group.objects.get_or_create(
            name="Organizer"
        )

        self.student.groups.add(group)

        self.assertEqual(
            self.submit().status_code, 409
        )

        self.assertTrue(
            self.student.groups.filter(
                name="Organizer"
            ).exists()
        )

    def test_submission_requires_csrf(self):
        self.client.force_login(self.student)

        response = self.client.post(
            self.application_url,
            self.payload,
            format="json",
        )

        self.assertEqual(
            response.status_code, 403
        )

        self.assertFalse(
            OrganizerApplication.objects.exists()
        )

    def test_admin_list_is_paginated(self):
        self.application()

        self.client.force_login(self.admin)

        response = self.client.get(
            self.admin_url
        )

        self.assertEqual(
            response.status_code, 200
        )

        self.assertEqual(
            response.data["count"], 1
        )

        self.assertEqual(
            len(response.data["results"]), 1
        )

    def test_inactive_applicant_cannot_be_approved(self):
        application = self.application()

        self.student.is_active = False
        self.student.save(
            update_fields=["is_active"]
        )

        self.assertEqual(
            self.decide(application).status_code,
            409,
        )

        self.assertFalse(
            self.student.groups.filter(
                name="Organizer"
            ).exists()
        )