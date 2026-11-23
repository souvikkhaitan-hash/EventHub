from django.db.models import Q
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect
from rest_framework import serializers, status
from rest_framework.pagination import PageNumberPagination
from rest_framework.parsers import JSONParser
from rest_framework.permissions import AllowAny, BasePermission
from rest_framework.response import Response
from rest_framework.views import APIView
from .models import Announcement, Question
from .serializers import AnnouncementAction, AnnouncementInput, QuestionAction, QuestionInput
from .services import board_event, change_announcement, change_question, create_announcement, create_question, manager


def private(data, code=200):
    response = Response(data, status=code)
    response["Cache-Control"] = "private, no-store"
    response["Vary"] = "Cookie"
    return response


class ActiveAccount(BasePermission):
    def has_permission(self, request, view):
        return bool(request.user.is_authenticated and request.user.is_active)


def announcement_data(item, manages):
    result = {name: getattr(item, name) for name in ["id", "title", "body", "stage", "pinned", "published_at", "updated_at"]}
    if manages:
        result.update(status=item.status, revision=item.revision)
    return result


def question_data(item, user, manages):
    mine = bool(user.is_authenticated and item.author_id == user.pk)
    return {"id": item.pk, "body": item.body, "answer": item.answer, "visible": item.visible,
        "revision": item.revision, "is_mine": mine, "can_edit": mine and not item.answer and item.visible and item.event.status == "published",
        "can_withdraw": mine and item.visible, "answered_at": item.answered_at, "created_at": item.created_at,
        "updated_at": item.updated_at}


class BoardPagination(PageNumberPagination):
    page_size = 15


class BoardView(APIView):
    permission_classes = [AllowAny]

    def get(self, request, event_id):
        manage = request.query_params.get("manage") == "1"
        event = board_event(request.user, event_id, manage=manage)
        manages = manager(request.user, event)
        tab = request.query_params.get("tab", "announcements")
        if tab not in ["announcements", "questions"]:
            raise serializers.ValidationError({"tab": "Choose announcements or questions."})
        text = request.query_params.get("search", "").strip()[:100]
        if tab == "announcements":
            items = Announcement.objects.filter(event=event)
            if not manage:
                items = items.filter(status="published")
            if text:
                items = items.filter(Q(title__icontains=text) | Q(body__icontains=text))
            items = items.order_by("-pinned", "-published_at", "-created_at", "-pk")
        else:
            items = Question.objects.filter(event=event).select_related("event")
            if not manage:
                items = items.filter(visible=True)
            if request.query_params.get("unanswered") == "1":
                items = items.filter(answer="")
            if text:
                items = items.filter(Q(body__icontains=text) | Q(answer__icontains=text))
            items = items.order_by("-created_at", "-pk")
        paginator = BoardPagination()
        page = paginator.paginate_queryset(items, request, view=self)
        payload = paginator.get_paginated_response([
            announcement_data(item, manage) if tab == "announcements" else question_data(item, request.user, manages)
            for item in page
        ]).data
        payload.update(event={"id": event.pk, "title": event.title, "status": event.status},
            can_manage=manages, can_ask=bool(request.user.is_authenticated and request.user.is_active and event.status == "published"))
        return private(payload)


@method_decorator(csrf_protect, name="dispatch")
class AnnouncementsView(APIView):
    permission_classes = [ActiveAccount]
    parser_classes = [JSONParser]

    def post(self, request, event_id):
        data = AnnouncementInput(data=request.data)
        data.is_valid(raise_exception=True)
        item, created = create_announcement(request.user, event_id, data.validated_data)
        return private(announcement_data(item, True), 201 if created else 200)


@method_decorator(csrf_protect, name="dispatch")
class AnnouncementDetailView(APIView):
    permission_classes = [ActiveAccount]
    parser_classes = [JSONParser]

    def post(self, request, event_id, item_id):
        data = AnnouncementAction(data=request.data)
        data.is_valid(raise_exception=True)
        item = change_announcement(request.user, event_id, item_id, data.validated_data)
        return private(announcement_data(item, True))


@method_decorator(csrf_protect, name="dispatch")
class QuestionsView(APIView):
    permission_classes = [ActiveAccount]
    parser_classes = [JSONParser]

    def post(self, request, event_id):
        data = QuestionInput(data=request.data)
        data.is_valid(raise_exception=True)
        item, created = create_question(request.user, event_id, data.validated_data)
        return private(question_data(item, request.user, False), 201 if created else 200)


@method_decorator(csrf_protect, name="dispatch")
class QuestionDetailView(APIView):
    permission_classes = [ActiveAccount]
    parser_classes = [JSONParser]

    def post(self, request, event_id, item_id):
        data = QuestionAction(data=request.data)
        data.is_valid(raise_exception=True)
        item = change_question(request.user, event_id, item_id, data.validated_data)
        return private(question_data(item, request.user, manager(request.user, item.event)))
