import math

from django.urls import reverse
from rest_framework import serializers

from .models import (
    CertificateTemplate,
    CertificateTemplateVersion,
)
from .text_layout import PLACEHOLDERS, validate_template_text
from .asset_serializers import ImagePlacementSerializer
PLACEHOLDERS = [
    "participant_name",
    "event_name",
    "event_date",
    "team_name",
    "position",
    "certificate_type",
    "organizer_name",
    "certificate_id",
    "issue_date",
]


class PositionedFieldSerializer(serializers.Serializer):
    placeholder = serializers.ChoiceField(
        choices=PLACEHOLDERS
    )

    # Coordinates are fractions of the page dimensions.
    # Origin: top-left.
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

    # Font sizes are PDF points.
    font_size = serializers.FloatField(
        min_value=8,
        max_value=96,
        default=28,
    )

    min_font_size = serializers.FloatField(
        min_value=8,
        max_value=96,
        default=8,
    )

    font = serializers.ChoiceField(
        choices=[
            "sans",
            "sans-bold",
            "sans-italic",
            "sans-bold-italic",
            "script-allura-v1",
        ],
        default="sans",
    )
    align = serializers.ChoiceField(
        choices=["left", "center", "right"],
        default="center",
    )

    color = serializers.RegexField(
        regex=r"^#[0-9a-fA-F]{6}$",
        default="#18191d",
    )

    def validate(self, attrs):
        numeric_fields = [
            "x",
            "y",
            "width",
            "height",
            "font_size",
            "min_font_size",
            "line_spacing",
        ]

        if not all(
            math.isfinite(attrs[name])
            for name in numeric_fields
        ):
            raise serializers.ValidationError(
                "Coordinates and font sizes must be finite."
            )

        if attrs["x"] + attrs["width"] > 1.000001:
            raise serializers.ValidationError(
                "The field extends beyond the right page edge."
            )

        if attrs["y"] + attrs["height"] > 1.000001:
            raise serializers.ValidationError(
                "The field extends beyond the bottom page edge."
            )

        if attrs["min_font_size"] > attrs["font_size"]:
            raise serializers.ValidationError(
                "Minimum font size cannot exceed font size."
            )

        return attrs

    # Empty text means: use the selected single placeholder.
    # Non-empty text means: render a reusable paragraph.
    text = serializers.CharField(
        required=False,
        allow_blank=True,
        trim_whitespace=False,
        max_length=2000,
        default="",
    )

    line_spacing = serializers.FloatField(
        min_value=1,
        max_value=2,
        default=1.25,
    )

    valign = serializers.ChoiceField(
        choices=["top", "middle", "bottom"],
        default="middle",
    )

    def validate_text(self, value):
        try:
            return validate_template_text(value)
        except ValueError as exc:
            raise serializers.ValidationError(str(exc)) from exc


class TemplateUploadSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=120)
    background = serializers.FileField()

    def validate_background(self, value):
        if value.size > 10 * 1024 * 1024:
            raise serializers.ValidationError(
                "Upload a PNG or JPG no larger than 10 MB."
            )
        return value


class LayoutVersionSerializer(serializers.Serializer):
    base_version = serializers.IntegerField(min_value=1)

    fields = PositionedFieldSerializer(
        many=True,
        allow_empty=True,
        max_length=20,
    )

    images = ImagePlacementSerializer(
        many=True,
        required=False,
        allow_empty=True,
        max_length=20,
    )


class PreviewSerializer(serializers.Serializer):
    sample_name = serializers.CharField(
        max_length=200,
        default="Alex Morgan",
    )

    # Optional unsaved layout for editor previews.
    fields = PositionedFieldSerializer(
        many=True,
        required=False,
        allow_empty=True,
        max_length=20,
    )
    images = ImagePlacementSerializer(
            many=True,
            required=False,
            allow_empty=True,
            max_length=20,
        )


class TemplateVersionSerializer(serializers.ModelSerializer):
    background_url = serializers.SerializerMethodField()

    class Meta:
        model = CertificateTemplateVersion

        fields = [
            "id",
            "number",
            "image_width",
            "image_height",
            "fields",
            "images",
            "background_url",
            "created_at",
        ]

        read_only_fields = fields

    def get_background_url(self, obj):
        return reverse(
            "certificate-version-background",
            args=[obj.id],
        )


class CertificateTemplateSerializer(serializers.ModelSerializer):
    versions = TemplateVersionSerializer(
        many=True,
        read_only=True,
    )

    class Meta:
        model = CertificateTemplate

        fields = [
            "id",
            "event",
            "name",
            "created_at",
            "versions",
        ]

        read_only_fields = fields