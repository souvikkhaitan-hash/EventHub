import io
import json
import tempfile

from django.db import transaction
from django.http import FileResponse
from django.utils import timezone

from rest_framework.views import APIView

from .models import Registration
from .staff_access import (
    HasEventWorkspaceAccess,
    get_staff_event,
)


def timestamp(value):
    return value.isoformat() if value else None


def participant_reference(registration):
    student = registration.student

    profile = getattr(student, "student_profile", None)
    ticket = getattr(registration, "ticket", None)
    membership = getattr(
        registration,
        "team_membership",
        None,
    )

    return {
        "registration_id": registration.pk,
        "registration_status": registration.status,
        "registered_at": timestamp(
            registration.registered_at
        ),
        "cancelled_at": timestamp(
            registration.cancelled_at
        ),
        "participant": {
            "user_id": student.pk,
            "username": student.username,
            "full_name": (
                student.get_full_name()
                or student.username
            ),
            "roll_number": (
                profile.roll_number if profile else ""
            ),
            "department": (
                profile.department if profile else ""
            ),
            "academic_year": (
                profile.academic_year if profile else ""
            ),
        },
        "ticket": (
            {
                "uuid": str(ticket.token),
                "checked_in_at": timestamp(
                    ticket.checked_in_at
                ),
                "checked_in_by_user_id": (
                    ticket.checked_in_by_id
                ),
            }
            if ticket
            else None
        ),
        "team": (
            {
                "id": membership.team_id,
                "name": membership.team.name,
                "status": membership.team.status,
                "participant_role": membership.role,
            }
            if membership
            else None
        ),
    }


class EventReferenceDownloadView(APIView):
    permission_classes = [HasEventWorkspaceAccess]

    def get(self, request, event_id):
        output = tempfile.SpooledTemporaryFile(
            max_size=8 * 1024 * 1024,
            mode="w+b",
        )

        wrapper = None

        try:
            with transaction.atomic():
                # Owner-only access. Use the same event lock as
                # registration, attendance and staff changes.
                event = get_staff_event(
                    request.user,
                    event_id,
                    "manage_staff",
                    lock=True,
                )

                generated_at = timezone.now()

                metadata = {
                    "schema": "eventhub.event_reference.v1",
                    "purpose": "Private event reference",
                    "generated_at": timestamp(generated_at),
                    "generated_by_user_id": request.user.pk,
                    "notes": [
                        "This file is a reference, not a database backup.",
                        "It cannot be imported to restore accounts or events.",
                        "Attendance must be confirmed in EventHub.",
                        "Ticket UUIDs are private entry codes.",
                        "Only already-created tickets appear in this file.",
                    ],
                    "event": {
                        "id": event.pk,
                        "title": event.title,
                        "venue": event.venue,
                        "category": event.category,
                        "status": event.status,
                        "organizer_user_id": event.organizer_id,
                        "start_datetime": timestamp(
                            event.start_datetime
                        ),
                        "end_datetime": timestamp(
                            event.end_datetime
                        ),
                        "registration_deadline": timestamp(
                            event.registration_deadline
                        ),
                        "capacity": event.capacity,
                        "registration_mode": (
                            event.registration_mode
                        ),
                    },
                }

                registrations = (
                    Registration.objects
                    .filter(event=event)
                    .select_related(
                        "student__student_profile",
                        "ticket",
                        "team_membership__team",
                    )
                    .order_by("pk")
                )

                wrapper = io.TextIOWrapper(
                    output,
                    encoding="utf-8",
                    newline="\n",
                )

                # Write records incrementally rather than building
                # the whole participant list in memory.
                prefix = json.dumps(
                    metadata,
                    ensure_ascii=False,
                    indent=2,
                )

                wrapper.write(prefix[:-1])
                wrapper.write(',\n  "registrations": [\n')

                total = 0

                for registration in registrations.iterator(
                    chunk_size=1000
                ):
                    if total:
                        wrapper.write(",\n")

                    json.dump(
                        participant_reference(registration),
                        wrapper,
                        ensure_ascii=False,
                        indent=2,
                    )

                    total += 1

                wrapper.write(
                    '\n  ],\n  "registration_count": '
                    + str(total)
                    + "\n}\n"
                )

                wrapper.flush()
                wrapper.detach()
                wrapper = None

            output.seek(0)

            filename = (
                f"event-{event.pk}-reference-"
                f"{generated_at.strftime('%Y%m%dT%H%M%SZ')}.json"
            )

            response = FileResponse(
                output,
                as_attachment=True,
                filename=filename,
                content_type="application/json",
            )

            response["Cache-Control"] = "private, no-store"
            response["X-Content-Type-Options"] = "nosniff"

            return response

        except Exception:
            if wrapper is not None:
                wrapper.close()

            output.close()
            raise