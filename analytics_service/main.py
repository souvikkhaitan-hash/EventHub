import os
import secrets

from collections import Counter
from pathlib import Path

import psycopg

from psycopg.rows import dict_row

from dotenv import load_dotenv

from fastapi import (
    FastAPI,
    Header,
    HTTPException,
)
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

# ============================================================
# LOAD ENVIRONMENT VARIABLES
# ============================================================

BASE_DIR = Path(__file__).resolve().parent

load_dotenv(BASE_DIR / ".env")


# ============================================================
# APPLICATION
# ============================================================

app = FastAPI(
    title="EventHub Analytics Service",
    version="1.0.0",
    description="Internal analytics service for EventHub.",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)


# ============================================================
# CONFIGURATION
# ============================================================

INTERNAL_KEY = os.getenv(
    "ANALYTICS_INTERNAL_KEY",
    ""
)

DB_CONFIG = {
    "dbname": os.getenv("ANALYTICS_DB_NAME"),
    "user": os.getenv("ANALYTICS_DB_USER"),
    "password": os.getenv("ANALYTICS_DB_PASSWORD"),
    "host": os.getenv("ANALYTICS_DB_HOST", "localhost"),
    "port": int(os.getenv("ANALYTICS_DB_PORT", "5432")),
    "connect_timeout": 5,
    "options": "-c default_transaction_read_only=on",
    "sslmode": os.getenv("ANALYTICS_DB_SSLMODE", "prefer"),
}


# ============================================================
# INTERNAL AUTHENTICATION
# ============================================================

def verify_internal_key(provided_key):

    if not INTERNAL_KEY or not provided_key:
        raise HTTPException(
            status_code=503,
            detail="Analytics authentication is not configured."
        )

    if not secrets.compare_digest(
        INTERNAL_KEY,
        provided_key
    ):
        raise HTTPException(
            status_code=403,
            detail="Analytics access denied."
        )


# ============================================================
# DATABASE CONNECTION
# ============================================================

def get_connection():

    return psycopg.connect(
        **DB_CONFIG,
        row_factory=dict_row
    )


# ============================================================
# HEALTH CHECK
# ============================================================

@app.get("/health")
def health():

    return {
        "service": "EventHub Analytics",
        "status": "running"
    }


# ============================================================
# ORGANIZER ANALYTICS
# ============================================================

@app.get("/internal/organizers/{organizer_id}/overview")
def organizer_overview(
    organizer_id: int,
    x_internal_key: str | None = Header(default=None),
):

    # Only requests carrying Django's internal
    # secret may retrieve analytics.
    verify_internal_key(x_internal_key)

    if organizer_id < 1:
        raise HTTPException(
            status_code=400,
            detail="Invalid organizer ID."
        )

    # ========================================================
    # QUERY EVENT PERFORMANCE
    # ========================================================

    query = """
        SELECT
            e.id,
            e.title,
            e.category,
            e.status,
            e.capacity,
            e.start_datetime,

            COUNT(r.id) FILTER (
                WHERE r.status = 'registered'
            ) AS registered_count,

            COUNT(r.id) FILTER (
                WHERE r.status = 'cancelled'
            ) AS cancelled_count,

            COUNT(r.id) FILTER (
                WHERE
                    r.status = 'registered'
                    AND t.checked_in_at IS NOT NULL
            ) AS checked_in_count

        FROM events_event e

        LEFT JOIN events_registration r
            ON r.event_id = e.id

        LEFT JOIN events_eventticket t
            ON t.registration_id = r.id

        WHERE e.organizer_id = %s

        GROUP BY
            e.id,
            e.title,
            e.category,
            e.status,
            e.capacity,
            e.start_datetime

        ORDER BY
            e.start_datetime DESC,
            e.id DESC
    """
    # ============================================================
    # REGISTRATION TRENDS — LAST 14 CALENDAR DAYS
    # ============================================================

    trend_query = """
        WITH days AS (
            SELECT generate_series(
                (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date
                    - INTERVAL '13 days',
                (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date,
                INTERVAL '1 day'
            )::date AS day
        ),
        registrations_by_day AS (
            SELECT
                (
                    r.registered_at AT TIME ZONE 'Asia/Kolkata'
                )::date AS day,

                COUNT(r.id) AS registration_count

            FROM events_registration r

            JOIN events_event e
                ON e.id = r.event_id

            WHERE e.organizer_id = %s

              AND r.status = 'registered'

              AND r.registered_at >= (
                  (
                      (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date
                      - INTERVAL '13 days'
                  ) AT TIME ZONE 'Asia/Kolkata'
              )

            GROUP BY
                (
                    r.registered_at AT TIME ZONE 'Asia/Kolkata'
                )::date
        )

        SELECT
            days.day,
            COALESCE(
                registrations_by_day.registration_count,
                0
            ) AS registrations

        FROM days

        LEFT JOIN registrations_by_day
            ON registrations_by_day.day = days.day

        ORDER BY days.day
    """

    try:
        with get_connection() as connection:

            with connection.cursor() as cursor:

                # Existing event analytics
                cursor.execute(
                    query,
                    (organizer_id,)
                )

                rows = cursor.fetchall()

                # New registration trends
                cursor.execute(
                    trend_query,
                    (organizer_id,)
                )

                trend_rows = cursor.fetchall()

    except psycopg.Error:
        raise HTTPException(
            status_code=503,
            detail="Analytics database is unavailable."
        )

    # ========================================================
    # CALCULATE EVENT-WISE ANALYTICS
    # ========================================================

    events = []

    total_registrations = 0
    total_attendance = 0

    total_capacity = 0

    category_counts = Counter()

    published_count = 0
    draft_count = 0
    cancelled_event_count = 0

    for row in rows:

        capacity = int(row["capacity"])

        registered = int(row["registered_count"])

        cancelled = int(row["cancelled_count"])

        checked_in = int(row["checked_in_count"])

        available_seats = max(
            0,
            capacity - registered
        )

        capacity_utilization = (
            round((registered / capacity) * 100, 1)
            if capacity > 0
            else 0
        )

        attendance_rate = (
            round((checked_in / registered) * 100, 1)
            if registered > 0
            else 0
        )

        events.append({
            "id": row["id"],
            "title": row["title"],
            "category": row["category"],
            "status": row["status"],
            "capacity": capacity,
            "start_datetime": row[
                "start_datetime"
            ].isoformat(),
            "registered": registered,
            "cancelled_registrations": cancelled,
            "checked_in": checked_in,
            "available_seats": available_seats,
            "capacity_utilization": capacity_utilization,
            "attendance_rate": attendance_rate,
        })

        total_registrations += registered

        total_attendance += checked_in

        total_capacity += capacity

        category_counts[row["category"]] += 1

        if row["status"] == "published":
            published_count += 1

        elif row["status"] == "draft":
            draft_count += 1

        elif row["status"] == "cancelled":
            cancelled_event_count += 1

    # ========================================================
    # OVERALL STATISTICS
    # ========================================================

    total_events = len(events)

    overall_attendance_rate = (
        round(
            (total_attendance / total_registrations) * 100,
            1
        )
        if total_registrations > 0
        else 0
    )

    overall_capacity_utilization = (
        round(
            (total_registrations / total_capacity) * 100,
            1
        )
        if total_capacity > 0
        else 0
    )
    
    # ========================================================
    # FORMAT REGISTRATION TRENDS
    # ========================================================

    registration_trends = [
        {
            "date": row["day"].isoformat(),
            "registrations": int(row["registrations"]),
        }
        for row in trend_rows
    ]

    # ========================================================
    # API RESPONSE
    # ========================================================

    return {
    "organizer_id": organizer_id,

    "summary": {
        "total_events": total_events,
        "published_events": published_count,
        "draft_events": draft_count,
        "cancelled_events": cancelled_event_count,

        "total_registrations": total_registrations,
        "total_checked_in": total_attendance,

        "attendance_rate": overall_attendance_rate,
        "capacity_utilization": overall_capacity_utilization,
    },

    # Registration trends (last 14 days)
    "registration_trends": registration_trends,

    "categories": [
        {
            "category": category,
            "events": count,
        }
        for category, count in sorted(
            category_counts.items()
        )
    ],

    "events": events,
}

# ============================================================
# FEATURE 5D — EVENT REGISTRATION GROWTH
# ============================================================

INDIA_TIMEZONE = ZoneInfo("Asia/Kolkata")


@app.get(
    "/internal/organizers/{organizer_id}/events/"
    "{event_id}/registration-growth"
)
def event_registration_growth(
    organizer_id: int,
    event_id: int,
    x_internal_key: str | None = Header(default=None),
):

    # --------------------------------------------------------
    # 1. VERIFY INTERNAL SERVICE AUTHENTICATION
    # --------------------------------------------------------

    verify_internal_key(x_internal_key)

    if organizer_id < 1 or event_id < 1:
        raise HTTPException(
            status_code=400,
            detail="Invalid organizer or event ID."
        )

    # --------------------------------------------------------
    # 2. RETRIEVE EVENT AND REGISTRATION DATA
    # --------------------------------------------------------

    event_query = """
        SELECT
            id,
            title,
            category,
            status,
            capacity,
            published_at,
            registration_deadline

        FROM events_event

        WHERE id = %s
          AND organizer_id = %s
    """

    registration_query = """
        SELECT
            registered_at

        FROM events_registration

        WHERE event_id = %s
          AND status = 'registered'

        ORDER BY registered_at
    """

    try:
        with get_connection() as connection:
            with connection.cursor() as cursor:

                cursor.execute(
                    event_query,
                    (event_id, organizer_id)
                )

                event = cursor.fetchone()

                if event is None:
                    raise HTTPException(
                        status_code=404,
                        detail="Event not found."
                    )

                cursor.execute(
                    registration_query,
                    (event_id,)
                )

                registrations = cursor.fetchall()

    except psycopg.Error:
        raise HTTPException(
            status_code=503,
            detail="Analytics database is unavailable."
        )

    # --------------------------------------------------------
    # 3. DETERMINE THE CHART START DATE
    # --------------------------------------------------------

    publication_date = event["published_at"]

    deadline = event["registration_deadline"]

    now = datetime.now(timezone.utc)

    # Newly published events have an exact publication date.
    if publication_date is not None:

        start_date = publication_date.astimezone(
            INDIA_TIMEZONE
        ).date()

        start_source = "publication_date"

    # Older events may not have a publication timestamp.
    # Use the earliest recorded active registration.
    elif registrations:

        start_date = registrations[0][
            "registered_at"
        ].astimezone(
            INDIA_TIMEZONE
        ).date()

        start_source = "first_recorded_registration"

    else:

        start_date = None

        start_source = "unavailable"

    # --------------------------------------------------------
    # 4. DETERMINE THE END DATE
    # --------------------------------------------------------

    deadline_date = deadline.astimezone(
        INDIA_TIMEZONE
    ).date()

    today = now.astimezone(
        INDIA_TIMEZONE
    ).date()

    # Do not show future days as recorded activity.
    end_date = min(
        deadline_date,
        today
    )

    # --------------------------------------------------------
    # 5. GROUP REGISTRATIONS BY DATE
    # --------------------------------------------------------

    registrations_by_day = {}

    for registration in registrations:

        registered_date = registration[
            "registered_at"
        ].astimezone(
            INDIA_TIMEZONE
        ).date()

        registrations_by_day[registered_date] = (
            registrations_by_day.get(
                registered_date,
                0
            ) + 1
        )

    # --------------------------------------------------------
    # 6. BUILD THE DAILY GROWTH SERIES
    # --------------------------------------------------------

    growth_data = []

    cumulative_registrations = 0

    if (
        start_date is not None
        and start_date <= end_date
    ):

        current_date = start_date

        while current_date <= end_date:

            daily_count = registrations_by_day.get(
                current_date,
                0
            )

            cumulative_registrations += daily_count

            growth_data.append({
                "date": current_date.isoformat(),
                "daily_registrations": daily_count,
                "cumulative_registrations":
                    cumulative_registrations,
            })

            current_date += timedelta(days=1)

    # --------------------------------------------------------
    # 7. CALCULATE EVENT STATISTICS
    # --------------------------------------------------------

    registered_count = len(registrations)

    capacity = int(event["capacity"])

    available_seats = max(
        0,
        capacity - registered_count
    )

    capacity_utilization = (
        round(
            (registered_count / capacity) * 100,
            1
        )
        if capacity > 0
        else 0
    )

    # --------------------------------------------------------
    # 8. RETURN ANALYTICS
    # --------------------------------------------------------

    return {
        "event": {
            "id": event["id"],
            "title": event["title"],
            "category": event["category"],
            "status": event["status"],
            "capacity": capacity,
        },

        "registration_period": {
            "published_at": (
                publication_date.isoformat()
                if publication_date
                else None
            ),

            "registration_deadline": (
                deadline.isoformat()
            ),

            "chart_start": (
                start_date.isoformat()
                if start_date
                else None
            ),

            "chart_end": (
                end_date.isoformat()
                if start_date and start_date <= end_date
                else None
            ),

            "start_source": start_source,
        },

        "summary": {
            "registered": registered_count,
            "available_seats": available_seats,
            "capacity_utilization":
                capacity_utilization,
        },

        "growth": growth_data,
    }