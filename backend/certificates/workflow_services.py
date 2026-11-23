"""Participation certificate orchestration; reuse the existing PDF and publication checks."""
import hashlib
import json
import logging
import uuid

from django.contrib.auth import get_user_model
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import APIException, NotFound, PermissionDenied, ValidationError

from .award_services import validate_certificate_fields
from .batch_services import BatchConflict, create_draft_batch
from .models import CertificateTemplateVersion, GeneratedCertificate
from .permissions import certificate_event
from .publication_services import batch_review_hash, publish_certificate_batch
from .recipient_services import certificate_registrations, recipient_details
from .serializers import PositionedFieldSerializer
from .workflow_models import CertificateWorkflow, CertificateWorkflowBatch, CertificateWorkflowRecipient

logger = logging.getLogger(__name__)
ACTIVE = ["queued", "generating", "ready", "publishing", "failed"]
WORKING = ["queued", "generating", "publishing"]
CHUNK_SIZE = 10
MAX_RECIPIENTS = 5000


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
                                     separators=(",", ":")).encode("utf-8")).hexdigest()


def version_for(event, version_id):
    version = get_object_or_404(CertificateTemplateVersion.objects.select_related(
        "template__event__organizer"), pk=version_id, template__event=event)
    layout = PositionedFieldSerializer(data=version.fields, many=True, allow_empty=True, max_length=20)
    layout.is_valid(raise_exception=True)
    fields = layout.validated_data
    validate_certificate_fields(fields, None)
    if not any((not field.get("text", "").strip() and field["placeholder"] == "participant_name")
               or "{participant_name}" in field.get("text", "") for field in fields):
        raise ValidationError({"template_version_id": "Add a participant-name field to the saved template."})
    return version


def recipient_review(user, event_id, version_id):
    event = certificate_event(user, event_id)
    version_for(event, version_id)
    if event.status != "published" or event.end_datetime > timezone.now():
        raise ValidationError({"event": "Participation certificates require a finished, published event."})
    registrations = list(certificate_registrations(event).order_by("id")[:MAX_RECIPIENTS + 1])
    if len(registrations) > MAX_RECIPIENTS:
        raise ValidationError({"recipients": f"This release supports reviewing up to {MAX_RECIPIENTS} registrations per event."})
    issued_ids = set(GeneratedCertificate.objects.filter(
        registration__event=event, award_result__isnull=True, is_active=True
    ).values_list("registration_id", flat=True))
    now = timezone.now()
    rows = []
    for registration in registrations:
        row = recipient_details(registration, event, now)
        row["already_issued"] = registration.pk in issued_ids
        row["name_valid"] = bool(row["participant_name"].strip()) and len(row["participant_name"].strip()) <= 200
        row["selectable"] = row["eligible"] and not row["already_issued"]
        rows.append(row)
    return {"event_id": event.pk, "template_version_id": version_id, "results": rows,
            "count": len(rows), "eligible_count": sum(row["selectable"] for row in rows),
            "missing_name_count": sum(row["selectable"] and not row["name_valid"] for row in rows),
            "already_issued_count": sum(row["already_issued"] for row in rows)}


def create_workflow(user, event_id, data):
    requested = sorted(data["recipients"], key=lambda row: row["registration_id"])
    request_hash = digest({"version": data["template_version_id"], "recipients": requested})
    with transaction.atomic():
        event = certificate_event(user, event_id, lock=True)
        existing = CertificateWorkflow.objects.filter(event=event, request_key=data["request_key"]).first()
        if existing:
            if existing.request_hash != request_hash or existing.created_by_id != user.pk:
                raise BatchConflict()
            return existing, False
        if CertificateWorkflow.objects.filter(event=event, status__in=ACTIVE).exists():
            raise BatchConflict("An unfinished certificate run already exists. Open it to continue, retry or cancel.")
        version = version_for(event, data["template_version_id"])
        # Recheck the submitted selection; never trust the browser's eligibility flags.
        review = recipient_review(user, event_id, version.pk)
        eligible = {row["registration_id"]: row for row in review["results"] if row["selectable"]}
        recipients = []
        for item in requested:
            row = eligible.get(item["registration_id"])
            if row is None:
                raise ValidationError({"recipients": "The selection changed or contains an ineligible participant. Refresh the review."})
            name = item.get("participant_name", row["participant_name"]).strip()
            if not name or len(name) > 200:
                raise ValidationError({"recipients": f"Registration {row['registration_id']} needs a valid full name."})
            recipients.append((row["registration_id"], name))
        workflow = CertificateWorkflow.objects.create(
            event=event, template_version=version, created_by=user, generation_actor=user,
            request_key=data["request_key"], request_hash=request_hash, total=len(recipients))
        CertificateWorkflowRecipient.objects.bulk_create([
            CertificateWorkflowRecipient(workflow=workflow, registration_id=registration_id, participant_name=name)
            for registration_id, name in recipients
        ], batch_size=500)
        return workflow, True


def require_owner(user, event_id, lock=False):
    event = certificate_event(user, event_id, lock=lock)
    if event.organizer_id != user.pk or not user.is_active or not user.groups.filter(name="Organizer").exists():
        raise PermissionDenied("Only the event owner can publish certificates.")
    return event


def manifest_for(workflow):
    parts = workflow.parts.select_related("batch").prefetch_related("batch__certificates").order_by("number")
    return [{"batch_id": str(part.batch_id), "review_hash": batch_review_hash(part.batch),
             "status": part.batch.status} for part in parts]


def review_hash_for(workflow, manifest=None):
    return digest({"workflow": str(workflow.pk), "total": workflow.total,
                   "template": workflow.template_version_id,
                   "manifest": manifest if manifest is not None else manifest_for(workflow)})


def change_workflow(user, workflow_id, data):
    action = data["action"]
    with transaction.atomic():
        # Same lock order as the worker: workflow, then event.
        workflow = get_object_or_404(CertificateWorkflow.objects.select_for_update(), pk=workflow_id)
        event = certificate_event(user, workflow.event_id, lock=True)
        if action == "publish":
            require_owner(user, event.pk)
            supplied_hash = data.get("review_hash", "")
            if not data.get("confirm_review") or not supplied_hash:
                raise ValidationError({"confirm_review": "Confirm the recipient names and sample PDFs before publishing."})
            if workflow.status in ["publishing", "published"] and supplied_hash == workflow.approval_hash:
                return workflow
            if not (workflow.status == "ready" or (workflow.status == "failed" and workflow.phase == "publication")):
                raise BatchConflict("This run is not ready for publication.")
            if workflow.generated != workflow.total:
                raise BatchConflict("All selected drafts must finish before publication.")
            manifest = manifest_for(workflow)
            if not manifest or review_hash_for(workflow, manifest) != supplied_hash:
                raise BatchConflict("The run changed after review. Refresh and review it again.")
            workflow.approval_manifest = manifest
            workflow.approval_hash = supplied_hash
            workflow.publisher = user
            workflow.phase = "publication"
            workflow.status = "publishing"
        elif action == "retry":
            if user.pk != workflow.created_by_id and user.pk != event.organizer_id:
                raise PermissionDenied("Only the requester or event owner can retry this run.")
            if workflow.status != "failed" or workflow.phase != "generation":
                raise BatchConflict("For a failed publication, review and use Publish remaining instead.")
            workflow.generation_actor = user
            workflow.status = "queued"
        elif action == "cancel":
            if user.pk != workflow.created_by_id and user.pk != event.organizer_id:
                raise PermissionDenied("Only the requester or event owner can cancel this run.")
            if workflow.phase == "publication":
                require_owner(user, event.pk)
                if workflow.status not in ["publishing", "failed"]:
                    raise BatchConflict("This publication cannot be stopped.")
                workflow.published = workflow.recipients.filter(certificate__batch__status="published").count()
            elif workflow.status not in ["queued", "generating", "ready", "failed"]:
                raise BatchConflict("This run has already finished.")
            workflow.status = "cancelled"
        else:
            raise ValidationError({"action": "Unknown action."})
        workflow.error_message = ""
        workflow.save()
        return workflow


def safe_failure(error):
    if isinstance(error, (NotFound, PermissionDenied)):
        return "Access or a required record is unavailable. Check the processing user's current access, then retry."
    if isinstance(error, FileNotFoundError):
        return "A template image or certificate file is missing. Restore the file, then retry."
    if isinstance(error, (ValidationError, BatchConflict)):
        messages = []
        def collect(value, prefix=""):
            if isinstance(value, dict):
                for key, child in value.items():
                    label = f"Registration {key}: " if str(key).isdigit() else prefix
                    collect(child, label)
            elif isinstance(value, (list, tuple)):
                for child in value:
                    collect(child, prefix)
            else:
                messages.append(prefix + str(value))
        collect(error.detail)
        return (" ".join(messages[:3]) or "Certificate validation failed. Refresh the review before retrying.")[:500]
    if isinstance(error, APIException):
        return "Validation stopped this run. Check attendance, team/event details and existing certificates. Completed work is retained."
    return "Processing stopped. Check worker/storage configuration, then retry. Completed work is retained."


def process_workflow_step():
    with transaction.atomic():
        workflow = CertificateWorkflow.objects.select_for_update(skip_locked=True).filter(
            status__in=WORKING).order_by("updated_at", "id").first()
        if workflow is None:
            return False
        try:
            with transaction.atomic():
                if workflow.phase == "generation":
                    actor = get_user_model().objects.get(pk=workflow.generation_actor_id)
                    certificate_event(actor, workflow.event_id, lock=True)
                    rows = list(workflow.recipients.filter(certificate__isnull=True).order_by("registration_id")[:CHUNK_SIZE])
                    if not rows:
                        raise ValidationError("No unfinished recipients found.")
                    number = workflow.parts.count() + 1
                    batch_id, _ = create_draft_batch(actor, workflow.event_id, {
                        "template_version_id": workflow.template_version_id,
                        "request_key": uuid.uuid5(workflow.pk, f"generation:{number}"),
                        "recipients": [{"registration_id": row.registration_id, "participant_name": row.participant_name} for row in rows],
                    })
                    certificates = {certificate.registration_id: certificate for certificate in
                                    GeneratedCertificate.objects.filter(batch_id=batch_id)}
                    if set(certificates) != {row.registration_id for row in rows}:
                        raise ValidationError("The generated batch does not match this run.")
                    CertificateWorkflowBatch.objects.create(workflow=workflow, number=number, batch_id=batch_id)
                    for row in rows:
                        row.certificate = certificates[row.registration_id]
                    CertificateWorkflowRecipient.objects.bulk_update(rows, ["certificate"])
                    workflow.generated += len(rows)
                    workflow.status = "ready" if workflow.generated == workflow.total else "generating"
                else:
                    actor = get_user_model().objects.get(pk=workflow.publisher_id)
                    require_owner(actor, workflow.event_id, lock=True)
                    # The recorded manifest is the owner's approval, not a fresh auto-approval.
                    part = workflow.parts.select_related("batch").filter(batch__status="draft").order_by("number").first()
                    if part is not None:
                        expected = next((entry["review_hash"] for entry in workflow.approval_manifest
                                         if entry["batch_id"] == str(part.batch_id)), None)
                        if expected is None:
                            raise BatchConflict("This batch was not approved.")
                        publish_certificate_batch(actor, part.batch_id, expected)
                    workflow.published = workflow.recipients.filter(certificate__batch__status="published").count()
                    if workflow.published == workflow.total:
                        workflow.status = "published"
                    else:
                        workflow.status = "publishing"
        except Exception as error:
            # Refresh counters after the failed savepoint before saving failure state.
            workflow.refresh_from_db()
            workflow.status = "failed"
            workflow.error_message = safe_failure(error)
            logger.error("Certificate workflow %s failed: %s", workflow.pk, type(error).__name__)
        else:
            workflow.error_message = ""
        workflow.save()
        return True

