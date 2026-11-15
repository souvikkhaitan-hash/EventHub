import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";

import { getOrganizerEvents } from "../services/events";

import "../styles/organizer-v2.css";
import EventArtwork from "../components/EventArtwork";

const categoryLabels = {
  technical: "Tech & Build",
  cultural: "Culture & Art",
  workshop: "Workshop",
  seminar: "Seminar",
  sports: "Sports",
};

const categoryIcons = {
  technical: "⌘",
  cultural: "✳",
  workshop: "↗",
  seminar: "◎",
  sports: "◉",
};

function formatDate(value) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(date);
}

function formatTime(value) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  }).format(date);
}

export default function OrganizerDashboard() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    let active = true;

    async function loadEvents() {
      try {
        const data = await getOrganizerEvents();

        if (active) {
          setEvents(data);
        }
      } catch (err) {
        if (active) {
          setError(err.message);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadEvents();

    return () => {
      active = false;
    };
  }, []);

  const totalEvents = events.length;

  const publishedEvents = events.filter(
    (event) => event.status === "published"
  ).length;

  const draftEvents = events.filter(
    (event) => event.status === "draft"
  ).length;

  const totalRegistrations = events.reduce(
    (total, event) =>
      total + Number(event.registered_count || 0),
    0
  );

  const filteredEvents = useMemo(() => {
    const query = search.trim().toLowerCase();

    return events.filter((event) => {
      const matchesStatus =
        filter === "all" || event.status === filter;

      const searchable = [
        event.title,
        event.venue,
        event.category,
      ]
        .join(" ")
        .toLowerCase();

      return (
        matchesStatus &&
        (!query || searchable.includes(query))
      );
    });
  }, [events, filter, search]);

  return (
    <div className="organizer-dashboard organizer-v2">

      {/* ==========================================
          WELCOME HERO
      ========================================== */}

      <section className="org-welcome">

        <div className="org-welcome-content">

          <span className="org-eyebrow">
            ✳ YOUR ORGANIZER WORKSPACE
          </span>

          <h1>
            Make it
            <br />
            <span>unforgettable.</span>
          </h1>

          <p>
            Big ideas deserve great events.
            Create experiences, bring students together,
            and make every campus moment count.
          </p>

          <div className="org-welcome-actions">

            <Link
              to="/organizer/events/new"
              className="org-button-primary"
            >
              + Create an Event
              <span>↗</span>
            </Link>

            <Link
              to="/organizer/analytics"
              className="org-button-outline"
            >
              View Analytics →
            </Link>

          </div>
        </div>

        <div
          className="org-welcome-art"
          aria-hidden="true"
        >
          <div className="org-art-back">
            <span>EVENTHUB / 26</span>
            <strong>CREATE<br />CONNECT<br />CELEBRATE.</strong>
          </div>

          <div className="org-art-front">
            <div className="org-art-top">
              <span>THE ORGANIZER EDITION</span>
              <span>001 ↗</span>
            </div>

            <strong>
              YOUR
              <br />
              EVENT.
              <br />
              YOUR
              <br />
              IMPACT.
            </strong>

            <div className="org-art-bottom">
              <span>MAKE IT HAPPEN.</span>
              <span>✳</span>
            </div>
          </div>

          <div className="org-art-sticker">
            SHOW
            <br />
            UP.
            <br />
            STAND
            <br />
            OUT.
          </div>
        </div>

      </section>

      {/* ==========================================
          SECTION HEADING
      ========================================== */}

      <div className="org-section-title">

        <div>
          <span className="org-eyebrow">
            01 / THE BIG PICTURE
          </span>

          <h2>
            Your campus.
            <br />
            <span>Your impact.</span>
          </h2>
        </div>

        <p>
          A quick look at everything happening
          across your events.
        </p>

      </div>

      {/* ==========================================
          STATISTICS
      ========================================== */}

      <section
        className="org-stats-grid"
        aria-label="Organizer statistics"
      >

        <article className="org-stat-card">

          <div className="org-stat-top">
            <span>TOTAL EVENTS</span>
            <span className="org-stat-icon">✳</span>
          </div>

          <strong>
            {loading ? "—" : totalEvents}
          </strong>

          <p>Experiences you've created</p>

        </article>

        <article className="org-stat-card org-stat-blue">

          <div className="org-stat-top">
            <span>LIVE EVENTS</span>
            <span className="org-stat-icon">↗</span>
          </div>

          <strong>
            {loading ? "—" : publishedEvents}
          </strong>

          <p>Published for students</p>

        </article>

        <article className="org-stat-card org-stat-lime">

          <div className="org-stat-top">
            <span>REGISTRATIONS</span>
            <span className="org-stat-icon">◎</span>
          </div>

          <strong>
            {loading ? "—" : totalRegistrations}
          </strong>

          <p>Students currently registered</p>

        </article>

        <article className="org-stat-card org-stat-lavender">

          <div className="org-stat-top">
            <span>DRAFT EVENTS</span>
            <span className="org-stat-icon">✎</span>
          </div>

          <strong>
            {loading ? "—" : draftEvents}
          </strong>

          <p>Ideas waiting to go live</p>

        </article>

      </section>

      {/* ==========================================
          EVENT MANAGEMENT
      ========================================== */}

      <section className="org-events-section">

        <div className="org-section-heading">

          <div>
            <span className="org-eyebrow">
              02 / EVENT MANAGEMENT
            </span>

            <h2>Your events.</h2>

            <p>
              Everything you're organizing, in one place.
            </p>
          </div>

          <Link
            to="/organizer/events/new"
            className="org-small-create"
          >
            + New Event
          </Link>

        </div>

        {/* Search and filters */}

        <div className="org-events-toolbar">

          <label className="org-search">
            <span className="org-visually-hidden">
              Search your events
            </span>

            <span aria-hidden="true">⌕</span>

            <input
              type="search"
              placeholder="Search your events..."
              value={search}
              onChange={(event) =>
                setSearch(event.target.value)
              }
            />
          </label>

          <div
            className="org-filter-group"
            role="group"
            aria-label="Filter events by status"
          >

            {[
              ["all", "All Events"],
              ["published", "Published"],
              ["draft", "Drafts"],
              ["cancelled", "Cancelled"],
            ].map(([value, label]) => (

              <button
                key={value}
                type="button"
                className={
                  filter === value ? "active" : ""
                }
                onClick={() => setFilter(value)}
                aria-pressed={filter === value}
              >
                {label}
              </button>

            ))}

          </div>

        </div>

        {loading && (
          <div className="org-state-message" role="status">
            Loading your events...
          </div>
        )}

        {error && (
          <div
            className="organizer-error"
            role="alert"
          >
            {error}
          </div>
        )}

        {!loading &&
          !error &&
          filteredEvents.length === 0 && (

          <div className="org-empty">

            <span>✳</span>

            <h3>
              {events.length === 0
                ? "Your next big event starts here."
                : "No matching events."}
            </h3>

            <p>
              {events.length === 0
                ? "Create your first event and bring your campus community together."
                : "Try changing the search or status filter."}
            </p>

            {events.length === 0 ? (
              <Link
                to="/organizer/events/new"
                className="org-button-primary"
              >
                Create Your First Event ↗
              </Link>
            ) : (
              <button
                type="button"
                className="org-button-outline"
                onClick={() => {
                  setSearch("");
                  setFilter("all");
                }}
              >
                Clear Filters
              </button>
            )}

          </div>

        )}

        {!loading &&
          !error &&
          filteredEvents.length > 0 && (

          <div className="org-event-grid">

            {filteredEvents.map((event) => {

              const count = Number(
                event.registered_count || 0
              );

              const capacity = Number(
                event.capacity || 0
              );

              const percentage =
                capacity > 0
                  ? Math.min(
                      100,
                      (count / capacity) * 100
                    )
                  : 0;

              return (

                <article
                  className="org-event-card"
                  key={event.id}
                >

                  {/* Event artwork */}

                  <div
                    className={`org-event-art org-category-${event.category}`}
                  >

                    <div className="org-event-art-top">
                      <span>EVENTHUB / CAMPUS</span>
                      <span>↗</span>
                    </div>

                    <div className="org-event-art-center">
                      <EventArtwork category={event.category} />
                    </div>

                    <div className="org-event-art-bottom">
                      <span>
                        {categoryLabels[event.category] ||
                          event.category}
                      </span>

                      <span>SHOW UP.</span>
                    </div>

                  </div>

                  {/* Event information */}

                  <div className="org-event-content">

                    <div className="org-event-meta">

                      <span>
                        {categoryLabels[event.category] ||
                          event.category}
                      </span>

                      <span
                        className={`org-status org-status-${event.status}`}
                      >
                        {event.status}
                      </span>

                    </div>

                    <h3>{event.title}</h3>

                    <div className="org-event-details">

                      <p>
                        ◷ {formatDate(event.start_datetime)}
                        {" · "}
                        {formatTime(event.start_datetime)}
                      </p>

                      <p>⌖ {event.venue}</p>

                    </div>

                    <div className="org-event-capacity">

                      <div>
                        <span>REGISTRATIONS</span>

                        <strong>
                          {count} / {capacity}
                        </strong>
                      </div>

                      <div className="org-progress-track">
                        <div
                          style={{
                            width: `${percentage}%`,
                          }}
                        />
                      </div>

                    </div>

                    <div className="org-event-card-actions">

                      <Link
                        to={`/organizer/events/${event.id}/edit`}
                        className="org-card-main-action"
                      >
                        {event.status === "cancelled"
                          ? "View Event"
                          : "Manage Event"}
                        <span>↗</span>
                      </Link>

                      <Link
                        to={`/organizer/events/${event.id}/participants`}
                        className="org-card-secondary-action"
                      >
                        Participants →
                      </Link>

                    </div>

                  </div>

                </article>

              );
            })}

          </div>

        )}

      </section>

      {/* ==========================================
          QUICK ACCESS
      ========================================== */}

      <section className="org-quick-section">

        <div className="org-section-heading">

          <div>
            <span className="org-eyebrow">
              03 / YOUR TOOLKIT
            </span>

            <h2>Everything you need.</h2>
          </div>

        </div>

        <div className="org-quick-grid">

          <Link
            to="/organizer/events/new"
            className="org-quick-card"
          >
            <span className="org-quick-symbol">＋</span>
            <h3>Create an event</h3>
            <p>
              Turn your next campus idea into reality.
            </p>
            <strong>Get started ↗</strong>
          </Link>

          <Link
            to="/organizer/analytics"
            className="org-quick-card"
          >
            <span className="org-quick-symbol">▥</span>
            <h3>Explore analytics</h3>
            <p>
              See registrations, attendance and growth.
            </p>
            <strong>View insights ↗</strong>
          </Link>

          <Link
            to="/events"
            className="org-quick-card"
          >
            <span className="org-quick-symbol">✳</span>
            <h3>Explore campus</h3>
            <p>
              Discover the experiences students can join.
            </p>
            <strong>Explore events ↗</strong>
          </Link>

        </div>

      </section>

    </div>
  );
}