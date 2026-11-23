from io import BytesIO

from django.core.files.base import ContentFile
from django.db import transaction
from django.http import FileResponse
from django.shortcuts import get_object_or_404
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect
from .asset_services import get_template_assets
from rest_framework import status
from rest_framework.parsers import (
    FormParser,
    JSONParser,
    MultiPartParser,
)
from rest_framework.response import Response
from rest_framework.views import APIView

from events.models import Event
from .permissions import (
    CanManageCertificates,
    certificate_event,
    certificate_event_ids,
)

from .models import (
    CertificateTemplate,
    CertificateTemplateVersion,
)
from .serializers import (
    CertificateTemplateSerializer,
    LayoutVersionSerializer,
    PositionedFieldSerializer,
    PreviewSerializer,
    TemplateUploadSerializer,
    TemplateVersionSerializer,
)
from .services import (
    normalize_background,
    render_sample_pdf,
)


def private_file_response(file, *, content_type, filename):
    response = FileResponse(
        file,
        content_type=content_type,
        as_attachment=False,
        filename=filename,
    )
    response["Cache-Control"] = "private, no-store"
    response["X-Content-Type-Options"] = "nosniff"
    return response


def owned_version(user, version_id):
    return get_object_or_404(
        CertificateTemplateVersion.objects.select_related(
            "template__event__organizer"
        ),
        id=version_id,
        template__event_id__in=certificate_event_ids(user),
    )


@method_decorator(csrf_protect, name="dispatch")
class EventCertificateTemplatesView(APIView):
    permission_classes = [CanManageCertificates]
    parser_classes = [MultiPartParser, FormParser]

    def get(self, request, event_id):
        event = certificate_event(request.user, event_id)

        templates = (
            CertificateTemplate.objects
            .filter(event=event)
            .prefetch_related("versions")
        )

        return Response(
            CertificateTemplateSerializer(
                templates,
                many=True,
            ).data
        )

    def post(self, request, event_id):
        event = certificate_event(request.user, event_id)

        serializer = TemplateUploadSerializer(
            data=request.data
        )
        serializer.is_valid(raise_exception=True)

        image_bytes, width, height = normalize_background(
            serializer.validated_data["background"]
        )

        default_layout = PositionedFieldSerializer(
            data=[{
                "placeholder": "participant_name",
                "x": 0.1,
                "y": 0.45,
                "width": 0.8,
                "height": 0.1,
                "font_size": 28,
            }],
            many=True,
        )
        default_layout.is_valid(raise_exception=True)

        version = None
        saved_name = None

        try:
            with transaction.atomic():
                event = certificate_event(
                    request.user,
                    event_id,
                    lock=True,
                )

                template = CertificateTemplate.objects.create(
                    event=event,
                    name=serializer.validated_data["name"],
                    created_by=request.user,
                )

                version = CertificateTemplateVersion(
                    template=template,
                    number=1,
                    image_width=width,
                    image_height=height,
                    fields=default_layout.validated_data,
                    created_by=request.user,
                )

                version.background.save(
                    "background.png",
                    ContentFile(image_bytes),
                    save=False,
                )
                saved_name = version.background.name
                version.save()

        except Exception:
            # Database rollback does not undo a filesystem write.
            if saved_name and version is not None:
                version.background.storage.delete(saved_name)
            raise

        return Response(
            CertificateTemplateSerializer(template).data,
            status=status.HTTP_201_CREATED,
        )


@method_decorator(csrf_protect, name="dispatch")
class TemplateVersionsView(APIView):
    permission_classes = [CanManageCertificates]
    parser_classes = [JSONParser]

    def get(self, request, template_id):
        template = get_object_or_404(
            CertificateTemplate,
            id=template_id,
            event_id__in=certificate_event_ids(request.user),
        )

        return Response(
            TemplateVersionSerializer(
                template.versions.all(),
                many=True,
            ).data
        )

    def post(self, request, template_id):
        serializer = LayoutVersionSerializer(
            data=request.data
        )
        serializer.is_valid(raise_exception=True)

        with transaction.atomic():
            reference = get_object_or_404(
                CertificateTemplate,
                id=template_id,
                event_id__in=certificate_event_ids(
                    request.user
                ),
            )

            certificate_event(
                request.user,
                reference.event_id,
                lock=True,
            )

            template = get_object_or_404(
                CertificateTemplate.objects.select_for_update(
                    of=("self",)
                ),
                id=template_id,
                event_id__in=certificate_event_ids(request.user),
            )

            latest = template.versions.order_by(
                "-number"
            ).first()

            if latest is None:
                return Response(
                    {"message": "The template has no background version."},
                    status=status.HTTP_409_CONFLICT,
                )

            if (
                serializer.validated_data["base_version"]
                != latest.number
            ):
                return Response(
                    {
                        "message": (
                            "A newer layout was saved. "
                            "Reload before saving your changes."
                        )
                    },
                    status=status.HTTP_409_CONFLICT,
                )
                        # Older clients omit images. Preserve existing placements.
            # Sending an explicit [] removes them from the new version.
            images = serializer.validated_data.get(
                "images",
                latest.images,
            )

            get_template_assets(template, images)

            version = CertificateTemplateVersion.objects.create(
                template=template,
                number=latest.number + 1,
                background=latest.background.name,
                image_width=latest.image_width,
                image_height=latest.image_height,
                fields=serializer.validated_data["fields"],
                images=images,
                created_by=request.user,
            )

        return Response(
            TemplateVersionSerializer(version).data,
            status=status.HTTP_201_CREATED,
        )


class TemplateBackgroundView(APIView):
    permission_classes = [CanManageCertificates]

    def get(self, request, version_id):
        version = owned_version(
            request.user,
            version_id,
        )

        try:
            file = version.background.storage.open(
                version.background.name,
                "rb",
            )
        except FileNotFoundError:
            return Response(
                {"message": "The background file is unavailable."},
                status=status.HTTP_404_NOT_FOUND,
            )

        return private_file_response(
            file,
            content_type="image/png",
            filename=f"certificate-background-{version.id}.png",
        )


@method_decorator(csrf_protect, name="dispatch")
class TemplatePreviewView(APIView):
    permission_classes = [CanManageCertificates]
    parser_classes = [JSONParser]

    def post(self, request, version_id):
        version = owned_version(
            request.user,
            version_id,
        )

        serializer = PreviewSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        # Validate stored layouts too, before rendering.
        layout = PositionedFieldSerializer(
            data=serializer.validated_data.get(
                "fields",
                version.fields,
            ),
            many=True,
            max_length=20,
        )
        layout.is_valid(raise_exception=True)

        try:
                        pdf = render_sample_pdf(
                version,
                layout.validated_data,
                serializer.validated_data["sample_name"],
                images=serializer.validated_data.get(
                    "images",
                    version.images,
                ),
            )
        except FileNotFoundError:
            return Response(
                {"message": "The template background is unavailable."},
                status=status.HTTP_404_NOT_FOUND,
            )

        return private_file_response(
            pdf,
            content_type="application/pdf",
            filename=f"certificate-preview-{version.id}.pdf",
        )