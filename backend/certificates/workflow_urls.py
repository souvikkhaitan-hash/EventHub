from django.urls import path
from .workflow_views import EventWorkflowsView, WorkflowDetailView, WorkflowReviewView

urlpatterns = [
    path("events/<int:event_id>/workflow-review/", WorkflowReviewView.as_view(), name="certificate-workflow-review"),
    path("events/<int:event_id>/workflows/", EventWorkflowsView.as_view(), name="event-certificate-workflows"),
    path("workflows/<uuid:workflow_id>/", WorkflowDetailView.as_view(), name="certificate-workflow-detail"),
]
