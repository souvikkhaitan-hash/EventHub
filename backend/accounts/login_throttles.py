from django.conf import settings
from django.core.cache import caches
from django.utils.crypto import salted_hmac

from rest_framework.throttling import SimpleRateThrottle


class LoginThrottle(SimpleRateThrottle):
    """
    Resolve the shared cache when handling each request.
    """

    @property
    def cache(self):
        return caches["account_security"]

    def make_key(self, identifier):
        return self.cache_format % {
            "scope": self.scope,
            "ident": identifier,
        }


class LoginIPThrottle(LoginThrottle):
    scope = "account_login_ip"

    def get_rate(self):
        return getattr(
            settings,
            "ACCOUNT_LOGIN_IP_RATE",
            "120/min",
        )

    def get_cache_key(self, request, view):
        return self.make_key(
            self.get_ident(request)
        )


class LoginUsernameThrottle(LoginThrottle):
    scope = "account_login_username"

    def get_rate(self):
        return getattr(
            settings,
            "ACCOUNT_LOGIN_USERNAME_RATE",
            "10/min",
        )

    def get_cache_key(self, request, view):
        if not isinstance(request.data, dict):
            return None

        username = request.data.get(
            "username", ""
        )

        if not isinstance(username, str):
            return None

        username = username.strip().casefold()

        if not username:
            return None

        identifier = salted_hmac(
            "eventhub.login.username",
            username,
        ).hexdigest()

        return self.make_key(identifier)