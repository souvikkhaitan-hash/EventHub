import hashlib
import json
import logging

from django.core.files.base import ContentFile
from django.db import IntegrityError, transaction
from django.http import Http404
from django.shortcuts import get_object_or_404
from django.utils import timezone

from rest_framework.exceptions import ValidationError

from events.models import Event

from .award_services import (
    batch_award,
    certificate_eligibility,
    certificate_values,
    validate_certificate_fields,
)
from .batch_services import BatchConflict
from .models import CertificateBatch, GeneratedCertificate
from .recipient_services import certificate_registrations
from .serializers import PositionedFieldSerializer
from .services import render_sample_pdf


logger = logging.getLogger(__name__)


def batch_review_hash(batch, certificates=None):
    if certificates is None:
        certificates = list(batch.certificates.all())

    payload = {
        "batch_id": str(batch.id),
        "template_version_id": batch.template_version_id,
        "certificates": sorted(
            [
                {
                    "id": str(certificate.id),
                    "name": certificate.participant_name,
                    "sha256": certificate.sha256,
                    "values": certificate.values,
                }
                for certificate in certificates
            ],
            key=lambda item: item["id"],
        ),
    }

    # Existing participation review hashes remain compatible.
    if batch.award_result_id is not None:
        payload["award_result_id"] = str(batch.award_result_id)

    encoded = json.dumps(
        payload,
        sort_keys=True,
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")

    return hashlib.sha256(encoded).hexdigest()


def stored_document_hash(certificate):
    digest = hashlib.sha256()

    with certificate.document.storage.open(
        certificate.document.name,
        "rb",
    ) as document:
        for chunk in iter(
            lambda: document.read(65536),
            b"",
        ):
            digest.update(chunk)

    return digest.hexdigest()


def publish_certificate_batch(user, batch_id, review_hash):
    lookup = CertificateBatch.objects.filter(
        id=batch_id,
        event__organizer=user,
    ).values("event_id").first()

    if lookup is None:
        raise Http404

    written_files = []

    try:
        with transaction.atomic():
            event = get_object_or_404(
                Event.objects.select_for_update(),
                id=lookup["event_id"],
                organizer=user,
            )

            batch = get_object_or_404(
                CertificateBatch.objects.select_for_update(),
                id=batch_id,
                event=event,
            )

            registration_ids = list(
                batch.certificates
                .order_by("registration_id")
                .values_list("registration_id", flat=True)
            )

            registrations = {
                registration.id: registration
                for registration in (
                    certificate_registrations(event)
                    .filter(id__in=registration_ids)
                    .select_for_update(of=("self",))
                    .order_by("id")
                )
            }

            certificates = list(
                GeneratedCertificate.objects
                .select_for_update()
                .filter(batch=batch)
                .order_by("registration_id")
            )

            if not certificates:
                raise BatchConflict(
                    "This batch contains no certificates."
                )

            if (
                batch_review_hash(batch, certificates)
                != review_hash
            ):
                raise BatchConflict(
                    "The reviewed batch has changed. "
                    "Reload and review it before publishing."
                )

            # A retry never regenerates or reactivates issued files.
            if batch.status == "published":
                return batch.id

            if len(registrations) != len(certificates):
                raise BatchConflict(
                    "Some registrations are no longer available."
                )

            if GeneratedCertificate.objects.filter(
                registration_id__in=registration_ids,
                award_result_id=batch.award_result_id,
                is_active=True,
            ).exists():
                raise BatchConflict(
                    "An active certificate of this kind already "
                    "exists for a participant in this batch."
                )

            version = batch.template_version

            if version.template.event_id != event.id:
                raise BatchConflict(
                    "The template does not belong to this event."
                )

            layout = PositionedFieldSerializer(
                data=version.fields,
                many=True,
                allow_empty=True,
                max_length=20,
            )
            layout.is_valid(raise_exception=True)

            award = batch_award(
                event,
                batch.award_result_id,
            )

            validate_certificate_fields(
                layout.validated_data,
                award,
            )

            if any(
                row.award_result_id != batch.award_result_id
                for row in certificates
            ):
                raise BatchConflict(
                    "The batch and its certificate results "
                    "do not match."
                )

            now = timezone.now()
            eligibility_errors = {}

            comparison_fields = [
                "participant_name",
                "event_name",
                "event_date",
                "team_name",
                "position",
                "certificate_type",
                "organizer_name",
            ]

            if award is not None:
                comparison_fields.append("award_result_id")

            for certificate in certificates:
                registration = registrations[
                    certificate.registration_id
                ]

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
                    continue

                current_values = certificate_values(
                    version,
                    registration,
                    certificate.participant_name,
                    award,
                )

                if any(
                    current_values[key]
                    != certificate.values.get(key)
                    for key in comparison_fields
                ):
                    raise BatchConflict(
                        "Event, team or award details changed "
                        "after this batch was generated. "
                        "Generate and review a new batch."
                    )

                if (
                    stored_document_hash(certificate)
                    != certificate.sha256
                ):
                    raise BatchConflict(
                        "A draft PDF failed its integrity check. "
                        "Generate and review a new batch."
                    )

            if eligibility_errors:
                raise ValidationError({
                    "eligibility": eligibility_errors
                })

            for certificate in certificates:
                pdf = render_sample_pdf(
                    version,
                    layout.validated_data,
                    certificate.participant_name,
                    images=version.images,
                    resolved_values=certificate.values,
                    preview_label=None,
                )

                content = pdf.getvalue()

                certificate.issued_document.save(
                    "certificate.pdf",
                    ContentFile(content),
                    save=False,
                )

                written_files.append((
                    certificate.issued_document.storage,
                    certificate.issued_document.name,
                ))

                certificate.issued_sha256 = hashlib.sha256(
                    content
                ).hexdigest()

                certificate.is_active = True

                certificate.save(update_fields=[
                    "issued_document",
                    "issued_sha256",
                    "is_active",
                ])

            batch.status = "published"
            batch.published_at = timezone.now()
            batch.published_by = user

            batch.save(update_fields=[
                "status",
                "published_at",
                "published_by",
            ])

            return batch.id

    except Exception as exc:
        for storage, filename in reversed(written_files):
            try:
                storage.delete(filename)
            except Exception:
                logger.exception(
                    "Unable to remove failed issued file: %s",
                    filename,
                )

        if isinstance(exc, IntegrityError):
            cause = getattr(exc, "__cause__", None)
            diagnostic = getattr(cause, "diag", None)

            if getattr(
                diagnostic,
                "constraint_name",
                None,
            ) in {
                "unique_active_participation_certificate",
                "unique_active_award_certificate",
            }:
                raise BatchConflict(
                    "An active certificate already exists "
                    "for one of these participants."
                ) from exc

        raise