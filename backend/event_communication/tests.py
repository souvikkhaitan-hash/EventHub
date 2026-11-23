import uuid
from datetime import timedelta
from unittest.mock import patch
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.db import transaction
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient
from events.models import Event, EventStaffMembership, Registration
from eventhub_notifications.models import NotificationEvent, Notification
from eventhub_notifications.services import process_event_step
from .models import Announcement, Question, CommunicationHistory
from .services import Conflict, change_announcement, change_question, create_announcement, create_question, notification_is_current


class CommunicationTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.owner = User.objects.create_user(username="comm_owner", email="private-owner@example.com")
        self.manager = User.objects.create_user(username="comm_manager")
        self.volunteer = User.objects.create_user(username="comm_attendance")
        self.coordinator = User.objects.create_user(username="comm_certificates")
        self.student = User.objects.create_user(username="comm_student", email="private-student@example.com")
        self.other = User.objects.create_user(username="comm_other")
        group, _ = Group.objects.get_or_create(name="Organizer")
        self.owner.groups.add(group)
        self.event = self.new_event(self.owner)
        self.other_event = self.new_event(self.owner)
        for user, role in [(self.manager,"manager"),(self.volunteer,"attendance"),(self.coordinator,"certificates")]:
            EventStaffMembership.objects.create(event=self.event,user=user,role=role,assigned_by=self.owner)
        self.client = APIClient()

    def new_event(self, owner, status="published"):
        now = timezone.now()
        return Event.objects.create(title="Communication workshop",description="Details",venue="Lab",category="workshop",
            start_datetime=now+timedelta(days=2),end_datetime=now+timedelta(days=2,hours=2),
            registration_deadline=now+timedelta(days=1),capacity=100,organizer=owner,status=status)

    def login(self, user):
        self.client.force_login(user)

    def board(self, event=None, **params):
        return self.client.get(reverse("event-communication-board",args=[(event or self.event).pk]),params)

    def announcement(self):
        return create_announcement(self.owner,self.event.pk,{"title":"Round one","body":"Bring a laptop.","stage":"before","pinned":False,"request_key":uuid.uuid4()})[0]

    def question(self):
        return create_question(self.student,self.event.pk,{"body":"Do we need a laptop?","request_key":uuid.uuid4()})[0]

    def publish(self, item):
        return change_announcement(self.owner,self.event.pk,item.pk,{"action":"publish","revision":item.revision})

    def drain(self):
        for _ in range(30):
            if not process_event_step():return
        self.fail("Outbox failed to drain")

    def test_guest_can_read_but_cannot_post(self):
        self.assertEqual(self.board().status_code,200)
        response=self.client.post(reverse("event-question-create",args=[self.event.pk]),{"body":"Question","request_key":str(uuid.uuid4())},format="json")
        self.assertIn(response.status_code,[401,403])

    def test_draft_event_is_private(self):
        self.event.status="draft";self.event.save()
        self.assertEqual(self.board().status_code,404)
        self.login(self.manager);self.assertEqual(self.board(manage="1").status_code,200)

    def test_draft_announcement_never_leaks_on_public_board(self):
        self.announcement();self.assertEqual(self.board().data["count"],0)
        self.login(self.owner);self.assertEqual(self.board(manage="1").data["count"],1)
        self.assertEqual(self.board().data["count"],0)

    def test_student_cannot_use_manager_feed(self):
        self.login(self.student);self.assertEqual(self.board(manage="1").status_code,404)

    def test_owner_and_manager_can_post(self):
        for user in [self.owner,self.manager]:
            self.login(user)
            response=self.client.post(reverse("event-announcements-create",args=[self.event.pk]),{
                "title":"Schedule","body":"Meet in Lab","request_key":str(uuid.uuid4())},format="json")
            self.assertEqual(response.status_code,201,response.data)

    def test_limited_staff_cannot_publish_or_answer(self):
        announcement=self.announcement();question=self.question()
        for user in [self.volunteer,self.coordinator,self.student]:
            self.login(user)
            self.assertEqual(self.client.post(reverse("event-announcement-change",args=[self.event.pk,announcement.pk]),{"action":"publish","revision":1},format="json").status_code,404)
            self.assertEqual(self.client.post(reverse("event-question-change",args=[self.event.pk,question.pk]),{"action":"answer","revision":1,"answer":"Yes"},format="json").status_code,404)

    def test_removed_manager_loses_access_immediately(self):
        self.login(self.manager)
        EventStaffMembership.objects.filter(event=self.event,user=self.manager).update(is_active=False)
        self.assertEqual(self.board(manage="1").status_code,404)

    def test_manager_cannot_manage_another_event(self):
        self.login(self.manager);self.assertEqual(self.board(self.other_event,manage="1").status_code,404)

    def test_owner_without_organizer_group_cannot_manage(self):
        self.owner.groups.clear();self.login(self.owner)
        self.assertEqual(self.board(manage="1").status_code,404)

    def test_inactive_account_cannot_write(self):
        self.login(self.student);self.student.is_active=False;self.student.save()
        response=self.client.post(reverse("event-question-create",args=[self.event.pk]),{"body":"Question","request_key":str(uuid.uuid4())},format="json")
        self.assertIn(response.status_code,[401,403])

    def test_unregistered_student_can_ask(self):
        self.login(self.student)
        response=self.client.post(reverse("event-question-create",args=[self.event.pk]),{"body":"Can I join?","request_key":str(uuid.uuid4())},format="json")
        self.assertEqual(response.status_code,201,response.data)

    def test_spoofed_author_and_blank_body_rejected(self):
        self.login(self.student)
        for body in [{"body":"Question","author":self.owner.pk},{"body":"   "}]:
            response=self.client.post(reverse("event-question-create",args=[self.event.pk]),{**body,"request_key":str(uuid.uuid4())},format="json")
            self.assertEqual(response.status_code,400)

    def test_question_idempotency_and_changed_request_conflict(self):
        payload={"body":"Question","request_key":uuid.uuid4()}
        first,created=create_question(self.student,self.event.pk,payload)
        second,repeated=create_question(self.student,self.event.pk,payload)
        self.assertTrue(created);self.assertFalse(repeated);self.assertEqual(first.pk,second.pk)
        with self.assertRaises(Conflict):create_question(self.student,self.event.pk,{**payload,"body":"Changed"})

    def test_announcement_idempotency(self):
        payload={"title":"Schedule","body":"Body","stage":"general","pinned":False,"request_key":uuid.uuid4()}
        first,_=create_announcement(self.owner,self.event.pk,payload)
        second,created=create_announcement(self.owner,self.event.pk,payload)
        self.assertEqual(first.pk,second.pk);self.assertFalse(created)
        with self.assertRaises(Conflict):create_announcement(self.owner,self.event.pk,{**payload,"body":"Changed"})

    def test_publish_retry_only_enqueues_once(self):
        item=self.announcement();self.publish(item);self.publish(item)
        self.assertEqual(NotificationEvent.objects.filter(kind="event_announcement").count(),1)

    def test_draft_event_cannot_release_announcement(self):
        item=self.announcement();self.event.status="draft";self.event.save()
        from rest_framework.exceptions import ValidationError
        with self.assertRaises(ValidationError):self.publish(item)

    def test_answer_has_revision_and_notifies_question_author(self):
        question=self.question()
        updated=change_question(self.manager,self.event.pk,question.pk,{"action":"answer","answer":"Yes, please.","revision":1})
        self.assertEqual(updated.revision,2)
        intent=NotificationEvent.objects.get(kind="event_answer")
        self.assertEqual(intent.recipient_id,self.student.pk)
        with self.assertRaises(Conflict):change_question(self.owner,self.event.pk,question.pk,{"action":"answer","answer":"Changed","revision":1})

    def test_student_cannot_edit_another_question(self):
        question=self.question();self.login(self.other)
        self.assertEqual(self.client.post(reverse("event-question-change",args=[self.event.pk,question.pk]),{"action":"edit","revision":1,"body":"Changed"},format="json").status_code,404)

    def test_cross_event_object_is_rejected(self):
        question=self.question();self.login(self.owner)
        self.assertEqual(self.client.post(reverse("event-question-change",args=[self.other_event.pk,question.pk]),{"action":"answer","revision":1,"answer":"Yes"},format="json").status_code,404)

    def test_answered_question_cannot_be_rewritten_by_author(self):
        question=self.question();change_question(self.owner,self.event.pk,question.pk,{"action":"answer","answer":"Yes","revision":1})
        self.login(self.student)
        self.assertEqual(self.client.post(reverse("event-question-change",args=[self.event.pk,question.pk]),{"action":"edit","revision":2,"body":"Different question"},format="json").status_code,400)

    def test_hide_requires_reason_and_private_audit_is_retained(self):
        question=self.question();self.login(self.manager)
        url=reverse("event-question-change",args=[self.event.pk,question.pk])
        self.assertEqual(self.client.post(url,{"action":"hide","revision":1},format="json").status_code,400)
        self.assertEqual(self.client.post(url,{"action":"hide","revision":1,"reason":"Personal contact details"},format="json").status_code,200)
        self.client.logout();self.assertEqual(self.board(tab="questions").data["count"],0)
        self.assertEqual(CommunicationHistory.objects.get(resource="question",object_id=question.pk,revision=2).reason,"Personal contact details")

    def test_student_can_withdraw_own_question(self):
        question=self.question();change_question(self.student,self.event.pk,question.pk,{"action":"withdraw","revision":1})
        self.assertEqual(self.board(tab="questions").data["count"],0)
        self.assertTrue(Question.objects.filter(pk=question.pk).exists())

    def test_public_question_response_has_no_identity_or_audit(self):
        self.question();response=self.board(tab="questions")
        text=str(response.data)
        self.assertNotIn(self.student.username,text);self.assertNotIn(self.student.email,text)
        self.assertNotIn("author",response.data["results"][0]);self.assertNotIn("reason",text)

    def test_cancelled_events_remain_readable_but_questions_closed(self):
        question=self.question();self.event.status="cancelled";self.event.save()
        self.login(self.student)
        self.assertEqual(self.board(tab="questions").data["count"],1)
        self.assertFalse(self.board().data["can_ask"])
        self.assertEqual(self.client.post(reverse("event-question-create",args=[self.event.pk]),{"body":"New","request_key":str(uuid.uuid4())},format="json").status_code,400)
        change_question(self.owner,self.event.pk,question.pk,{"action":"answer","answer":"Contact the team","revision":1})

    def test_post_event_questions_still_work(self):
        self.event.start_datetime=timezone.now()-timedelta(days=2);self.event.end_datetime=timezone.now()-timedelta(days=1)
        self.event.registration_deadline=self.event.start_datetime;self.event.save()
        self.assertIsNotNone(self.question().pk)

    def test_rate_limit_is_per_account_and_event(self):
        self.login(self.student)
        for index in range(10):create_question(self.student,self.event.pk,{"body":f"Question {index}","request_key":uuid.uuid4()})
        response=self.client.post(reverse("event-question-create",args=[self.event.pk]),{"body":"One more","request_key":str(uuid.uuid4())},format="json")
        self.assertEqual(response.status_code,429)

    def test_pagination_search_and_unanswered_filter(self):
        Question.objects.bulk_create([Question(event=self.event,author=self.student,body=f"Topic {index}",request_hash="x") for index in range(18)])
        response=self.board(tab="questions");self.assertEqual(len(response.data["results"]),15);self.assertIsNotNone(response.data["next"])
        self.assertEqual(self.board(tab="questions",search="Topic 17").data["count"],1)
        question=Question.objects.first();change_question(self.owner,self.event.pk,question.pk,{"action":"answer","answer":"Yes","revision":1})
        self.assertEqual(self.board(tab="questions",unanswered="1").data["count"],17)

    def test_csrf_is_required(self):
        client=APIClient(enforce_csrf_checks=True);client.force_login(self.student)
        self.assertEqual(client.post(reverse("event-question-create",args=[self.event.pk]),{"body":"Question","request_key":str(uuid.uuid4())},format="json").status_code,403)

    def test_write_and_notification_roll_back_together(self):
        with patch("event_communication.services.record",side_effect=RuntimeError("outbox unavailable")):
            with self.assertRaises(RuntimeError):self.question()
        self.assertFalse(Question.objects.exists());self.assertFalse(CommunicationHistory.objects.exists())

    def test_published_announcement_reaches_registered_students_only(self):
        Registration.objects.create(event=self.event,student=self.student)
        Registration.objects.create(event=self.event,student=self.other,status="cancelled")
        self.publish(self.announcement());self.drain()
        self.assertTrue(Notification.objects.filter(user=self.student,kind="event_announcement").exists())
        self.assertFalse(Notification.objects.filter(user=self.other).exists())

    def test_withdrawn_announcement_is_not_delivered_from_queue(self):
        Registration.objects.create(event=self.event,student=self.student)
        item=self.publish(self.announcement())
        change_announcement(self.owner,self.event.pk,item.pk,{"action":"withdraw","reason":"Correction","revision":item.revision})
        self.drain();self.assertFalse(Notification.objects.filter(kind="event_announcement").exists())

    def test_hidden_answer_is_not_delivered_from_queue(self):
        question=self.question();item=change_question(self.owner,self.event.pk,question.pk,{"action":"answer","answer":"Yes","revision":1})
        change_question(self.manager,self.event.pk,item.pk,{"action":"hide","revision":item.revision,"reason":"Private information"})
        self.drain();self.assertFalse(Notification.objects.filter(kind="event_answer").exists())

    def test_registration_and_management_are_rechecked_for_delivery(self):
        registration=Registration.objects.create(event=self.event,student=self.student)
        item=self.publish(self.announcement());intent=NotificationEvent.objects.get(kind="event_announcement")
        intent.recipient=self.student
        self.assertTrue(notification_is_current(intent))
        registration.status="cancelled";registration.save();self.assertFalse(notification_is_current(intent))
        self.question();intent=NotificationEvent.objects.get(kind="event_question")
        self.owner.groups.clear();self.assertFalse(notification_is_current(intent))

    def test_editing_published_announcement_does_not_broadcast_again(self):
        item=self.publish(self.announcement())
        change_announcement(self.manager,self.event.pk,item.pk,{"action":"edit","revision":item.revision,"title":"Updated","body":"Corrected","stage":"during","pinned":True})
        self.assertEqual(NotificationEvent.objects.filter(kind="event_announcement").count(),1)
        self.assertEqual(self.board().data["results"][0]["body"],"Corrected")


# SQLite cannot verify row-locking behaviour; run these on local PostgreSQL.
import threading
from concurrent.futures import ThreadPoolExecutor
from django.db import close_old_connections
from django.test import TransactionTestCase, skipUnlessDBFeature


class CommunicationConcurrencyTests(TransactionTestCase):
    setUp = CommunicationTests.setUp
    new_event = CommunicationTests.new_event
    question = CommunicationTests.question

    def parallel(self, callback):
        barrier = threading.Barrier(2)
        def call():
            close_old_connections()
            try:
                barrier.wait(timeout=10)
                return callback()
            finally:
                close_old_connections()
        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(call) for _ in range(2)]
            return [future.result(timeout=20) for future in futures]

    @skipUnlessDBFeature("has_select_for_update")
    def test_two_retried_posts_create_one_question(self):
        payload={"body":"One question","request_key":uuid.uuid4()}
        results=self.parallel(lambda: create_question(self.student,self.event.pk,payload)[0].pk)
        self.assertEqual(results[0],results[1])
        self.assertEqual(Question.objects.count(),1)
        self.assertEqual(NotificationEvent.objects.filter(kind="event_question").count(),1)

    @skipUnlessDBFeature("has_select_for_update")
    def test_two_answers_cannot_silently_overwrite(self):
        item=self.question()
        def answer():
            try:
                change_question(self.manager,self.event.pk,item.pk,{"action":"answer","revision":1,"answer":"Official answer"})
                return "saved"
            except Conflict:
                return "conflict"
        self.assertCountEqual(self.parallel(answer),["saved","conflict"])
        self.assertEqual(NotificationEvent.objects.filter(kind="event_answer").count(),1)
