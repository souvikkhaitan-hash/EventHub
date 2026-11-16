import hashlib
import json
import logging

from django.core.files.base import ContentFile
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone

from rest_framework.exceptions import APIException, ValidationError

from events.models import Event

from .award_services import (
    batch_award,
    certificate_eligibility,
    certificate_values,
    validate_certificate_fields,
)
from .models import (
    CertificateBatch,
    CertificateTemplateVersion,
    GeneratedCertificate,
)
from .recipient_services import certificate_registrations
from .serializers import PositionedFieldSerializer
from .services import render_sample_pdf


logger = logging.getLogger(__name__)


class BatchConflict(APIException):
    status_code = 409
    default_detail = (
        "This request key was already used with different details. "
        "Start a new generation request."
    )
    default_code = "batch_conflict"


def batch_request_hash(data):
    canonical = {
        "template_version_id": data["template_version_id"],
        "recipients": sorted(
            [
                {
                    "registration_id": item["registration_id"],
                    "participant_name": item["participant_name"],
                }
                for item in data["recipients"]
            ],
            key=lambda item: item["registration_id"],
        ),
    }

    # Preserve the hash format of existing participation requests.
    if data.get("award_result_id") is not None:
        canonical["award_result_id"] = str(
            data["award_result_id"]
        )

    encoded = json.dumps(
        canonical,
        sort_keys=True,
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")

    return hashlib.sha256(encoded).hexdigest()


def create_draft_batch(user, event_id, data):
    request_hash = batch_request_hash(data)
    written_files = []

    try:
        with transaction.atomic():
            event = get_object_or_404(
                Event.objects.select_for_update(),
                id=event_id,
                organizer=user,
            )

            existing = CertificateBatch.objects.filter(
                event=event,
                request_key=data["request_key"],
            ).first()

            if existing:
                if existing.request_hash != request_hash:
                    raise BatchConflict()

                return existing.id, False

            version = get_object_or_404(
                CertificateTemplateVersion.objects.select_related(
                    "template__event__organizer"
                ),
                id=data["template_version_id"],
                template__event=event,
            )

            layout = PositionedFieldSerializer(
                data=version.fields,
                many=True,
                allow_empty=True,
                max_length=20,
            )
            layout.is_valid(raise_exception=True)
            fields = layout.validated_data

            award = batch_award(
                event,
                data.get("award_result_id"),
            )

            validate_certificate_fields(fields, award)

            has_participant_name = any(
                (
                    not field.get("text", "").strip()
                    and field["placeholder"] == "participant_name"
                )
                or "{participant_name}" in field.get("text", "")
                for field in fields
            )

            if not has_participant_name:
                raise ValidationError({
                    "template_version_id": (
                        "Add a participant-name field to this "
                        "template before generating certificates."
                    )
                })

            names = {
                item["registration_id"]: item["participant_name"]
                for item in data["recipients"]
            }

            registrations = list(
                certificate_registrations(event)
                .filter(id__in=names)
                .select_for_update(of=("self",))
                .order_by("id")
            )

            if len(registrations) != len(names):
                raise ValidationError({
                    "recipients": (
                        "One or more participants are unavailable "
                        "for this event."
                    )
                })

            now = timezone.now()
            eligibility_errors = {}

            for registration in registrations:
                eligibility = certificate_eligibility(
                    registration,
                    event,
                    award,
                    now,
                )

                if not eligibility["eligible"]:
                    eligibility_errors[str(registration.id)] = [
                        reason["message"]
                        for reason in eligibility["reasons"]
                    ]

            if eligibility_errors:
                raise ValidationError({
                    "recipients": eligibility_errors
                })

            batch = CertificateBatch.objects.create(
                event=event,
                template_version=version,
                award_result=award,
                request_key=data["request_key"],
                request_hash=request_hash,
                created_by=user,
            )

            issue_date = timezone.localtime(
                batch.created_at
            ).strftime("%d %B %Y")

            for registration in registrations:
                certificate = GeneratedCertificate(
                    batch=batch,
                    registration=registration,
                    award_result=award,
                    participant_name=names[registration.id],
                )

                values = certificate_values(
                    version,
                    registration,
                    names[registration.id],
                    award,
                )

                values.update({
                    "certificate_id": str(certificate.id),
                    "issue_date": issue_date,
                })

                certificate.values = values

                pdf = render_sample_pdf(
                    version,
                    fields,
                    certificate.participant_name,
                    images=version.images,
                    resolved_values=values,
                    preview_label=(
                        "DRAFT - NOT AN ISSUED CERTIFICATE"
                    ),
                )

                content = pdf.getvalue()

                certificate.sha256 = hashlib.sha256(
                    content
                ).hexdigest()

                certificate.document.save(
                    "certificate.pdf",
                    ContentFile(content),
                    save=False,
                )

                written_files.append((
                    certificate.document.storage,
                    certificate.document.name,
                ))

                certificate.save()

            return batch.id, True

    except Exception:
        for storage, filename in reversed(written_files):
            try:
                storage.delete(filename)
            except Exception:
                logger.exception(
                    "Unable to remove failed certificate file: %s",
                    filename,
                )

        raise