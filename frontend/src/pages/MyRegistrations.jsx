import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Link, Navigate } from "react-router";

import Navbar from "../components/Navbar";
import EventCover from "../components/EventCover";
import StudentCertificates from "../components/StudentCertificates";

import { useAuth } from "../context/AuthContext";

import {
  getMyRegistrations,
  cancelRegistration,
} from "../services/events";

import {
  formatEventDateTime,
  getCategoryLabel,
} from "../utils/eventFormat";

import "../styles/my-registrations-editorial.css";

function eventState(item, now) {
  if (item.status === "cancelled") {
    return "cancelled";
  }

  const start = Date.parse(item.event_start);

  if (!Number.isFinite(start)) {
    return "unknown";
  }

  return start <= now ? "past" : "upcoming";
}

function messageFrom(error) {
  return (
    error?.details?.message ||
    error?.details?.detail ||
    error?.message ||
    "Please try again."
  );
}

// Reveal a section once when it enters the viewport.
function Reveal({ children, className = "" }) {
  const node = useRef(null);

  useEffect(() => {
    const element = node.current;

    if (
      !element ||
      !window.IntersectionObserver ||
      window.matchMedia?.(
        "(prefers-reduced-motion: reduce)"
      ).matches
    ) {
      return;
    }

    element.classList.add("mr-waiting");

    const observer = new IntersectionObserver(
      (entries) => {
        if (
          entries.some((entry) => entry.isIntersecting)
        ) {
          element.classList.remove("mr-waiting");
          observer.disconnect();
        }
      },
      { threshold: 0.06 }
    );

    observer.observe(element);

    return () => {
      observer.disconnect();
      element.classList.remove("mr-waiting");
    };
  }, []);

  return (
    <div
      className={`mr-reveal ${className}`}
      ref={node}
    >
      {children}
    </div>
  );
}

export default function MyRegistrations() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <>
        <Navbar />

        <main className="mr-page">
          <p role="status">
            Loading your account…
          </p>
        </main>
      </>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (user.is_organizer) {
    return <Navigate to="/organizer" replace />;
  }

  return (
    <>
      <Navbar />

      <RegistrationWorkspace
        key={user.id ?? user.username}
      />
    </>
  );
}

function RegistrationWorkspace() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");

  const [revision, setRevision] = useState(0);
  const [filter, setFilter] = useState("all");

  const [cancelling, setCancelling] = useState(null);

  const [now, setNow] = useState(
    () => Date.now()
  );

  const alive = useRef(false);
  const busy = useRef(false);

  useEffect(() => {
    alive.current = true;

    const timer = setInterval(() => {
      setNow(Date.now());
    }, 30000);

    return () => {
      alive.current = false;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let active = true;

    setLoading(true);
    setError("");

    getMyRegistrations()
      .then((data) => {
        if (!Array.isArray(data)) {
          throw new Error(
            "Unable to read your registrations."
          );
        }

        if (active) {
          setItems(data);
        }
      })
      .catch((error) => {
        if (active) {
          setError(messageFrom(error));
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [revision]);

  const statistics = useMemo(
    () => ({
      active: items.filter(
        (item) => item.status === "registered"
      ).length,

      upcoming: items.filter(
        (item) =>
          item.status === "registered" &&
          eventState(item, now) === "upcoming"
      ).length,

      past: items.filter(
        (item) =>
          item.status === "registered" &&
          eventState(item, now) === "past"
      ).length,

      cancelled: items.filter(
        (item) => item.status === "cancelled"
      ).length,
    }),
    [items, now]
  );

  const visible = useMemo(
    () =>
      items
        .filter(
          (item) =>
            filter === "all" ||
            eventState(item, now) === filter
        )
        .sort(
          (a, b) =>
            (Date.parse(a.event_start) || 0) -
            (Date.parse(b.event_start) || 0)
        ),
    [items, filter, now]
  );

  async function cancel(item) {
    if (
      busy.current ||
      item.status !== "registered" ||
      eventState(item, Date.now()) !== "upcoming"
    ) {
      return;
    }

    const confirmed = window.confirm(
      `Cancel your registration for "${item.event_title}"?`
    );

    if (!confirmed) return;

    busy.current = true;

    setCancelling(item.id);
    setActionError("");
    setNotice("");

    try {
      await cancelRegistration(item.id);

      if (!alive.current) return;

      setItems((previous) =>
        previous.map((row) =>
          row.id === item.id
            ? {
                ...row,
                status: "cancelled",
              }
            : row
        )
      );

      setNotice(
        `Your registration for "${item.event_title}" was cancelled.`
      );
    } catch (error) {
      if (alive.current) {
        setActionError(messageFrom(error));
      }
    } finally {
      busy.current = false;

      if (alive.current) {
        setCancelling(null);
      }
    }
  }

  return (
    <main className="mr-page">
      <div className="mr-shell">
        <header className="mr-heading">
          <div>
            <p className="mr-eyebrow">
              Your campus plans
            </p>

            <h1>
              Your events.
              <br />
              <span>Your moments.</span>
            </h1>

            <p>
              Your tickets, campus plans and
              certificates, together.
            </p>
          </div>

          <Link
            className="mr-button mr-button--outline"
            to="/events"
          >
            Explore more events
            <span aria-hidden="true">→</span>
          </Link>
        </header>

        {!loading && !error && (
          <dl className="mr-statistics">
            <div>
              <dt>Active registrations</dt>
              <dd>{statistics.active}</dd>
            </div>

            <div>
              <dt>Upcoming</dt>
              <dd>{statistics.upcoming}</dd>
            </div>

            <div>
              <dt>Started / past</dt>
              <dd>{statistics.past}</dd>
            </div>
          </dl>
        )}

        {notice && (
          <p className="mr-notice" role="status">
            {notice}
          </p>
        )}

        {actionError && (
          <p className="mr-error" role="alert">
            {actionError}
          </p>
        )}

        <section
          className="mr-experiences"
          aria-labelledby="mr-experiences-title"
          aria-busy={loading}
        >
          <div className="mr-section-heading">
            <h2 id="mr-experiences-title">
              My experiences.
            </h2>

            {!loading && !error && (
              <span>
                {items.length}{" "}
                {items.length === 1
                  ? "registration"
                  : "registrations"}
              </span>
            )}
          </div>

          {!loading && !error && (
            <div
              className="mr-filters"
              role="group"
              aria-label="Filter registrations"
            >
              {[
                [
                  "all",
                  "All events",
                  items.length,
                ],
                [
                  "upcoming",
                  "Upcoming",
                  statistics.upcoming,
                ],
                [
                  "past",
                  "Started / Past",
                  statistics.past,
                ],
                [
                  "cancelled",
                  "Cancelled",
                  statistics.cancelled,
                ],
              ].map(([value, label, total]) => (
                <button
                  type="button"
                  key={value}
                  aria-pressed={filter === value}
                  onClick={() => setFilter(value)}
                >
                  {label}
                  <span>{total}</span>
                </button>
              ))}
            </div>
          )}

          {loading ? (
            <div className="mr-empty" role="status">
              Loading your campus experiences…
            </div>
          ) : error ? (
            <div className="mr-empty" role="alert">
              <h3>
                We couldn’t load your registrations.
              </h3>

              <p>{error}</p>

              <button
                className="mr-button"
                onClick={() =>
                  setRevision((value) => value + 1)
                }
              >
                Try again
              </button>
            </div>
          ) : !visible.length ? (
            <div className="mr-empty">
              <h3>
                {items.length
                  ? "No events in this category."
                  : "Your next experience is waiting."}
              </h3>

              <p>
                {items.length
                  ? "Try another filter to see your registrations."
                  : "Explore campus events and find something you want to be part of."}
              </p>

              {items.length ? (
                <button
                  className="mr-button"
                  onClick={() => setFilter("all")}
                >
                  Show all registrations →
                </button>
              ) : (
                <Link
                  className="mr-button"
                  to="/events"
                >
                  Discover events →
                </Link>
              )}
            </div>
          ) : (
            <div className="mr-list">
              {visible.map((item, index) => {
                const state = eventState(item, now);

                const active =
                  item.status === "registered";

                return (
                  <article
                    className={`mr-card ${
                      state === "cancelled"
                        ? "mr-card--cancelled"
                        : ""
                    }`}
                    key={item.id}
                    style={{
                      "--mr-index": Math.min(index, 6),
                    }}
                  >
                    <div className="mr-cover">
                      <EventCover
                        category={item.event_category}
                        showLabel
                      />
                    </div>

                    <div className="mr-card-copy">
                      <p className="mr-category">
                        {getCategoryLabel(
                          item.event_category
                        )}
                      </p>

                      <h3>{item.event_title}</h3>

                      <p className="mr-detail">
                        <span aria-hidden="true">
                          ◷
                        </span>

                        {formatEventDateTime(
                          item.event_start
                        )}
                      </p>

                      <p className="mr-detail">
                        <span aria-hidden="true">
                          ⌖
                        </span>

                        {item.event_venue ||
                          "Venue to be announced"}
                      </p>

                      <span
                        className={`mr-lifecycle mr-lifecycle--${state}`}
                      >
                        {state === "upcoming"
                          ? "Coming up"
                          : state === "past"
                            ? "Started / past"
                            : state === "cancelled"
                              ? "Registration cancelled"
                              : "Date unavailable"}
                      </span>
                    </div>

                    <div className="mr-card-actions">
                      <span
                        className={`mr-registration-status ${
                          active
                            ? "is-registered"
                            : ""
                        }`}
                      >
                        {active
                          ? "Registered"
                          : item.status === "cancelled"
                            ? "Cancelled"
                            : item.status}
                      </span>

                      {active && (
                        <Link
                          className="mr-button"
                          to={`/my-registrations/${item.id}/ticket`}
                          aria-label={`View ticket for ${item.event_title}`}
                        >
                          View ticket ↗
                        </Link>
                      )}

                      <Link
                        className="mr-event-link"
                        to={`/events/${item.event}`}
                      >
                        View event →
                      </Link>

                      {active &&
                        state === "upcoming" && (
                          <button
                            type="button"
                            className="mr-cancel"
                            onClick={() => cancel(item)}
                            disabled={
                              cancelling !== null
                            }
                          >
                            {cancelling === item.id
                              ? "Cancelling…"
                              : "Cancel registration"}
                          </button>
                        )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <Reveal>
          <StudentCertificates />
        </Reveal>

        <footer className="mr-footer">
          <Link to="/">
            ← Back to EventHub
          </Link>

          <strong>
            Show up. Stand out.
          </strong>
        </footer>
      </div>
    </main>
  );
}