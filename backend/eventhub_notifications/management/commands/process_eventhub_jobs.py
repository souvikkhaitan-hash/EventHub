import time
from django.core.management.base import BaseCommand, CommandError
from django.db import close_old_connections, connection
from certificates.workflow_services import process_workflow_step
from eventhub_notifications.services import process_delivery_step, process_event_step, schedule_reminders
from eventhub_notifications.webhook import process_receipt_step


class Command(BaseCommand):
    help="Process EventHub certificate runs and notification outboxes."

    def add_arguments(self,parser):
        parser.add_argument("--watch",action="store_true")
        parser.add_argument("--skip-external",action="store_true",help="Create website notifications without sending push/WhatsApp.")
        parser.add_argument("--notifications-only",action="store_true",help="Optional extra worker for notifications only.")

    def handle(self,*args,**options):
        if connection.vendor!="postgresql":raise CommandError("The job worker requires PostgreSQL.")
        self.stdout.write("EventHub worker started. Committed progress is retained when stopped.")
        reminder_check=0
        try:
            while True:
                close_old_connections()
                if time.monotonic()-reminder_check>60:
                    schedule_reminders();reminder_check=time.monotonic()
                pdf_work=False if options["notifications_only"] else process_workflow_step()
                inbox_work=False
                for _ in range(100):
                    if not process_event_step():break
                    inbox_work=True
                receipt_work=process_receipt_step()
                # PDF work and website inboxes take priority over slow providers.
                delivered=False if pdf_work or options["skip_external"] else process_delivery_step()
                if delivered:time.sleep(0.5)
                if not any([pdf_work,inbox_work,receipt_work,delivered]):
                    if not options["watch"]:break
                    time.sleep(2)
        except KeyboardInterrupt:self.stdout.write("Worker stopped; saved jobs remain available.")
        finally:close_old_connections()
