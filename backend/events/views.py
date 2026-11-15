from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect

from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import (
    Event,
    Registration,
    EventTicket,
    TeamMembership,
)
from .permissions import IsOrganizer, IsStudent
from .serializers import (
    EventSerializer,
    RegistrationSerializer,
    OrganizerParticipantSerializer,
    EventTicketSerializer
)
import uuid
import json
import urllib.error
import urllib.request

from django.conf import settings


@api_view(["GET"])
def eventhub_info(request):
    data = {
        "project": "EventHub",
        "description": "College Event Registration and Management System",
        "frontend": "React",
        "backend": "Django REST Framework",
        "database": "PostgreSQL",
        "status": "Backend API is working"
    }

    return Response(data)

class PublicEventListView(APIView):

    permission_classes = [AllowAny]

    def get(self, request):
        events = (
            Event.objects
            .filter(
                status="published",
                start_datetime__gt=timezone.now()
            )
            .select_related("organizer")
            .order_by("start_datetime")
        )

        serializer = EventSerializer(
            events,
            many=True
        )

        return Response(serializer.data)
    
@method_decorator(csrf_protect, name="dispatch")
class OrganizerEventListView(APIView):

    permission_classes = [IsOrganizer]

    def get(self, request):
        events = (
            Event.objects
            .filter(organizer=request.user)
            .select_related("organizer")
            .order_by("-created_at")
        )

        serializer = EventSerializer(
            events,
            many=True
        )

        return Response(serializer.data)

    def post(self, request):
        serializer = EventSerializer(
            data=request.data
        )

        serializer.is_valid(raise_exception=True)

        event = serializer.save(
            organizer=request.user,
            status="draft"
        )

        return Response(
            EventSerializer(event).data,
            status=status.HTTP_201_CREATED
        )



class PublicEventDetailView(APIView):
    permission_classes = [AllowAny]

    def get(self, request, event_id):
        event = get_object_or_404(
            Event.objects.select_related("organizer"),
            id=event_id,
            status="published",
            start_datetime__gt=timezone.now()
        )

        serializer = EventSerializer(event)

        return Response(serializer.data)

@method_decorator(csrf_protect, name="dispatch")
class EventRegistrationView(APIView):

    permission_classes = [IsStudent]

    def post(self, request, event_id):

        with transaction.atomic():

            # Lock the event until this transaction finishes.
            event = (
                Event.objects
                .select_for_update()
                .filter(id=event_id)
                .first()
            )

            if event is None:
                return Response(
                    {"message": "Event not found."},
                    status=status.HTTP_404_NOT_FOUND
                )

            if event.registration_mode != "individual":
                return Response(
                    {
                        "message": "This event requires team registration."
                    },
                    status=status.HTTP_400_BAD_REQUEST
                )

            now = timezone.now()

            # Only published events accept registrations.
            if event.status != "published":
                return Response(
                    {
                        "message":
                        "Registration is not available for this event."
                    },
                    status=status.HTTP_400_BAD_REQUEST
                )

            # Prevent registrations after the event begins.
            if event.start_datetime <= now:
                return Response(
                    {
                        "message": "This event has already started."
                    },
                    status=status.HTTP_400_BAD_REQUEST
                )

            # Check registration deadline.
            if event.registration_deadline <= now:
                return Response(
                    {
                        "message": "Registration has closed."
                    },
                    status=status.HTTP_400_BAD_REQUEST
                )

            # Prevent organizers from registering for
            # their own events.
            if event.organizer_id == request.user.id:
                return Response(
                    {
                        "message":
                        "You cannot register for your own event."
                    },
                    status=status.HTTP_403_FORBIDDEN
                )

            existing = Registration.objects.filter(
                event=event,
                student=request.user
            ).first()

            # Already registered.
            if existing and existing.status == "registered":
                return Response(
                    {
                        "message":
                        "You are already registered for this event."
                    },
                    status=status.HTTP_409_CONFLICT
                )

            # Count confirmed registrations only.
            registered_count = Registration.objects.filter(
                event=event,
                status="registered"
            ).count()

            if registered_count >= event.capacity:
                return Response(
                    {"message": "This event is fully booked."},
                    status=status.HTTP_409_CONFLICT
                )

            if existing:
                # Reactivate a previously cancelled registration.
                existing.status = "registered"
                existing.cancelled_at = None
                existing.registered_at = now

                existing.save(
                    update_fields=[
                        "status",
                        "cancelled_at",
                        "registered_at",
                    ]
                )

                registration = existing
                # Invalidate any QR token issued before cancellation.
                EventTicket.objects.filter(
                    registration=existing
                ).update(
                    token=uuid.uuid4(),
                    checked_in_at=None,
                    checked_in_by=None,
                )

            else:
                registration = Registration.objects.create(
                    event=event,
                    student=request.user,
                    status="registered"
                )

            serializer = RegistrationSerializer(
                registration
            )

            return Response(
                {
                    "message": "Registration successful.",
                    "registration": serializer.data
                },
                status=status.HTTP_201_CREATED
            )

class MyRegistrationsView(APIView):

    permission_classes = [IsStudent]

    def get(self, request):

        registrations = (
            Registration.objects
            .filter(student=request.user)
            .select_related("event")
            .order_by("-registered_at")
        )

        serializer = RegistrationSerializer(
            registrations,
            many=True
        )

        return Response(serializer.data)

@method_decorator(csrf_protect, name="dispatch")
class CancelRegistrationView(APIView):

    permission_classes = [IsStudent]

    def post(self, request, registration_id):

        with transaction.atomic():

            # First look up the registration without locking.
            lookup = Registration.objects.filter(
                id=registration_id,
                student=request.user
            ).values("event_id").first()

            if lookup is None:
                return Response(
                    {"message": "Registration not found."},
                    status=status.HTTP_404_NOT_FOUND
                )

            # Lock the event first, maintaining the same
            # lock order as the registration endpoint.
            event = (
                Event.objects
                .select_for_update()
                .get(id=lookup["event_id"])
            )

            registration = (
                Registration.objects
                .select_for_update()
                .filter(
                    id=registration_id,
                    student=request.user,
                    event=event
                )
                .first()
            )

            if registration is None:
                return Response(
                    {"message": "Registration not found."},
                    status=status.HTTP_404_NOT_FOUND
                )
            
            # Team registrations must use the team-management workflow.
            if event.registration_mode == "team":
                return Response(
                    {
                        "message": (
                            "Team registrations cannot be cancelled "
                            "individually through this endpoint. "
                            "Use the team leave or withdraw action."
                        )
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            # ============================================================
            # PREVENT CANCELLATION AFTER CHECK-IN
            # ============================================================

            already_checked_in = EventTicket.objects.filter(
                registration=registration,
                checked_in_at__isnull=False
            ).exists()

            if already_checked_in:
                return Response(
                    {
                        "message": (
                            "This registration cannot be cancelled "
                            "because attendance has already been recorded."
                        )
                    },
                    status=status.HTTP_409_CONFLICT
                )

            if registration.status == "cancelled":
                return Response(
                    {
                        "message":
                        "This registration is already cancelled."
                    },
                    status=status.HTTP_409_CONFLICT
                )

            if event.start_datetime <= timezone.now():
                return Response(
                    {
                        "message":
                        "Registration cannot be cancelled after the event starts."
                    },
                    status=status.HTTP_400_BAD_REQUEST
                )

            registration.status = "cancelled"
            registration.cancelled_at = timezone.now()

            registration.save(
                update_fields=[
                    "status",
                    "cancelled_at"
                ]
            )

            return Response({
                "message": "Registration cancelled successfully."
            })

@method_decorator(csrf_protect, name="dispatch")
class OrganizerEventDetailView(APIView):

    permission_classes = [IsOrganizer]

    def get_event(self, request, event_id):
        return (
            Event.objects
            .filter(
                id=event_id,
                organizer=request.user
            )
            .select_related("organizer")
            .first()
        )

    def get(self, request, event_id):
        event = self.get_event(request, event_id)

        if event is None:
            return Response(
                {"message": "Event not found."},
                status=status.HTTP_404_NOT_FOUND
            )

        return Response(
            EventSerializer(event).data
        )

    def patch(self, request, event_id):

        with transaction.atomic():

            # Lock the same event row used during
            # student registration.
            event = (
                Event.objects
                .select_for_update()
                .filter(
                    id=event_id,
                    organizer=request.user
                )
                .first()
            )

            if event is None:
                return Response(
                    {"message": "Event not found."},
                    status=status.HTTP_404_NOT_FOUND
                )

            if event.status == "cancelled":
                return Response(
                    {
                        "message":
                        "Cancelled events cannot be modified."
                    },
                    status=status.HTTP_400_BAD_REQUEST
                )

            requested_status = request.data.get(
                "status",
                event.status
            )

            allowed_transitions = {
                "draft": {
                    "draft",
                    "published",
                    "cancelled",
                },
                "published": {
                    "published",
                    "cancelled",
                },
            }

            if requested_status not in allowed_transitions.get(
                event.status,
                set()
            ):
                return Response(
                    {
                        "message":
                        "Invalid event status transition."
                    },
                    status=status.HTTP_400_BAD_REQUEST
                )

            serializer = EventSerializer(
                event,
                data=request.data,
                partial=True
            )

            serializer.is_valid(raise_exception=True)

            # ==========================================
            # EXISTING CAPACITY PROTECTION
            # ==========================================

            new_capacity = serializer.validated_data.get(
                "capacity",
                event.capacity
            )

            active_registrations = (
                Registration.objects
                .filter(
                    event=event,
                    status="registered"
                )
                .count()
            )

            # Capacity must accommodate every
            # existing confirmed registration.
            if new_capacity < active_registrations:
                return Response(
                    {
                        "capacity": (
                            "Capacity cannot be less than "
                            f"the {active_registrations} "
                            "confirmed registrations."
                        )
                    },
                    status=status.HTTP_400_BAD_REQUEST
                )

            serializer.save()

            return Response(
                serializer.data
            )

# ============================================================
# FEATURE 3C — ORGANIZER PARTICIPANT MANAGEMENT
# ============================================================

class OrganizerParticipantsView(APIView):
    permission_classes = [IsOrganizer]

    def get(self, request, event_id):

        # Only the event owner can access its participants.
        event = (
            Event.objects
            .filter(
                id=event_id,
                organizer=request.user
            )
            .first()
        )

        if event is None:
            return Response(
                {"message": "Event not found."},
                status=status.HTTP_404_NOT_FOUND
            )

        # Retrieve all registrations for this event.
        registrations = (
            Registration.objects
            .filter(event=event)
            .select_related("student")
            .order_by("-registered_at")
        )

        # Count active and cancelled registrations.
        registered_count = registrations.filter(
            status="registered"
        ).count()

        cancelled_count = registrations.filter(
            status="cancelled"
        ).count()

        # Cancelled registrations do not occupy seats.
        available_seats = max(
            0,
            event.capacity - registered_count
        )

        # Serialize the participant records.
        serializer = OrganizerParticipantSerializer(
            registrations,
            many=True
        )

        return Response({
            "event": {
                "id": event.id,
                "title": event.title,
                "status": event.status,
                "capacity": event.capacity,
                "registration_mode": event.registration_mode,
            },
            "statistics": {
                "registered": registered_count,
                "cancelled": cancelled_count,
                "available_seats": available_seats,
            },
            "participants": serializer.data,
        })

# ============================================================
# FEATURE 4A — STUDENT DIGITAL TICKET API
# ============================================================

class StudentTicketView(APIView):

    permission_classes = [IsStudent]

    def get(self, request, registration_id):

        # The registration must belong to the logged-in student.
        registration = (
            Registration.objects
            .select_related("event")
            .filter(
                id=registration_id,
                student=request.user
            )
            .first()
        )

        if registration is None:
            return Response(
                {"message": "Registration not found."},
                status=status.HTTP_404_NOT_FOUND
            )

        # Cancelled registrations cannot access valid tickets.
        if registration.status != "registered":
            return Response(
                {
                    "message":
                    "A ticket is available only for active registrations."
                },
                status=status.HTTP_400_BAD_REQUEST
            )

        # Cancelled events cannot issue valid tickets.
        if registration.event.status != "published":
            return Response(
                {
                    "message": "This event is not active."
                },
                status=status.HTTP_400_BAD_REQUEST
            )

        # ============================================================
        # TEAM TICKET ELIGIBILITY
        # ============================================================
        if registration.event.registration_mode == "team":
            confirmed_membership = TeamMembership.objects.filter(
                registration=registration,
                team__event=registration.event,
                team__status="confirmed",
            ).exists()

            if not confirmed_membership:
                return Response(
                    {
                        "message": (
                            "Your team must be confirmed "
                            "before you can access your ticket."
                        )
                    },
                    status=status.HTTP_403_FORBIDDEN,
                )

        # Create the ticket on first access.
        # On subsequent requests, return the same ticket.
        ticket, created = EventTicket.objects.get_or_create(
            registration=registration
        )

        serializer = EventTicketSerializer(ticket)

        return Response({
            "message": (
                "Ticket created successfully."
                if created
                else "Ticket retrieved successfully."
            ),
            "ticket": serializer.data,
        })

# ============================================================
# FEATURE 4A — ORGANIZER QR CHECK-IN
# ============================================================

@method_decorator(csrf_protect, name="dispatch")
class OrganizerCheckInView(APIView):

    permission_classes = [IsOrganizer]

    def post(self, request, event_id):

        # The organizer submits the token read from the QR.
        raw_token = request.data.get("token")

        if not isinstance(raw_token, str):
            return Response(
                {"message": "A valid ticket token is required."},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            ticket_token = uuid.UUID(raw_token)
        except (ValueError, AttributeError):
            return Response(
                {"message": "Invalid ticket token format."},
                status=status.HTTP_400_BAD_REQUEST
            )

        with transaction.atomic():

            # Lock the event first.
            # The same lock order is used by registration APIs.
            event = (
                Event.objects
                .select_for_update()
                .filter(
                    id=event_id,
                    organizer=request.user
                )
                .first()
            )

            if event is None:
                return Response(
                    {"message": "Event not found."},
                    status=status.HTTP_404_NOT_FOUND
                )

            if event.status != "published":
                return Response(
                    {
                        "message":
                        "Attendance is unavailable for this event."
                    },
                    status=status.HTTP_400_BAD_REQUEST
                )

            now = timezone.now()

            # Check-in opens 30 minutes before the event.
            check_in_open = (
                event.start_datetime
                - timezone.timedelta(minutes=30)
            )

            if now < check_in_open:
                return Response(
                    {
                        "message":
                        "Check-in opens 30 minutes before the event."
                    },
                    status=status.HTTP_400_BAD_REQUEST
                )

            # Close check-in when the event ends.
            if now >= event.end_datetime:
                return Response(
                    {
                        "message":
                        "Check-in is closed for this event."
                    },
                    status=status.HTTP_400_BAD_REQUEST
                )

            # Lock the ticket so concurrent scans cannot
            # mark attendance twice.
            ticket = (
                EventTicket.objects
                .select_for_update()
                .select_related(
                    "registration",
                    "registration__student"
                )
                .filter(
                    token=ticket_token,
                    registration__event=event
                )
                .first()
            )

            if ticket is None:
                return Response(
                    {"message": "Ticket not found for this event."},
                    status=status.HTTP_404_NOT_FOUND
                )

            registration = ticket.registration

            # A cancelled registration is not valid.
            if registration.status != "registered":
                return Response(
                    {
                        "message":
                        "This registration is cancelled."
                    },
                    status=status.HTTP_400_BAD_REQUEST
                )

            # ============================================================
            # TEAM ATTENDANCE ELIGIBILITY
            # ============================================================
            if event.registration_mode == "team":
                confirmed_membership = TeamMembership.objects.filter(
                    registration=registration,
                    team__event=event,
                    team__status="confirmed",
                ).exists()

                if not confirmed_membership:
                    return Response(
                        {
                            "message": (
                                "Attendance is unavailable because "
                                "this student's team is not confirmed."
                            )
                        },
                        status=status.HTTP_403_FORBIDDEN,
                    )

            # Attendance can only be marked once.
            if ticket.checked_in_at is not None:
                return Response(
                    {
                        "message":
                        "This ticket has already been checked in.",
                        "checked_in_at": ticket.checked_in_at,
                    },
                    status=status.HTTP_409_CONFLICT
                )

            # Record verified attendance.
            ticket.checked_in_at = now
            ticket.checked_in_by = request.user

            ticket.save(
                update_fields=[
                    "checked_in_at",
                    "checked_in_by"
                ]
            )

            return Response({
                "message": "Attendance marked successfully.",
                "student_username": registration.student.username,
                "event_id": event.id,
                "event_title": event.title,
                "checked_in_at": ticket.checked_in_at,
            })

            # ============================================================
            # FEATURE 4C — ORGANIZER ATTENDANCE DASHBOARD
            # ============================================================

class OrganizerAttendanceView(APIView):

    permission_classes = [IsOrganizer]

    def get(self, request, event_id):

        # Only the organizer who owns the event can access attendance.
        event = (
            Event.objects
            .filter(
                id=event_id,
                organizer=request.user
            )
            .first()
        )

        if event is None:
            return Response(
                {"message": "Event not found."},
                status=status.HTTP_404_NOT_FOUND
            )

        registrations = (
            Registration.objects
            .filter(event=event)
            .select_related("student", "ticket")
            .order_by("student__username")
        )

        attendance_records = []

        registered_count = 0
        checked_in_count = 0

        for registration in registrations:

            # Cancelled registrations are retained in registration
            # history but excluded from attendance statistics.
            if registration.status != "registered":
                continue

            registered_count += 1

            ticket = getattr(registration, "ticket", None)

            checked_in_at = (
                ticket.checked_in_at
                if ticket is not None
                else None
            )

            is_present = checked_in_at is not None

            if is_present:
                checked_in_count += 1

            attendance_records.append({
                "registration_id": registration.id,
                "student_username": registration.student.username,
                "registration_status": registration.status,
                "attendance_status": (
                    "present" if is_present else "pending"
                ),
                "checked_in_at": checked_in_at,
            })

        pending_count = registered_count - checked_in_count

        attendance_percentage = (
            round((checked_in_count / registered_count) * 100, 1)
            if registered_count > 0
            else 0
        )

        return Response({
            "event": {
                "id": event.id,
                "title": event.title,
                "status": event.status,
                "start_datetime": event.start_datetime,
                "end_datetime": event.end_datetime,
            },
            "statistics": {
                "registered": registered_count,
                "checked_in": checked_in_count,
                "pending": pending_count,
                "attendance_percentage": attendance_percentage,
            },
            "attendance": attendance_records,
        })
# ============================================================
# FEATURE 5A — DJANGO ANALYTICS PROXY
# ============================================================

class OrganizerAnalyticsView(APIView):

    permission_classes = [IsOrganizer]

    def get(self, request):

        service_url = settings.ANALYTICS_SERVICE_URL

        internal_key = settings.ANALYTICS_INTERNAL_KEY

        if not internal_key:
            return Response(
                {
                    "message":
                    "Analytics is not configured."
                },
                status=status.HTTP_503_SERVICE_UNAVAILABLE
            )

        # IMPORTANT:
        # Always use the authenticated Django user's ID.
        # Never accept an organizer ID from the browser.
        organizer_id = request.user.id

        url = (
            f"{service_url}/internal/"
            f"organizers/{organizer_id}/overview"
        )

        internal_request = urllib.request.Request(
            url,
            headers={
                "X-Internal-Key": internal_key,
                "Accept": "application/json",
            },
            method="GET",
        )

        try:
            with urllib.request.urlopen(
                internal_request,
                timeout=5
            ) as response:

                payload = json.loads(
                    response.read().decode("utf-8")
                )

        except (
            urllib.error.URLError,
            TimeoutError,
            OSError,
            ValueError,
        ):
            return Response(
                {
                    "message":
                    "Analytics service is temporarily unavailable."
                },
                status=status.HTTP_503_SERVICE_UNAVAILABLE
            )

        return Response(payload)

# ============================================================
# FEATURE 5D — EVENT REGISTRATION GROWTH PROXY
# ============================================================

class OrganizerRegistrationGrowthView(APIView):

    permission_classes = [IsOrganizer]

    def get(self, request, event_id):

        # Confirm the organizer owns this event.
        event_exists = Event.objects.filter(
            id=event_id,
            organizer=request.user
        ).exists()

        if not event_exists:
            return Response(
                {"message": "Event not found."},
                status=status.HTTP_404_NOT_FOUND
            )

        internal_key = settings.ANALYTICS_INTERNAL_KEY

        if not internal_key:
            return Response(
                {"message": "Analytics is not configured."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE
            )

        service_url = (
            settings.ANALYTICS_SERVICE_URL.rstrip("/")
        )

        url = (
            f"{service_url}/internal/"
            f"organizers/{request.user.id}/"
            f"events/{event_id}/registration-growth"
        )

        internal_request = urllib.request.Request(
            url,
            headers={
                "X-Internal-Key": internal_key,
                "Accept": "application/json",
            },
            method="GET",
        )

        try:
            with urllib.request.urlopen(
                internal_request,
                timeout=5
            ) as response:

                payload = json.loads(
                    response.read().decode("utf-8")
                )

        except (
            urllib.error.URLError,
            TimeoutError,
            OSError,
            ValueError,
        ):
            return Response(
                {
                    "message":
                    "Analytics service is temporarily unavailable."
                },
                status=status.HTTP_503_SERVICE_UNAVAILABLE
            )

        return Response(payload)