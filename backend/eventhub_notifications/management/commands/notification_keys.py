import base64
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help="Generate VAPID keys locally. Keep the private key out of Git and chat."

    def handle(self,*args,**options):
        key=ec.generate_private_key(ec.SECP256R1())
        public=key.public_key().public_bytes(serialization.Encoding.X962,serialization.PublicFormat.UncompressedPoint)
        private=key.private_bytes(serialization.Encoding.DER,serialization.PrivateFormat.PKCS8,serialization.NoEncryption())
        encode=lambda value:base64.urlsafe_b64encode(value).decode().rstrip("=")
        self.stdout.write("VAPID_PUBLIC_KEY="+encode(public))
        self.stdout.write("VAPID_PRIVATE_KEY="+encode(private))
