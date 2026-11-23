from django.shortcuts import get_object_or_404
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect
from rest_framework import serializers, status
from rest_framework.parsers import JSONParser
from rest_framework.response import Response
from rest_framework.views import APIView

from .permissions import CanManageCertificates, certificate_event, certificate_event_ids
from .workflow_models import CertificateWorkflow
from .workflow_services import (
    MAX_RECIPIENTS, change_workflow, create_workflow, manifest_for,
    recipient_review, review_hash_for,
)


def private(data, code=200):
    response = Response(data, status=code)
    response["Cache-Control"] = "private, no-store"
    return response


class StrictSerializer(serializers.Serializer):
    def to_internal_value(self, data):
        if not isinstance(data, dict):
            raise serializers.ValidationError({"non_field_errors":["Expected a JSON object."]})
        unknown = set(data) - set(self.fields)
        if unknown:
            raise serializers.ValidationError({"non_field_errors":["The request contains unsupported fields."]})
        return super().to_internal_value(data)


class RecipientInput(StrictSerializer):
    registration_id = serializers.IntegerField(min_value=1)
    participant_name = serializers.CharField(max_length=200, required=False, allow_blank=False)


class WorkflowInput(StrictSerializer):
    template_version_id = serializers.IntegerField(min_value=1)
    request_key = serializers.UUIDField()
    recipients = RecipientInput(many=True, min_length=1, max_length=MAX_RECIPIENTS, allow_empty=False)

    def validate_recipients(self, value):
        ids = [row["registration_id"] for row in value]
        if len(ids) != len(set(ids)):
            raise serializers.ValidationError("Select each participant only once.")
        return value


class ActionInput(StrictSerializer):
    action = serializers.ChoiceField(choices=["retry", "cancel", "publish"])
    confirm_review = serializers.BooleanField(required=False)
    review_hash = serializers.CharField(max_length=64, required=False)


class ReviewInput(StrictSerializer):
    template_version_id = serializers.IntegerField(min_value=1)


def summary(workflow):
    return {"id": str(workflow.pk), "event_id": workflow.event_id,
            "template_version_id": workflow.template_version_id,
            "created_by": workflow.created_by_id, "status": workflow.status, "phase": workflow.phase,
            "total": workflow.total, "generated": workflow.generated, "published": workflow.published,
            "error_message": workflow.error_message, "created_at": workflow.created_at,
            "updated_at": workflow.updated_at}


def detail(workflow):
    result = summary(workflow)
    # Actual publication can also be affected by the retained batch tools.
    result["published"] = workflow.recipients.filter(certificate__batch__status="published").count()
    result["active_certificates"] = workflow.recipients.filter(certificate__is_active=True).count()
    result["review_hash"] = ""
    if workflow.status == "ready" or (workflow.status == "failed" and workflow.phase == "publication"):
        result["review_hash"] = review_hash_for(workflow)
    recipient_rows = workflow.recipients.filter(certificate__isnull=False).order_by("registration_id")
    count = recipient_rows.count()
    indexes = sorted({0, count // 2, count - 1}) if count else []
    result["samples"] = [{"id": str(row.certificate_id), "participant_name": row.participant_name}
                         for index in indexes for row in [recipient_rows[index]]]
    result["batches"] = list(workflow.parts.order_by("number").values_list("batch_id", flat=True))
    return result


class WorkflowReviewView(APIView):
    permission_classes = [CanManageCertificates]

    def get(self, request, event_id):
        serializer = ReviewInput(data=request.query_params.dict())
        serializer.is_valid(raise_exception=True)
        return private(recipient_review(request.user, event_id, serializer.validated_data["template_version_id"]))


@method_decorator(csrf_protect, name="dispatch")
class EventWorkflowsView(APIView):
    permission_classes = [CanManageCertificates]
    parser_classes = [JSONParser]

    def get(self, request, event_id):
        certificate_event(request.user, event_id)
        workflows = CertificateWorkflow.objects.filter(event_id=event_id).order_by("-created_at", "-id")[:20]
        return private({"results": [summary(workflow) for workflow in workflows]})

    def post(self, request, event_id):
        serializer = WorkflowInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        workflow, created = create_workflow(request.user, event_id, serializer.validated_data)
        return private(detail(workflow), status.HTTP_202_ACCEPTED if created else status.HTTP_200_OK)


@method_decorator(csrf_protect, name="dispatch")
class WorkflowDetailView(APIView):
    permission_classes = [CanManageCertificates]
    parser_classes = [JSONParser]

    def get(self, request, workflow_id):
        workflow = get_object_or_404(CertificateWorkflow.objects.filter(
            event_id__in=certificate_event_ids(request.user)), pk=workflow_id)
        return private(detail(workflow))

    def post(self, request, workflow_id):
        serializer = ActionInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        workflow = change_workflow(request.user, workflow_id, serializer.validated_data)
        return private(detail(workflow))
