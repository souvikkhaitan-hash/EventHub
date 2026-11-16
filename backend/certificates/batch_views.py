from django.db.models import Count
from django.shortcuts import get_object_or_404
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect

from rest_framework import status
from rest_framework.pagination import PageNumberPagination
from rest_framework.parsers import JSONParser
from rest_framework.response import Response
from rest_framework.views import APIView

from events.models import Event
from events.permissions import IsOrganizer

from .batch_serializers import (
    BatchCreateSerializer,
    CertificateBatchDetailSerializer,
    CertificateBatchListSerializer,
)
from .batch_services import create_draft_batch
from .models import CertificateBatch, GeneratedCertificate
from .views import private_file_response


def owned_batches(user):
    return (
        CertificateBatch.objects
        .filter(event__organizer=user)
        .annotate(certificate_count=Count("certificates"))
        .prefetch_related("certificates")
    )


def private_json(response):
    response["Cache-Control"] = "private, no-store"
    return response


class BatchPagination(PageNumberPagination):
    page_size = 20


@method_decorator(csrf_protect, name="dispatch")
class EventCertificateBatchesView(APIView):
    permission_classes = [IsOrganizer]
    parser_classes = [JSONParser]

    def get(self, request, event_id):
        event = get_object_or_404(
            Event,
            id=event_id,
            organizer=request.user,
        )

        batches = owned_batches(request.user).filter(
            event=event
        ).order_by("-created_at", "-id")

        paginator = BatchPagination()
        page = paginator.paginate_queryset(
            batches,
            request,
            view=self,
        )

        return private_json(
            paginator.get_paginated_response(
                CertificateBatchListSerializer(
                    page,
                    many=True,
                ).data
            )
        )

    def post(self, request, event_id):
        serializer = BatchCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            batch_id, created = create_draft_batch(
                request.user,
                event_id,
                serializer.validated_data,
            )
        except FileNotFoundError:
            return Response(
                {
                    "message": (
                        "A certificate background or image "
                        "is unavailable."
                    )
                },
                status=status.HTTP_404_NOT_FOUND,
            )

        batch = get_object_or_404(
            owned_batches(request.user),
            id=batch_id,
        )

        return private_json(Response(
            CertificateBatchDetailSerializer(batch).data,
            status=(
                status.HTTP_201_CREATED
                if created
                else status.HTTP_200_OK
            ),
        ))


class CertificateBatchDetailView(APIView):
    permission_classes = [IsOrganizer]

    def get(self, request, batch_id):
        batch = get_object_or_404(
            owned_batches(request.user),
            id=batch_id,
        )

        return private_json(Response(
            CertificateBatchDetailSerializer(batch).data
        ))


class GeneratedCertificateDocumentView(APIView):
    permission_classes = [IsOrganizer]

    def get(self, request, certificate_id):
        certificate = get_object_or_404(
            GeneratedCertificate.objects.select_related("batch"),
            id=certificate_id,
            batch__event__organizer=request.user,
        )

        document_field = (
            certificate.issued_document
            if certificate.batch.status == "published"
            else certificate.document
        )

        if not document_field:
            return Response(
                {"message": "The certificate PDF is unavailable."},
                status=status.HTTP_404_NOT_FOUND,
            )

        try:
            document = document_field.storage.open(
                document_field.name,
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