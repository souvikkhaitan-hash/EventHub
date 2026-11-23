import csv
import io
import re
import tempfile
from zoneinfo import ZoneInfo

from django.http import FileResponse
from django.utils import timezone

from openpyxl import Workbook
from openpyxl.cell import WriteOnlyCell
from openpyxl.styles import Font, PatternFill
from openpyxl.utils import get_column_letter

from rest_framework import serializers
from rest_framework.views import APIView

from .models import Registration
from .staff_access import (
    HasEventWorkspaceAccess,
    get_staff_event,
)


IST = ZoneInfo("Asia/Kolkata")

XLSX_CONTENT_TYPE = (
    "application/vnd.openxmlformats-officedocument."
    "spreadsheetml.sheet"
)

# Remove control characters that cannot appear in an XLSX cell.
INVALID_CONTROLS = re.compile(
    r"[\x00-\x08\x0B-\x0C\x0E-\x1F]"
)

HEADERS = [
    "Registration ID",
    "Participant name",
    "Username",
    "Roll / register number",
    "Department / programme",
    "Academic year",
    "Team",
    "Attendance",
    "Check-in time (IST)",
    "Checked in by",
    "Event",
    "Event start (IST)",
    "Exported at (IST)",
]


class AttendanceExportInput(serializers.Serializer):
    file_type = serializers.ChoiceField(
        choices=["xlsx", "csv"],
        default="xlsx",
    )

    report = serializers.ChoiceField(
        choices=["attendance", "od"],
        default="attendance",
    )


def text_value(value):
    if value is None:
        return ""

    return INVALID_CONTROLS.sub("", str(value))


def csv_value(value):
    if not isinstance(value, str):
        return value

    value = text_value(value)

    # Prevent participant-controlled text from becoming a
    # spreadsheet formula when a CSV is opened.
    if value.lstrip().startswith(("=", "+", "-", "@")):
        return "'" + value

    return value


def ist_datetime(value):
    if value is None:
        return ""

    return timezone.localtime(value, IST).strftime(
        "%Y-%m-%d %H:%M:%S %z"
    )


def attendance_rows(event, report, exported_at):
    registrations = Registration.objects.filter(
        event=event,
        status="registered",
    )

    if report == "od":
        registrations = registrations.filter(
            ticket__checked_in_at__isnull=False
        )

    records = (
        registrations
        .order_by("student__username", "pk")
        .values_list(
            "pk",
            "student__first_name",
            "student__last_name",
            "student__username",
            "student__student_profile__roll_number",
            "student__student_profile__department",
            "student__student_profile__academic_year",
            "team_membership__team__name",
            "ticket__checked_in_at",
            "ticket__checked_in_by__username",
        )
    )

    event_start = ist_datetime(event.start_datetime)
    export_time = ist_datetime(exported_at)

    for record in records.iterator(chunk_size=1000):
        (
            registration_id,
            first_name,
            last_name,
            username,
            roll_number,
            department,
            academic_year,
            team_name,
            checked_in_at,
            checked_in_by,
        ) = record

        full_name = " ".join(
            part.strip()
            for part in [first_name or "", last_name or ""]
            if part.strip()
        )

        yield [
            registration_id,
            full_name or username,
            username,
            roll_number or "",
            department or "",
            academic_year or "",
            team_name or "",
            "Present" if checked_in_at else "Pending",
            ist_datetime(checked_in_at),
            checked_in_by or "",
            event.title,
            event_start,
            export_time,
        ]


def append_excel_row(sheet, values, *, header=False):
    cells = []

    for value in values:
        cell = WriteOnlyCell(sheet)

        if isinstance(value, str):
            # Explicit text also preserves leading-zero roll numbers.
            cell.value = text_value(value)
            cell.data_type = "s"
        else:
            cell.value = value

        if header:
            cell.font = Font(
                bold=True,
                color="FFFFFF",
            )
            cell.fill = PatternFill(
                fill_type="solid",
                fgColor="263552",
            )

        cells.append(cell)

    sheet.append(cells)


def write_excel(output, rows, report):
    workbook = Workbook(write_only=True)
    sheet = workbook.create_sheet(
        "OD attendance" if report == "od" else "Attendance"
    )

    sheet.freeze_panes = "A2"

    widths = [
        18, 28, 23, 25, 28, 17, 25,
        16, 29, 23, 35, 29, 29,
    ]

    for number, width in enumerate(widths, start=1):
        sheet.column_dimensions[
            get_column_letter(number)
        ].width = width

    append_excel_row(sheet, HEADERS, header=True)

    row_count = 1

    for row in rows:
        # Excel allows 1,048,576 rows per sheet.
        if row_count >= 1_048_576:
            raise serializers.ValidationError(
                "This report exceeds Excel's worksheet row limit."
            )

        append_excel_row(sheet, row)
        row_count += 1

    sheet.auto_filter.ref = (
        f"A1:{get_column_letter(len(HEADERS))}{row_count}"
    )

    workbook.save(output)


def write_csv(output, rows):
    # UTF-8 BOM helps Excel recognize Unicode participant names.
    wrapper = io.TextIOWrapper(
        output,
        encoding="utf-8-sig",
        newline="",
    )

    try:
        writer = csv.writer(wrapper)
        writer.writerow(HEADERS)

        for row in rows:
            writer.writerow([
                csv_value(value)
                for value in row
            ])

        wrapper.flush()
    finally:
        # Keep the binary file open for Django's FileResponse.
        wrapper.detach()


class AttendanceExportView(APIView):
    permission_classes = [HasEventWorkspaceAccess]

    def get(self, request, event_id):
        event = get_staff_event(
            request.user,
            event_id,
            "export_attendance",
        )

        serializer = AttendanceExportInput(
            data=request.query_params
        )
        serializer.is_valid(raise_exception=True)
        options = serializer.validated_data

        file_type = options["file_type"]
        report = options["report"]
        exported_at = timezone.now()

        # Small exports stay in memory; larger ones spill to disk.
        output = tempfile.SpooledTemporaryFile(
            max_size=8 * 1024 * 1024,
            mode="w+b",
        )

        try:
            rows = attendance_rows(
                event,
                report,
                exported_at,
            )

            if file_type == "xlsx":
                write_excel(output, rows, report)
                content_type = XLSX_CONTENT_TYPE
            else:
                write_csv(output, rows)
                content_type = "text/csv; charset=utf-8"

            output.seek(0)

            timestamp = exported_at.strftime(
                "%Y%m%dT%H%M%SZ"
            )

            response = FileResponse(
                output,
                as_attachment=True,
                filename=(
                    f"event-{event.pk}-{report}-"
                    f"{timestamp}.{file_type}"
                ),
                content_type=content_type,
            )

            response["Cache-Control"] = "private, no-store"
            response["X-Content-Type-Options"] = "nosniff"

            return response

        except Exception:
            output.close()
            raise