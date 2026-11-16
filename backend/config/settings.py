import os
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


def env_bool(name, default=False):
    return os.getenv(name, str(default)).strip().lower() in {
        "1", "true", "yes", "on"
    }


def env_list(name, default=""):
    return [
        value.strip()
        for value in os.getenv(name, default).split(",")
        if value.strip()
    ]


# ============================================================
# ENVIRONMENT AND SECURITY
# ============================================================

ON_RENDER = env_bool("RENDER")

DEBUG = env_bool("DJANGO_DEBUG", not ON_RENDER)

SECRET_KEY = os.getenv("DJANGO_SECRET_KEY", "")

if not SECRET_KEY:
    if not DEBUG:
        raise ImproperlyConfigured(
            "Set DJANGO_SECRET_KEY in the server environment."
        )

    SECRET_KEY = (
        "eventhub-local-development-only-never-use-in-production"
    )

if ON_RENDER and DEBUG:
    raise ImproperlyConfigured(
        "DJANGO_DEBUG must be False on Render."
    )

ALLOWED_HOSTS = env_list(
    "DJANGO_ALLOWED_HOSTS",
    "localhost,127.0.0.1" if DEBUG else "",
)

render_host = os.getenv("RENDER_EXTERNAL_HOSTNAME")

if render_host:
    ALLOWED_HOSTS.append(render_host)


# ============================================================
# APPLICATIONS
# ============================================================

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "corsheaders",
    "events",
    "accounts",
    "certificates",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"


# ============================================================
# POSTGRESQL
# ============================================================

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.environ["DB_NAME"],
        "USER": os.environ["DB_USER"],
        "PASSWORD": os.environ["DB_PASSWORD"],
        "HOST": os.environ["DB_HOST"],
        "PORT": os.getenv("DB_PORT", "5432"),
        "CONN_MAX_AGE": 0,
        "DISABLE_SERVER_SIDE_CURSORS": True,
        "OPTIONS": {
            "sslmode": os.getenv(
                "DB_SSLMODE",
                "prefer" if DEBUG else "require",
            ),
            "connect_timeout": 10,
        },
    }
}


# ============================================================
# PASSWORD VALIDATION
# ============================================================

AUTH_PASSWORD_VALIDATORS = [
    {
        "NAME": (
            "django.contrib.auth.password_validation."
            "UserAttributeSimilarityValidator"
        ),
    },
    {
        "NAME": (
            "django.contrib.auth.password_validation."
            "MinimumLengthValidator"
        ),
    },
    {
        "NAME": (
            "django.contrib.auth.password_validation."
            "CommonPasswordValidator"
        ),
    },
    {
        "NAME": (
            "django.contrib.auth.password_validation."
            "NumericPasswordValidator"
        ),
    },
]


# ============================================================
# FRONTEND, CORS AND CSRF
# ============================================================

CORS_ALLOWED_ORIGINS = env_list(
    "FRONTEND_ORIGINS",
    (
        "http://localhost:5173,http://127.0.0.1:5173"
        if DEBUG
        else ""
    ),
)

CSRF_TRUSTED_ORIGINS = list(
    dict.fromkeys(
        CORS_ALLOWED_ORIGINS
        + env_list("DJANGO_CSRF_TRUSTED_ORIGINS")
    )
)

CORS_ALLOW_CREDENTIALS = True

SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SECURE = not DEBUG
SESSION_COOKIE_SAMESITE = "Lax"

CSRF_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_HTTPONLY = False

SECURE_SSL_REDIRECT = not DEBUG

if ON_RENDER:
    SECURE_PROXY_SSL_HEADER = (
        "HTTP_X_FORWARDED_PROTO",
        "https",
    )

SECURE_HSTS_SECONDS = 3600 if not DEBUG else 0
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "same-origin"


# ============================================================
# INTERNATIONALIZATION
# ============================================================

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"

USE_I18N = True
USE_TZ = True


# ============================================================
# STATIC FILES
# ============================================================

STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

STORAGES = {
    "default": {
        "BACKEND": "django.core.files.storage.FileSystemStorage",
    },
    "staticfiles": {
        "BACKEND": (
            "whitenoise.storage."
            "CompressedManifestStaticFilesStorage"
        ),
    },
}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"


# ============================================================
# INTERNAL ANALYTICS
# ============================================================

ANALYTICS_SERVICE_URL = os.getenv(
    "ANALYTICS_SERVICE_URL",
    "http://127.0.0.1:8001",
)

ANALYTICS_INTERNAL_KEY = os.getenv(
    "ANALYTICS_INTERNAL_KEY",
    "",
)

if ON_RENDER and not ANALYTICS_INTERNAL_KEY:
    raise ImproperlyConfigured(
        "Set ANALYTICS_INTERNAL_KEY on Render."
    )


# ============================================================
# PRIVATE CERTIFICATE STORAGE
# ============================================================

CERTIFICATE_STORAGE_ROOT = (
    BASE_DIR / "private_media" / "certificates"
)

CERTIFICATE_STORAGE_BACKEND = os.getenv(
    "CERTIFICATE_STORAGE_BACKEND",
    "s3" if ON_RENDER else "local",
)

if CERTIFICATE_STORAGE_BACKEND not in {"local", "s3"}:
    raise ImproperlyConfigured(
        "CERTIFICATE_STORAGE_BACKEND must be local or s3."
    )

if ON_RENDER and CERTIFICATE_STORAGE_BACKEND != "s3":
    raise ImproperlyConfigured(
        "Render requires persistent s3 certificate storage."
    )

CERTIFICATE_S3_OPTIONS = {}

if CERTIFICATE_STORAGE_BACKEND == "s3":
    from botocore.config import Config

    required = [
        "S3_ENDPOINT_URL",
        "S3_ACCESS_KEY_ID",
        "S3_SECRET_ACCESS_KEY",
        "S3_BUCKET_NAME",
        "S3_REGION_NAME",
    ]

    missing = [
        name
        for name in required
        if not os.getenv(name)
    ]

    if missing:
        raise ImproperlyConfigured(
            "Missing storage settings: "
            + ", ".join(missing)
        )

    CERTIFICATE_S3_OPTIONS = {
        "endpoint_url": os.environ["S3_ENDPOINT_URL"],
        "access_key": os.environ["S3_ACCESS_KEY_ID"],
        "secret_key": os.environ["S3_SECRET_ACCESS_KEY"],
        "bucket_name": os.environ["S3_BUCKET_NAME"],
        "region_name": os.environ["S3_REGION_NAME"],
        "default_acl": None,
        "file_overwrite": False,
        "querystring_auth": True,
        "max_memory_size": 5 * 1024 * 1024,
        "client_config": Config(
            signature_version="s3v4",
            s3={
                "addressing_style": "path",
            },
            request_checksum_calculation="when_required",
            response_checksum_validation="when_required",
        ),
    }