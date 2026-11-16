import math

from django.urls import reverse
from rest_framework import serializers

from .models import CertificateAsset


class AssetUploadSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=120)
    image = serializers.FileField()

    def validate_image(self, value):
        if value.size > 5 * 1024 * 1024:
            raise serializers.ValidationError(
                "Upload a PNG or JPG no larger than 5 MB."
            )

        return value


class ImagePlacementSerializer(serializers.Serializer):
    asset_id = serializers.IntegerField(min_value=1)

    # Coordinates use the same top-left origin as text fields.
    x = serializers.FloatField(min_value=0, max_value=1)
    y = serializers.FloatField(min_value=0, max_value=1)

    width = serializers.FloatField(
        min_value=0.01,
        max_value=1,
    )

    height = serializers.FloatField(
        min_value=0.01,
        max_value=1,
    )
    rotation = serializers.FloatField(
        min_value=-180,
        max_value=180,
        default=0,
    )

    def validate(self, attrs):
        if not all(
            math.isfinite(attrs[key])
            for key in ["x", "y", "width", "height", "rotation"]
        ):
            raise serializers.ValidationError(
                "Image coordinates must be finite."
            )

        if attrs["x"] + attrs["width"] > 1.000001:
            raise serializers.ValidationError(
                "The image box extends beyond the right page edge."
            )

        if attrs["y"] + attrs["height"] > 1.000001:
            raise serializers.ValidationError(
                "The image box extends beyond the bottom page edge."
            )

        return attrs


class CertificateAssetSerializer(serializers.ModelSerializer):
    image_url = serializers.SerializerMethodField()

    class Meta:
        model = CertificateAsset

        fields = [
            "id",
            "name",
            "image_width",
            "image_height",
            "image_url",
            "created_at",
        ]

        read_only_fields = fields

    def get_image_url(self, obj):
        return reverse(
            "certificate-asset-image",
            args=[obj.id],
        )