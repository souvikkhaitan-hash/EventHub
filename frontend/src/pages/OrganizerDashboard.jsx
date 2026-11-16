import {
  useEffect,
  useMemo,
  useState,
} from "react";

import { Link } from "react-router";

import EventCover from "../components/EventCover";

import {
  getOrganizerEvents,
} from "../services/events";

import {
  formatEventDateTime,
  getCategoryLabel,
} from "../utils/eventFormat";

import "../styles/organizer-overview.css";

function number(value) {
  return (
    value != null &&
    value !== "" &&
    Number.isFinite(Number(value))
  )
    ? Math.max(0, Number(value))
    : null;
}

function messageFrom(error) {
  return (
    error?.details?.message ||
    error?.details?.detail ||
    error?.message ||
    "Unable to load your events."
  );
}

function OrganizerEventCard({ event, index }) {
  const registered = number(
    event.registered_count
  );

  const capacity = number(event.capacity);

  const available =
    number(event.available_seats) ??
    (
      capacity !== null && registered !== null
        ? Math.max(0, capacity - registered)
        : null
    );

  const occupancy =
    capacity > 0 && registered !== null
      ? (registered / capacity) * 100
      : null;

  const statusLabel = {
    published: "Published",
    draft: "Draft",
    cancelled: "Cancelled",
  }[event.status] || event.status;

  return (
    <article
      className="ov-event-card"
      style={{
        "--ov-index": Math.min(index, 6),
      }}
    >
      <div className="ov-cover">
        <EventCover
          category={event.category}
          showLabel
        />
      </div>

      <div className="ov-event-copy">
        <div className="ov-event-meta">
          <span>
            {getCategoryLabel(event.category)}
          </span>

          <span
            className={`ov-status ov-status--${event.status}`}
          >
            {statusLabel}
          </span>
        </div>

        <h3>{event.title}</h3>

        <p className="ov-detail">
          <span aria-hidden="true">◷</span>

          {formatEventDateTime(
            event.start_datetime
          )}
        </p>

        <p className="ov-detail">
          <span aria-hidden="true">⌖</span>

          {event.venue || "Venue to be announced"}
        </p>

        <div className="ov-capacity">
          <div>
            <span>
              <strong>
                {registered ?? "—"}
              </strong>

              {capacity !== null &&
                ` of ${capacity}`}

              {" "}registrations
            </span>

            <span>
              {occupancy !== null
                ? `${occupancy.toFixed(1)}% occupancy`
                : "Capacity unavailable"}
            </span>
          </div>

          {capacity > 0 &&
            registered !== null && (
              <progress
                value={Math.min(
                  capacity,
                  registered
                )}
                max={capacity}
                aria-label={`Reserved seats for ${event.title}`}
              />
            )}

          <small>
            {event.status === "cancelled"
              ? "Event cancelled"
              : event.status === "draft"
                ? capacity !== null
                  ? `${capacity} seats configured`
                  : "Set capacity before publishing"
                : available !== null
                  ? `${available} seats available`
                  : "Seat availability unavailable"}
          </small>
        </div>

        <div className="ov-card-actions">
          <Link
            className="ov-button"
            to={`/organizer/events/${event.id}/edit`}
          >
            {event.status === "cancelled"
              ? "View event"
              : "Manage event"}

            <span aria-hidden="true">↗</span>
          </Link>

          <Link
            className="ov-participants"
            to={`/organizer/events/${event.id}/participants`}
          >
            Participants →
          </Link>
        </div>
      </div>
    </article>
  );
}

export default function OrganizerDashboard() {
  const [revision, setRevision] = useState(0);

  const [result, setResult] = useState({
    revision: -1,
    events: [],
    error: "",
  });

  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");

  const loading =
    result.revision !== revision;

  const events = result.events;

  useEffect(() => {
    let active = true;

    getOrganizerEvents()
      .then((data) => {
        if (!Array.isArray(data)) {
          throw new Error(
            "The server returned an unexpected event list."
          );
        }

        if (active) {
          setResult({
            revision,
            events: data,
            error: "",
          });
        }
      })
      .catch((error) => {
        if (active) {
          setResult({
            revision,
            events: [],
            error: messageFrom(error),
          });
        }
      });

    return () => {
      active = false;
    };
  }, [revision]);

  const statistics = useMemo(
    () => ({
      total: events.length,

      published: events.filter(
        (event) => event.status === "published"
      ).length,

      drafts: events.filter(
        (event) => event.status === "draft"
      ).length,

      registrations: events.some(
        (event) =>
          number(event.registered_count) === null
      )
        ? "—"
        : events.reduce(
            (total, event) =>
              total +
              number(event.registered_count),
            0
          ),
    }),
    [events]
  );

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();

    return events.filter((event) => {
      const matchesStatus =
        filter === "all" ||
        event.status === filter;

      const searchable = [
        event.title,
        event.venue,
        event.category,
        getCategoryLabel(event.category),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return (
        matchesStatus &&
        (!query || searchable.includes(query))
      );
    });
  }, [events, filter, search]);

  const hasFilters =
    search.trim() !== "" ||
    filter !== "all";

  function clearFilters() {
    setSearch("");
    setFilter("all");
  }

  return (
    <div className="ov-page">
      <header className="ov-heading">
        <div>
          <p className="ov-eyebrow">
            <span aria-hidden="true">▪</span>
            Your organiser workspace
          </p>

          <h1>
            Make it <span>unforgettable.</span>
          </h1>

          <p className="ov-intro">
            Your events, participants and campus
            plans, in one place.
          </p>
        </div>

        <div className="ov-heading-actions">
          <span
            className="ov-pass-tag"
            aria-hidden="true"
          >
            Campus
            <br />
            organiser ✳
          </span>

          <Link
            className="ov-button"
            to="/organizer/events/new"
          >
            ＋ Create an event
          </Link>

          <Link
            className="ov-button ov-button--outline"
            to="/organizer/analytics"
          >
            View analytics
          </Link>
        </div>
      </header>

      {!loading && !result.error && (
        <section
          className="ov-stats"
          aria-label="Organiser overview metrics"
        >
          {[
            [
              "Total events",
              statistics.total,
              "blue",
            ],
            [
              "Published",
              statistics.published,
              "blue",
            ],
            [
              "Active registrations",
              statistics.registrations,
              "lime",
            ],
            [
              "Drafts",
              statistics.drafts,
              "lavender",
            ],
          ].map(
            ([label, value, accent], index) => (
              <article
                className={`ov-stat ov-stat--${accent}`}
                key={label}
                style={{
                  "--ov-index": index,
                }}
              >
                <span>{label}</span>
                <strong>{value}</strong>
              </article>
            )
          )}
        </section>
      )}

      <section
        className="ov-events"
        aria-labelledby="ov-events-title"
        aria-busy={loading}
      >
        <div className="ov-section-heading">
          <div>
            <h2 id="ov-events-title">
              Your events.
            </h2>

            <p>
              Manage what you’re organising.

              {!loading &&
                !result.error &&
                ` ${events.length} ${
                  events.length === 1
                    ? "event"
                    : "events"
                }.`}
            </p>
          </div>
        </div>

        <div className="ov-toolbar">
          <label className="ov-search">
            <span className="ov-sr-only">
              Search your events
            </span>

            <span aria-hidden="true">⌕</span>

            <input
              type="search"
              value={search}
              onChange={(event) =>
                setSearch(event.target.value)
              }
              placeholder="Search your events…"
            />
          </label>

          <div
            className="ov-filters"
            role="group"
            aria-label="Filter events by status"
          >
            {[
              ["all", "All events"],
              ["published", "Published"],
              ["draft", "Drafts"],
              ["cancelled", "Cancelled"],
            ].map(([value, label]) => (
              <button
                type="button"
                key={value}
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div
            className="ov-message"
            role="status"
          >
            Loading your events…
          </div>
        ) : result.error ? (
          <div
            className="ov-message"
            role="alert"
          >
            <h3>Unable to load your events.</h3>

            <p>{result.error}</p>

            <button
              className="ov-button"
              type="button"
              onClick={() =>
                setRevision((value) => value + 1)
              }
            >
              Try again
            </button>
          </div>
        ) : !visible.length ? (
          <div className="ov-message">
            <h3>
              {events.length
                ? "No matching events."
                : "Your next event starts here."}
            </h3>

            <p>
              {events.length
                ? "Try a different search or status filter."
                : "Create your first event and bring your campus community together."}
            </p>

            {events.length ? (
              <button
                className="ov-button ov-button--outline"
                type="button"
                onClick={clearFilters}
              >
                Clear filters
              </button>
            ) : (
              <Link
                className="ov-button"
                to="/organizer/events/new"
              >
                Create your first event →
              </Link>
            )}
          </div>
        ) : (
          <>
            <div className="ov-event-list">
              {visible.map((event, index) => (
                <OrganizerEventCard
                  key={event.id}
                  event={event}
                  index={index}
                />
              ))}
            </div>

            <div className="ov-list-note">
              {hasFilters ? (
                <>
                  <span>
                    {visible.length} matching{" "}
                    {visible.length === 1
                      ? "event"
                      : "events"}
                  </span>

                  <button
                    type="button"
                    onClick={clearFilters}
                  >
                    Clear filters
                  </button>
                </>
              ) : (
                <p>
                  New events will appear here
                  as you create them.
                </p>
              )}
            </div>
          </>
        )}
      </section>

      <section
        className="ov-quick-links"
        aria-labelledby="ov-quick-title"
      >
        <h2 id="ov-quick-title">
          Quick links.
        </h2>

        <div>
          {[
            [
              "/organizer/events/new",
              "＋",
              "Create an event",
              "Turn an idea into your next campus event.",
            ],
            [
              "/organizer/analytics",
              "▥",
              "Analytics",
              "Registrations, attendance and growth.",
            ],
            [
              "/events",
              "✳",
              "Explore campus",
              "See what students can discover.",
            ],
          ].map(([path, icon, title, text]) => (
            <Link
              to={path}
              className="ov-quick-link"
              key={path}
            >
              <span
                className="ov-quick-icon"
                aria-hidden="true"
              >
                {icon}
              </span>

              <span>
                <strong>{title}</strong>
                <small>{text}</small>
              </span>

              <span
                className="ov-quick-arrow"
                aria-hidden="true"
              >
                →
              </span>
            </Link>
          ))}
        </div>
      </section>

      <footer className="ov-footer">
        Show up. Stand out.
      </footer>
    </div>
  );
}