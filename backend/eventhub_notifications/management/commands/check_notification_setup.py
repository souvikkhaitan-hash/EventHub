from django.core.management.base import BaseCommand
from eventhub_notifications.providers import config,push_ready,whatsapp_ready


class Command(BaseCommand):
    help="Show notification provider readiness without printing secret values."

    def handle(self,*args,**options):
        self.stdout.write("Website inbox: enabled through the eventhub_notifications app and worker.")
        self.stdout.write("Device push configured: "+str(push_ready()))
        self.stdout.write("WhatsApp configured: "+str(whatsapp_ready()))
        templates=config().get("WHATSAPP_TEMPLATES",{})
        for kind in ["registration_confirmed","event_changed","event_cancelled","event_reminder"]:
            self.stdout.write(kind+" template configured: "+str(bool(templates.get(kind))))
        self.stdout.write("Provider acceptance, template approval and live delivery must still be tested.")
