from rest_framework import serializers


class StrictInput(serializers.Serializer):
    def to_internal_value(self, data):
        if not isinstance(data, dict) or set(data) - set(self.fields):
            raise serializers.ValidationError({"non_field_errors": ["Unexpected request fields."]})
        return super().to_internal_value(data)


class AnnouncementInput(StrictInput):
    request_key = serializers.UUIDField()
    title = serializers.CharField(max_length=160)
    body = serializers.CharField(max_length=5000)
    stage = serializers.ChoiceField(choices=["general", "before", "during", "after"], default="general")
    pinned = serializers.BooleanField(default=False)


class QuestionInput(StrictInput):
    request_key = serializers.UUIDField()
    body = serializers.CharField(max_length=1500)


class AnnouncementAction(StrictInput):
    revision = serializers.IntegerField(min_value=1)
    action = serializers.ChoiceField(choices=["edit", "publish", "withdraw"])
    title = serializers.CharField(max_length=160, required=False)
    body = serializers.CharField(max_length=5000, required=False)
    stage = serializers.ChoiceField(choices=["general", "before", "during", "after"], required=False)
    pinned = serializers.BooleanField(required=False)
    reason = serializers.CharField(max_length=300, required=False)


class QuestionAction(StrictInput):
    revision = serializers.IntegerField(min_value=1)
    action = serializers.ChoiceField(choices=["edit", "answer", "hide", "restore", "withdraw"])
    body = serializers.CharField(max_length=1500, required=False)
    answer = serializers.CharField(max_length=5000, required=False)
    reason = serializers.CharField(max_length=300, required=False)
