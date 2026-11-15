from django.urls import path

from .team_views import (
    CreateTeamView,
    JoinTeamView,
    MyEventTeamView,
    ConfirmTeamView,
    LeaveTeamView,
    WithdrawTeamView,
    OrganizerEventTeamsView,
)


urlpatterns = [

    path(
        "team-events/<int:event_id>/create/",
        CreateTeamView.as_view(),
        name="create-event-team",
    ),

    path(
        "team-events/<int:event_id>/join/",
        JoinTeamView.as_view(),
        name="join-event-team",
    ),

    path(
        "team-events/<int:event_id>/my-team/",
        MyEventTeamView.as_view(),
        name="my-event-team",
    ),

    path(
        "teams/<int:team_id>/confirm/",
        ConfirmTeamView.as_view(),
        name="confirm-event-team",
    ),

    path(
        "teams/<int:team_id>/leave/",
        LeaveTeamView.as_view(),
        name="leave-event-team",
    ),

    path(
        "teams/<int:team_id>/withdraw/",
        WithdrawTeamView.as_view(),
        name="withdraw-event-team",
    ),

    path(
        "organizer/events/<int:event_id>/teams/",
        OrganizerEventTeamsView.as_view(),
        name="organizer-event-teams",
    ),

]