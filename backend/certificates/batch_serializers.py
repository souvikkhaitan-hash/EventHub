from django.urls import reverse

from rest_framework import serializers

from .models import CertificateBatch, GeneratedCertificate


class BatchRecipientSerializer(serializers.Serializer):
    registration_id = serializers.IntegerField(min_value=1)
    participant_name = serializers.CharField(max_length=200)


class BatchCreateSerializer(serializers.Serializer):
    template_version_id = serializers.IntegerField(min_value=1)
    request_key = serializers.UUIDField()

    award_result_id = serializers.UUIDField(
        required=False,
        allow_null=True,
    )

    recipients = BatchRecipientSerializer(
        many=True,
        min_length=1,
        max_length=50,
        allow_empty=False,
    )

    def validate_recipients(self, value):
        registration_ids = [
            item["registration_id"]
            for item in value
        ]

        if len(registration_ids) != len(set(registration_ids)):
            raise serializers.ValidationError(
                "Select each participant only once."
            )

        return value


class GeneratedCertificateSerializer(serializers.ModelSerializer):
    download_url = serializers.SerializerMethodField()

    class Meta:
        model = GeneratedCertificate

        fields = [
            "id",
            "registration",
            "award_result",
            "participant_name",
            "values",
            "sha256",
            "created_at",
            "download_url",
            "issued_sha256",
            "is_active",
        ]

        read_only_fields = fields

    def get_download_url(self, obj):
        return reverse(
            "generated-certificate-document",
            args=[obj.id],
        )


class CertificateBatchListSerializer(serializers.ModelSerializer):
    template_version_id = serializers.IntegerField(read_only=True)

    award_result_id = serializers.UUIDField(
        read_only=True,
        allow_null=True,
    )

    certificate_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = CertificateBatch

        fields = [
            "id",
            "event",
            "template_version_id",
            "award_result_id",
            "request_key",
            "status",
            "created_at",
            "published_at",
            "certificate_count",
        ]

        read_only_fields = fields


class CertificateBatchDetailSerializer(
    CertificateBatchListSerializer
):
    certificates = GeneratedCertificateSerializer(
        many=True,
        read_only=True,
    )

    review_hash = serializers.SerializerMethodField()

    def get_review_hash(self, obj):
        from .publication_services import batch_review_hash

        return batch_review_hash(obj)

    class Meta(CertificateBatchListSerializer.Meta):
        fields = (
            CertificateBatchListSerializer.Meta.fields
            + ["certificates", "review_hash"]
        )

        read_only_fields = fields