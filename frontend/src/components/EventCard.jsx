import { Link } from "react-router";

import {
  formatEventDate,
  formatEventTime,
  getCategoryLabel,
} from "../utils/eventFormat";
import EventCover from "./EventCover";

// ============================================================
// EVENT CARD HELPERS
// ============================================================

function getEventStatus(event) {
  const now = new Date();

  const deadline = new Date(
    event.registration_deadline
  );

  const start = new Date(
    event.start_datetime
  );

  const availableSeats =
    event.available_seats == null
      ? null
      : Number(event.available_seats);

  if (event.status === "cancelled") {
    return {
      label: "Cancelled",
      type: "closed",
    };
  }

  if (now >= start) {
    return {
      label: "Started",
      type: "closed",
    };
  }

  if (now >= deadline) {
    return {
      label: "Registration Closed",
      type: "closed",
    };
  }

  if (
    availableSeats !== null &&
    availableSeats <= 0
  ) {
    return {
      label: "Event Full",
      type: "full",
    };
  }

  const hoursUntilDeadline =
    (deadline - now) / (1000 * 60 * 60);

  if (hoursUntilDeadline <= 48) {
    return {
      label: "Closing Soon",
      type: "closing",
    };
  }

  return {
    label: "Registration Open",
    type: "upcoming",
  };
}


// ============================================================
// EVENT CATEGORY SYMBOLS
// ============================================================

const categorySymbols = {
  technical: "{ }",
  cultural: "✳",
  workshop: "↗",
  seminar: "◎",
  sports: "◉",
};


// ============================================================
// EVENT CARD
// ============================================================

export default function EventCard({
  event,
  index = 0,
}) {
  const status = getEventStatus(event);

  const availableSeats =
    event.available_seats == null
      ? null
      : Math.max(0, Number(event.available_seats));

  const capacity = Number(event.capacity) || 0;

  const registeredCount =
    event.registered_count == null
      ? null
      : Number(event.registered_count);

  const occupancy =
    capacity > 0 &&
    registeredCount !== null
      ? Math.min(
          100,
          Math.max(
            0,
            (registeredCount / capacity) * 100
          )
        )
      : null;

  return (
    <article
      className={`event-discovery-card event-category-${event.category}`}
      style={{
        "--event-index": Math.min(index, 8),
      }}
    >

      {/* ====================================================
          EVENT POSTER
      ==================================================== */}

      <div className="event-card-artwork campus-cover">
  <EventCover
    category={event.category}
    showLabel
  />
</div>

      {/* ====================================================
          EVENT INFORMATION
      ==================================================== */}

      <div className="event-card-body">

        {/* CATEGORY AND STATUS */}

        <div className="event-card-meta">

          <span className="event-card-category">
            {getCategoryLabel(event.category)}
          </span>

          <span
            className={`event-card-status event-card-status-${status.type}`}
          >
            {status.label}
          </span>

        </div>

        {/* TITLE */}

        <h3>
          <Link
            to={`/events/${event.id}`}
            className="event-card-title-link"
          >
            {event.title}
          </Link>
        </h3>

        {/* DESCRIPTION */}

        <p className="event-card-description">
          {event.description}
        </p>

        {/* EVENT DETAILS */}

        <div className="event-card-details">

          {/* DATE */}

          <div>
            <span
              className="event-card-detail-icon"
              aria-hidden="true"
            >
              ◷
            </span>

            <span>
              {formatEventDate(
                event.start_datetime
              )}
              {" · "}
              {formatEventTime(
                event.start_datetime
              )}
            </span>
          </div>

          {/* VENUE */}

          <div>
            <span
              className="event-card-detail-icon"
              aria-hidden="true"
            >
              ⌖
            </span>

            <span>{event.venue}</span>
          </div>

          {/* REGISTRATION DEADLINE */}

          <div>
            <span
              className="event-card-detail-icon"
              aria-hidden="true"
            >
              ◴
            </span>

            <span>
              Register by{" "}
              {formatEventDate(
                event.registration_deadline
              )}
              {" · "}
              {formatEventTime(
                event.registration_deadline
              )}
            </span>
          </div>

        </div>

        {/* =================================================
            SEAT AVAILABILITY
        ================================================= */}

        {availableSeats !== null && (
          <div className="event-card-availability">

            <div className="event-card-seats-heading">

              <span>
                AVAILABLE SEATS
              </span>

              <strong>
                {availableSeats}
                <span> / {capacity}</span>
              </strong>

            </div>

            {occupancy !== null && (
              <div
                className="event-card-seat-track"
                role="progressbar"
                aria-label={`Seats reserved for ${event.title}`}
                aria-valuemin={0}
                aria-valuemax={capacity}
                aria-valuenow={Math.min(
                  capacity,
                  Math.max(0, registeredCount)
                )}
              >
                <div
                  className="event-card-seat-fill"
                  style={{
                    width: `${occupancy}%`,
                  }}
                />
              </div>
            )}

            <p className="event-card-seat-note">
              {status.type === "closed"
                ? "Registration is closed"
                : availableSeats === 0
                ? "All seats are reserved"
                : `${availableSeats} places still available`}
            </p>

          </div>
        )}

        {/* =================================================
            FOOTER
        ================================================= */}

        <div className="event-card-footer">

          <span>
            By {event.organizer_name}
          </span>

          <Link
            to={`/events/${event.id}`}
            className="event-card-link"
            aria-label={`View details for ${event.title}`}
          >
            View event
            <span aria-hidden="true">↗</span>
          </Link>

        </div>

      </div>

    </article>
  );
}