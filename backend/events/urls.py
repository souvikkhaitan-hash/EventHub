from django.urls import include,path

from .views import (
    eventhub_info,
    PublicEventListView,
    PublicEventDetailView,
    OrganizerEventListView,
    OrganizerEventDetailView,
    EventRegistrationView,
    MyRegistrationsView,
    CancelRegistrationView,
    OrganizerParticipantsView,
    StudentTicketView,
    OrganizerCheckInView,
    OrganizerAttendanceView,
    OrganizerAnalyticsView,
    OrganizerRegistrationGrowthView,
)
from .staff_views import (
    EventStaffListView,
    EventStaffDetailView,
    MyEventAccessView,
)
from .attendance_lookup_views import AttendanceLookupView
from .attendance_export_views import AttendanceExportView
from .event_reference_views import EventReferenceDownloadView
urlpatterns = [
    path(
        "info/",
        eventhub_info,
        name="eventhub-info"
    ),

    path(
        "events/",
        PublicEventListView.as_view(),
        name="public-events"
    ),

    path(
        "events/manage/",
        OrganizerEventListView.as_view(),
        name="organizer-events"
    ),

    path(
        "events/manage/<int:event_id>/",
        OrganizerEventDetailView.as_view(),
        name="organizer-event-detail"
    ),

    path(
        "events/<int:event_id>/",
        PublicEventDetailView.as_view(),
        name="public-event-detail"
    ),

    path(
        "events/<int:event_id>/register/",
        EventRegistrationView.as_view(),
        name="event-register"
    ),

    path(
        "registrations/",
        MyRegistrationsView.as_view(),
        name="my-registrations"
    ),

    path(
        "registrations/<int:registration_id>/cancel/",
        CancelRegistrationView.as_view(),
        name="cancel-registration"
    ),
    
    path(
        "events/manage/<int:event_id>/participants/",
        OrganizerParticipantsView.as_view(),
        name="organizer-participants"
    ),
    
    # Student digital ticket
    path(
        "registrations/<int:registration_id>/ticket/",
        StudentTicketView.as_view(),
        name="student-ticket"
    ),

# Organizer attendance verification
    path(
        "events/manage/<int:event_id>/check-in/",
        OrganizerCheckInView.as_view(),
        name="organizer-check-in"
   ),
    
    # Organizer attendance dashboard
    path(
        "events/manage/<int:event_id>/attendance/",
        OrganizerAttendanceView.as_view(),
        name="organizer-attendance"
    ),
    
    # Organizer analytics proxy
    path(
        "analytics/overview/",
        OrganizerAnalyticsView.as_view(),
        name="organizer-analytics"
    ),

    # Organizer registration growth proxy
    path(
        "analytics/events/<int:event_id>/registration-growth/",
        OrganizerRegistrationGrowthView.as_view(),
        name="organizer-registration-growth"
    ),
    path("", include("events.team_urls")),
    
   path(
        "events/manage/<int:event_id>/staff/",
        EventStaffListView.as_view(),
        name="event-staff-list",
    ),

    path(
        "events/manage/<int:event_id>/staff/<int:membership_id>/",
        EventStaffDetailView.as_view(),
        name="event-staff-detail",
    ),

    path(
        "events/manage/<int:event_id>/my-access/",
        MyEventAccessView.as_view(),
        name="event-my-access",
    ),
    path(
        "events/manage/<int:event_id>/attendance-lookup/",
        AttendanceLookupView.as_view(),
        name="attendance-lookup",
    ),
    path(
        "events/manage/<int:event_id>/attendance-export/",
        AttendanceExportView.as_view(),
        name="attendance-export",
    ),
    path(
        "events/manage/<int:event_id>/reference-download/",
        EventReferenceDownloadView.as_view(),
        name="event-reference-download",
    ),
]