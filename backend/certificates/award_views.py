from django.shortcuts import get_object_or_404
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect

from rest_framework import serializers
from rest_framework.exceptions import ValidationError
from rest_framework.parsers import JSONParser
from rest_framework.response import Response
from rest_framework.views import APIView

from .permissions import (
    CanManageCertificates,
    certificate_event,
    certificate_event_ids,
)

from .award_services import (
    certificate_eligibility,
    certificate_values,
    validate_certificate_fields,
)
from .models import AwardResult
from .recipient_services import certificate_registrations
from .serializers import PositionedFieldSerializer
from .services import render_sample_pdf
from .views import owned_version, private_file_response


class AwardPreviewSerializer(serializers.Serializer):
    award_result_id = serializers.UUIDField()
    registration_id = serializers.IntegerField(min_value=1)
    participant_name = serializers.CharField(max_length=200)


@method_decorator(csrf_protect, name="dispatch")
class AwardRecipientPreviewView(APIView):
    permission_classes = [CanManageCertificates]
    parser_classes = [JSONParser]

    def post(self, request, version_id):
        version = owned_version(request.user, version_id)
        event = version.template.event

        serializer = AwardPreviewSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        award = get_object_or_404(
            AwardResult,
            pk=data["award_result_id"],
            event=event,
        )

        registration = get_object_or_404(
            certificate_registrations(event),
            pk=data["registration_id"],
        )

        eligibility = certificate_eligibility(
            registration,
            event,
            award,
        )

        if not eligibility["eligible"]:
            raise ValidationError({
                "eligibility": [
                    row["message"]
                    for row in eligibility["reasons"]
                ]
            })

        layout = PositionedFieldSerializer(
            data=version.fields,
            many=True,
            allow_empty=True,
            max_length=20,
        )
        layout.is_valid(raise_exception=True)

        validate_certificate_fields(
            layout.validated_data,
            award,
        )

        values = certificate_values(
            version,
            registration,
            data["participant_name"],
            award,
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
                {"message": "A template image is unavailable."},
                status=404,
            )

        return private_file_response(
            pdf,
            content_type="application/pdf",
            filename=f"award-{registration.id}-preview.pdf",
        )