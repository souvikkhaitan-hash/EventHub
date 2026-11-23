from django.core.files.base import ContentFile
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect

from rest_framework import status
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from .permissions import (
    CanManageCertificates,
    certificate_event,
    certificate_event_ids,
)

from .asset_serializers import (
    AssetUploadSerializer,
    CertificateAssetSerializer,
)
from .asset_services import normalize_asset
from .models import CertificateAsset, CertificateTemplate
from .views import private_file_response


@method_decorator(csrf_protect, name="dispatch")
class TemplateAssetsView(APIView):
    permission_classes = [CanManageCertificates]
    parser_classes = [MultiPartParser, FormParser]

    def get_template(self, request, template_id):
        return get_object_or_404(
            CertificateTemplate,
            id=template_id,
            event_id__in=certificate_event_ids(request.user),
        )

    def get(self, request, template_id):
        template = self.get_template(request, template_id)

        return Response(
            CertificateAssetSerializer(
                template.assets.all(),
                many=True,
            ).data
        )

    def post(self, request, template_id):
        template = self.get_template(request, template_id)

        serializer = AssetUploadSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        image_bytes, width, height = normalize_asset(
            serializer.validated_data["image"]
        )

        asset = CertificateAsset(
            template=template,
            name=serializer.validated_data["name"],
            image_width=width,
            image_height=height,
            created_by=request.user,
        )

        saved_name = None

        try:
            with transaction.atomic():
                certificate_event(
                    request.user,
                    template.event_id,
                    lock=True,
                )

                asset.image.save(
                    "asset.png",
                    ContentFile(image_bytes),
                    save=False,
                )
                saved_name = asset.image.name
                asset.save()

        except Exception:
            if saved_name:
                asset.image.storage.delete(saved_name)
            raise

        return Response(
            CertificateAssetSerializer(asset).data,
            status=status.HTTP_201_CREATED,
        )


class CertificateAssetImageView(APIView):
    permission_classes = [CanManageCertificates]

    def get(self, request, asset_id):
        asset = get_object_or_404(
            CertificateAsset,
            id=asset_id,
            template__event_id__in=certificate_event_ids(
                request.user
            ),
        )

        try:
            image_file = asset.image.storage.open(
                asset.image.name,
                "rb",
            )
        except FileNotFoundError:
            return Response(
                {"message": "The certificate image is unavailable."},
                status=status.HTTP_404_NOT_FOUND,
            )

        return private_file_response(
            image_file,
            content_type="image/png",
            filename=f"certificate-asset-{asset.id}.png",
        )