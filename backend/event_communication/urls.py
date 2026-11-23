from django.urls import path
from .views import BoardView, AnnouncementsView, AnnouncementDetailView, QuestionsView, QuestionDetailView

urlpatterns = [
    path("events/<int:event_id>/", BoardView.as_view(), name="event-communication-board"),
    path("events/<int:event_id>/announcements/", AnnouncementsView.as_view(), name="event-announcements-create"),
    path("events/<int:event_id>/announcements/<int:item_id>/", AnnouncementDetailView.as_view(), name="event-announcement-change"),
    path("events/<int:event_id>/questions/", QuestionsView.as_view(), name="event-question-create"),
    path("events/<int:event_id>/questions/<int:item_id>/", QuestionDetailView.as_view(), name="event-question-change"),
]
