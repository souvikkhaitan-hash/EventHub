import secrets

from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect

from rest_framework import serializers
from rest_framework.exceptions import APIException
from rest_framework.parsers import JSONParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle
from rest_framework.views import APIView

from events.models import Event, Registration
from events.permissions import IsOrganizer

from .models import (
    CertificateBatch,
    CertificateRevocation,
    GeneratedCertificate,
)


class CertificateStateConflict(APIException):
    status_code = 409
    default_detail = "The certificate state has changed."
    default_code = "certificate_state_conflict"


class VerificationThrottle(AnonRateThrottle):
    rate = "60/min"


class RevokeCertificateSerializer(serializers.Serializer):
    reason = serializers.CharField(
        max_length=500,
        trim_whitespace=True,
        allow_blank=False,
    )
    issued_sha256 = serializers.RegexField(
        regex=r"^[0-9a-f]{64}$",
    )
    confirm = serializers.BooleanField()

    def validate_confirm(self, value):
        if not value:
            raise serializers.ValidationError(
                "Confirm that you want to revoke this certificate."
            )
        return value


def no_store_response(data, status=200):
    response = Response(data, status=status)
    response["Cache-Control"] = "no-store"
    response["X-Content-Type-Options"] = "nosniff"
    return response


def revocation_details(certificate):
    record = CertificateRevocation.objects.filter(
        certificate=certificate
    ).first()

    return {
        "certificate_id": str(certificate.id),
        "is_active": certificate.is_active,
        "issued_sha256": certificate.issued_sha256,
        "revoked_at": record.revoked_at if record else None,
        "reason": record.reason if record else "",
    }


def revoke_certificate(*, user, certificate_id, data):
    # Find the owning event without revealing another organiser's record.
    reference = get_object_or_404(
        GeneratedCertificate.objects.filter(
            batch__event__organizer=user,
        ).values(
            "batch_id",
            "batch__event_id",
            "registration_id",
        ),
        pk=certificate_id,
    )

    # Match the existing publication lock order:
    # event -> batch -> registration -> generated certificate.
    with transaction.atomic():
        get_object_or_404(
            Event.objects.select_for_update(),
            pk=reference["batch__event_id"],
            organizer=user,
        )

        batch = get_object_or_404(
            CertificateBatch.objects.select_for_update(),
            pk=reference["batch_id"],
        )

        get_object_or_404(
            Registration.objects.select_for_update(),
            pk=reference["registration_id"],
        )

        certificate = get_object_or_404(
            GeneratedCertificate.objects.select_for_update(),
            pk=certificate_id,
        )

        if (
            batch.status != "published"
            or not certificate.issued_document
            or not certificate.issued_sha256
        ):
            raise CertificateStateConflict(
                "Only an issued certificate can be revoked."
            )

        if not secrets.compare_digest(
            certificate.issued_sha256,
            data["issued_sha256"],
        ):
            raise CertificateStateConflict(
                "The issued file differs from the one reviewed. "
                "Reload the certificate before continuing."
            )

        previous = CertificateRevocation.objects.filter(
            certificate=certificate
        ).first()

        if previous is not None:
            if certificate.is_active:
                raise CertificateStateConflict(
                    "This certificate has an inconsistent revocation state."
                )

            if previous.reason != data["reason"]:
                raise CertificateStateConflict(
                    "This certificate was already revoked. "
                    "Its original reason has been preserved."
                )

            # Retrying the same request preserves the original audit record.
            return revocation_details(certificate)

        if not certificate.is_active:
            raise CertificateStateConflict(
                "This certificate is already inactive."
            )

        CertificateRevocation.objects.create(
            certificate=certificate,
            reason=data["reason"],
            revoked_by=user,
        )

        certificate.is_active = False
        certificate.save(update_fields=["is_active"])

        return revocation_details(certificate)


class PublicCertificateVerificationView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [VerificationThrottle]

    def get(self, request, certificate_id):
        certificate = get_object_or_404(
            GeneratedCertificate.objects.select_related("batch"),
            pk=certificate_id,
            batch__status="published",
        )

        # A published batch alone does not prove an issued PDF exists.
        if (
            not certificate.issued_document
            or not certificate.issued_sha256
        ):
            return no_store_response(
                {"detail": "Certificate not found."},
                status=404,
            )

        revoked = CertificateRevocation.objects.filter(
            certificate=certificate
        ).exists()

        if revoked:
            verification_status = "revoked"
        elif certificate.is_active:
            verification_status = "valid"
        else:
            verification_status = "unavailable"

        values = certificate.values or {}

        return no_store_response({
            "certificate_id": str(certificate.id),
            "status": verification_status,
            "participant_name": certificate.participant_name,
            "event_name": values.get("event_name", ""),
            "event_date": values.get("event_date", ""),
            "certificate_type": values.get(
                "certificate_type",
                "Participation",
            ),
            "published_at": certificate.batch.published_at,
        })


@method_decorator(csrf_protect, name="dispatch")
class OrganizerCertificateRevocationView(APIView):
    permission_classes = [IsOrganizer]
    parser_classes = [JSONParser]

    def get(self, request, certificate_id):
        certificate = get_object_or_404(
            GeneratedCertificate,
            pk=certificate_id,
            batch__event__organizer=request.user,
        )

        return no_store_response(
            revocation_details(certificate)
        )

    def post(self, request, certificate_id):
        serializer = RevokeCertificateSerializer(
            data=request.data
        )
        serializer.is_valid(raise_exception=True)

        result = revoke_certificate(
            user=request.user,
            certificate_id=certificate_id,
            data=serializer.validated_data,
        )

        return no_store_response(result)