from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect

from rest_framework import serializers, status
from rest_framework.exceptions import ValidationError
from rest_framework.pagination import PageNumberPagination
from rest_framework.parsers import JSONParser
from rest_framework.response import Response
from rest_framework.views import APIView

from events.models import Event
from events.permissions import IsOrganizer

from .recipient_services import (
    certificate_registrations,
    participation_eligibility,
    real_participation_values,
    recipient_details,
    validate_participation_fields,
)
from .serializers import PositionedFieldSerializer
from .services import render_sample_pdf
from .views import owned_version, private_file_response


class RecipientSearchSerializer(serializers.Serializer):
    search = serializers.CharField(
        required=False,
        allow_blank=True,
        max_length=100,
        default="",
    )


class RecipientPreviewSerializer(serializers.Serializer):
    registration_id = serializers.IntegerField(min_value=1)

    # A reviewed name for this preview only.
    # It does not change the student's account.
    participant_name = serializers.CharField(
        required=False,
        allow_blank=False,
        max_length=200,
    )


class RecipientPagination(PageNumberPagination):
    page_size = 50


class EventCertificateRecipientsView(APIView):
    permission_classes = [IsOrganizer]

    def get(self, request, event_id):
        event = get_object_or_404(
            Event,
            id=event_id,
            organizer=request.user,
        )

        query = RecipientSearchSerializer(
            data=request.query_params
        )
        query.is_valid(raise_exception=True)

        registrations = certificate_registrations(event)
        search = query.validated_data["search"]

        if search:
            registrations = registrations.filter(
                Q(student__username__icontains=search)
                | Q(student__first_name__icontains=search)
                | Q(student__last_name__icontains=search)
                | Q(team_membership__team__name__icontains=search)
            )

        paginator = RecipientPagination()
        page = paginator.paginate_queryset(
            registrations,
            request,
            view=self,
        )

        now = timezone.now()

        response = paginator.get_paginated_response([
            recipient_details(registration, event, now)
            for registration in page
        ])

        response.data["policy"] = (
            "Participation requires a finished published event, "
            "an active registration and recorded attendance. "
            "Team participants must belong to a confirmed team."
        )

        response["Cache-Control"] = "private, no-store"
        return response


@method_decorator(csrf_protect, name="dispatch")
class CertificateRecipientPreviewView(APIView):
    permission_classes = [IsOrganizer]
    parser_classes = [JSONParser]

    def post(self, request, version_id):
        version = owned_version(request.user, version_id)
        event = version.template.event

        serializer = RecipientPreviewSerializer(
            data=request.data
        )
        serializer.is_valid(raise_exception=True)

        registration = get_object_or_404(
            certificate_registrations(event),
            id=serializer.validated_data["registration_id"],
        )

        eligibility = participation_eligibility(
            registration,
            event,
        )

        if not eligibility["eligible"]:
            raise ValidationError({
                "eligibility": [
                    reason["message"]
                    for reason in eligibility["reasons"]
                ]
            })

        # Real-recipient previews use a saved layout.
        layout = PositionedFieldSerializer(
            data=version.fields,
            many=True,
            allow_empty=True,
            max_length=20,
        )
        layout.is_valid(raise_exception=True)

        validate_participation_fields(
            layout.validated_data
        )

        values = real_participation_values(
            version,
            registration,
            serializer.validated_data.get("participant_name"),
        )

        try:
            pdf = render_sample_pdf(
                version,
                layout.validated_data,
                values["participant_name"],
                images=version.images,
                resolved_values=values,
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

        return private_file_response(
            pdf,
            content_type="application/pdf",
            filename=(
                f"participant-{registration.id}-preview.pdf"
            ),
        )