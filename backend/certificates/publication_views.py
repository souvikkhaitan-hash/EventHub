from django.shortcuts import get_object_or_404
from django.urls import reverse
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect

from rest_framework import serializers, status
from rest_framework.pagination import PageNumberPagination
from rest_framework.parsers import JSONParser
from rest_framework.response import Response
from rest_framework.views import APIView

from events.permissions import IsOrganizer, IsStudent

from .batch_serializers import CertificateBatchDetailSerializer
from .batch_views import owned_batches, private_json
from .models import GeneratedCertificate
from .publication_services import publish_certificate_batch
from .views import private_file_response


class PublishBatchSerializer(serializers.Serializer):
    review_hash = serializers.RegexField(
        regex=r"^[0-9a-f]{64}$"
    )
    confirm_review = serializers.BooleanField()

    def validate_confirm_review(self, value):
        if not value:
            raise serializers.ValidationError(
                "Confirm that you reviewed the batch before publishing."
            )
        return value


@method_decorator(csrf_protect, name="dispatch")
class PublishCertificateBatchView(APIView):
    permission_classes = [IsOrganizer]
    parser_classes = [JSONParser]

    def post(self, request, batch_id):
        serializer = PublishBatchSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            published_id = publish_certificate_batch(
                request.user,
                batch_id,
                serializer.validated_data["review_hash"],
            )
        except FileNotFoundError:
            return Response(
                {
                    "message": (
                        "A required certificate file is unavailable. "
                        "The batch was not published."
                    )
                },
                status=status.HTTP_404_NOT_FOUND,
            )

        batch = get_object_or_404(
            owned_batches(request.user),
            id=published_id,
        )

        return private_json(Response(
            CertificateBatchDetailSerializer(batch).data
        ))


class StudentCertificateSerializer(serializers.ModelSerializer):
    event_name = serializers.CharField(
        source="values.event_name",
        read_only=True,
    )
    event_date = serializers.CharField(
        source="values.event_date",
        read_only=True,
    )
    team_name = serializers.CharField(
        source="values.team_name",
        read_only=True,
    )
    certificate_type = serializers.CharField(
        source="values.certificate_type",
        read_only=True,
    )
    published_at = serializers.DateTimeField(
        source="batch.published_at",
        read_only=True,
    )
    download_url = serializers.SerializerMethodField()

    class Meta:
        model = GeneratedCertificate

        fields = [
            "id",
            "participant_name",
            "event_name",
            "event_date",
            "team_name",
            "certificate_type",
            "published_at",
            "download_url",
        ]

        read_only_fields = fields

    def get_download_url(self, obj):
        return reverse(
            "student-certificate-document",
            args=[obj.id],
        )


class StudentCertificatePagination(PageNumberPagination):
    page_size = 50


def student_certificates(user):
    return (
        GeneratedCertificate.objects
        .filter(
            registration__student=user,
            batch__status="published",
            is_active=True,
        )
        .select_related("batch")
        .order_by("-batch__published_at", "id")
    )


class MyCertificatesView(APIView):
    permission_classes = [IsStudent]

    def get(self, request):
        paginator = StudentCertificatePagination()

        page = paginator.paginate_queryset(
            student_certificates(request.user),
            request,
            view=self,
        )

        return private_json(
            paginator.get_paginated_response(
                StudentCertificateSerializer(
                    page,
                    many=True,
                ).data
            )
        )


class StudentCertificateDocumentView(APIView):
    permission_classes = [IsStudent]

    def get(self, request, certificate_id):
        certificate = get_object_or_404(
            student_certificates(request.user),
            id=certificate_id,
        )

        if not certificate.issued_document:
            return Response(
                {"message": "The certificate PDF is unavailable."},
                status=status.HTTP_404_NOT_FOUND,
            )

        try:
            document = certificate.issued_document.storage.open(
                certificate.issued_document.name,
                "rb",
            )
        except FileNotFoundError:
            return Response(
                {"message": "The certificate PDF is unavailable."},
                status=status.HTTP_404_NOT_FOUND,
            )

        return private_file_response(
            document,
            content_type="application/pdf",
            filename=f"certificate-{certificate.id}.pdf",
        )