import csv
import io
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.test import TestCase
from django.utils import timezone

from openpyxl import load_workbook
from rest_framework.test import APIClient

from accounts.models import StudentProfile

from .models import (
    Event,
    EventStaffMembership,
    EventTicket,
    Registration,
)


class AttendanceExportTests(TestCase):
    def setUp(self):
        User = get_user_model()

        self.owner = User.objects.create_user(
            username="export_owner"
        )
        self.staff = User.objects.create_user(
            username="export_staff"
        )
        self.student = User.objects.create_user(
            username="export_student",
            first_name="Test",
            last_name="Student",
        )
        self.pending_student = User.objects.create_user(
            username="export_pending"
        )

        group, _ = Group.objects.get_or_create(
            name="Organizer"
        )
        self.owner.groups.add(group)

        StudentProfile.objects.create(
            user=self.student,
            roll_number="001234",
            department="BCA",
            academic_year="3",
        )

        now = timezone.now()

        self.event = Event.objects.create(
            organizer=self.owner,
            title="Export Workshop",
            description="Export tests.",
            category="workshop",
            venue="Lab",
            start_datetime=now + timedelta(days=1),
            end_datetime=now + timedelta(days=1, hours=2),
            registration_deadline=now + timedelta(hours=12),
            capacity=50,
        )

        self.present = Registration.objects.create(
            event=self.event,
            student=self.student,
        )
        Registration.objects.create(
            event=self.event,
            student=self.pending_student,
        )

        EventTicket.objects.create(
            registration=self.present,
            checked_in_at=now,
            checked_in_by=self.owner,
        )

        self.membership = EventStaffMembership.objects.create(
            event=self.event,
            user=self.staff,
            role="manager",
            assigned_by=self.owner,
        )

        self.client = APIClient()
        self.client.force_authenticate(user=self.owner)

        self.url = (
            f"/api/events/manage/{self.event.pk}/"
            "attendance-export/"
        )

    def download(self, file_type="csv", report="attendance"):
        response = self.client.get(
            self.url,
            {
                "file_type": file_type,
                "report": report,
            },
        )

        self.assertEqual(response.status_code, 200)

        # Consuming the stream lets Django's test client
        # close the response with its test safeguards.
        return b"".join(response.streaming_content)

    def csv_rows(self, report="attendance"):
        content = self.download(report=report)

        return list(
            csv.DictReader(
                io.StringIO(content.decode("utf-8-sig"))
            )
        )

    def test_full_register_includes_present_and_pending(self):
        rows = self.csv_rows()

        self.assertEqual(len(rows), 2)
        self.assertEqual(
            {row["Attendance"] for row in rows},
            {"Present", "Pending"},
        )

    def test_od_list_contains_only_present(self):
        rows = self.csv_rows("od")

        self.assertEqual(len(rows), 1)
        self.assertEqual(
            rows[0]["Username"],
            self.student.username,
        )

    def test_cancelled_registration_is_excluded(self):
        self.present.status = "cancelled"
        self.present.save(update_fields=["status"])

        self.assertEqual(len(self.csv_rows()), 1)
        self.assertEqual(self.csv_rows("od"), [])

    def test_excel_preserves_leading_zero_roll_number(self):
        content = self.download("xlsx")
        workbook = load_workbook(
            io.BytesIO(content),
            read_only=True,
        )

        try:
            rows = list(
                workbook.active.iter_rows(values_only=True)
            )
            headers = rows[0]
            username_column = headers.index("Username")
            roll_column = headers.index("Roll / register number")

            row = next(
                row for row in rows[1:]
                if row[username_column] == self.student.username
            )

            self.assertEqual(row[roll_column], "001234")
        finally:
            workbook.close()

    def test_csv_escapes_formula_like_names(self):
        self.student.first_name = "=1+1"
        self.student.last_name = ""
        self.student.save(
            update_fields=["first_name", "last_name"]
        )

        row = next(
            row for row in self.csv_rows()
            if row["Username"] == self.student.username
        )

        self.assertEqual(
            row["Participant name"],
            "'=1+1",
        )

    def test_manager_can_export(self):
        self.client.force_authenticate(user=self.staff)
        self.assertEqual(len(self.csv_rows()), 2)

    def test_attendance_volunteer_cannot_export(self):
        self.membership.role = "attendance"
        self.membership.save(update_fields=["role"])
        self.client.force_authenticate(user=self.staff)

        response = self.client.get(self.url)

        self.assertEqual(response.status_code, 404)

    def test_coordinator_cannot_export(self):
        self.membership.role = "certificates"
        self.membership.save(update_fields=["role"])
        self.client.force_authenticate(user=self.staff)

        response = self.client.get(self.url)

        self.assertEqual(response.status_code, 404)

    def test_invalid_report_is_rejected(self):
        response = self.client.get(
            self.url,
            {"report": "unknown"},
        )

        self.assertEqual(response.status_code, 400)