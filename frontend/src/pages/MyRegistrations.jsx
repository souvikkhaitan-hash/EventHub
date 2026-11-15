import { useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router";

import Navbar from "../components/Navbar";
import EventArtworkIcon from "../components/EventArtworkIcon";

import { useAuth } from "../context/AuthContext";

import {
  getMyRegistrations,
  cancelRegistration,
} from "../services/events";

import {
  formatEventDateTime,
  getCategoryLabel,
} from "../utils/eventFormat";

import "../styles/registrations.css";

// ============================================================
// EVENTHUB 2.0 — MY REGISTRATIONS
// ============================================================

function getEventState(registration) {
  if (registration.status === "cancelled") {
    return "cancelled";
  }

  if (
    new Date(registration.event_start).getTime() <= Date.now()
  ) {
    return "past";
  }

  return "upcoming";
}

function getErrorMessage(error) {
  return (
    error?.details?.message ||
    error?.details?.detail ||
    error?.message ||
    "Something went wrong."
  );
}

// ============================================================
// MAIN COMPONENT
// ============================================================

export default function MyRegistrations() {
  const { user, loading: authLoading } = useAuth();

  const [registrations, setRegistrations] = useState([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [cancellingId, setCancellingId] = useState(null);

  const [activeFilter, setActiveFilter] = useState("all");

  const [now, setNow] = useState(Date.now());

  // ==========================================================
  // KEEP EVENT STATUS UPDATED
  // ==========================================================

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 60000);

    return () => window.clearInterval(timer);
  }, []);

  // ==========================================================
  // LOAD REGISTRATIONS
  // ==========================================================

  useEffect(() => {
    if (authLoading) return;

    if (!user || user.is_organizer) {
      setLoading(false);
      return;
    }

    let active = true;

    async function loadRegistrations() {
      setLoading(true);
      setError("");

      try {
        const response = await getMyRegistrations();

        if (active) {
          setRegistrations(
            Array.isArray(response) ? response : []
          );
        }
      } catch (err) {
        if (active) {
          setError(getErrorMessage(err));
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadRegistrations();

    return () => {
      active = false;
    };
  }, [user, authLoading]);

  // ==========================================================
  // CANCELLATION
  // ==========================================================

  async function handleCancel(registration) {
    if (cancellingId !== null) return;

    const confirmed = window.confirm(
      `Are you sure you want to cancel your registration for "${registration.event_title}"?`
    );

    if (!confirmed) return;

    setCancellingId(registration.id);

    setError("");
    setMessage("");

    try {
      await cancelRegistration(registration.id);

      setRegistrations((previous) =>
        previous.map((item) =>
          item.id === registration.id
            ? {
                ...item,
                status: "cancelled",
                cancelled_at: new Date().toISOString(),
              }
            : item
        )
      );

      setMessage(
        `Your registration for "${registration.event_title}" was cancelled successfully.`
      );
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setCancellingId(null);
    }
  }

  // ==========================================================
  // STATISTICS
  // ==========================================================

  const statistics = useMemo(() => {
    const active = registrations.filter(
      (item) => item.status === "registered"
    );

    const upcoming = active.filter(
      (item) =>
        new Date(item.event_start).getTime() > now
    );

    const past = active.filter(
      (item) =>
        new Date(item.event_start).getTime() <= now
    );

    const cancelled = registrations.filter(
      (item) => item.status === "cancelled"
    );

    return {
      active: active.length,
      upcoming: upcoming.length,
      past: past.length,
      cancelled: cancelled.length,
    };
  }, [registrations, now]);

  // ==========================================================
  // FILTER AND SORT
  // ==========================================================

  const filteredRegistrations = useMemo(() => {
    const filtered = registrations.filter((item) => {
      const state =
        item.status === "cancelled"
          ? "cancelled"
          : new Date(item.event_start).getTime() <= now
            ? "past"
            : "upcoming";

      return (
        activeFilter === "all" ||
        activeFilter === state
      );
    });

    return [...filtered].sort((a, b) => {
      const dateA = new Date(a.event_start).getTime();
      const dateB = new Date(b.event_start).getTime();

      return dateA - dateB;
    });
  }, [registrations, activeFilter, now]);

  // ==========================================================
  // ROLE PROTECTION
  // ==========================================================

  if (!authLoading && !user) {
    return <Navigate to="/login" replace />;
  }

  if (!authLoading && user?.is_organizer) {
    return <Navigate to="/organizer" replace />;
  }

  // ==========================================================
  // PAGE
  // ==========================================================

  return (
    <>
      <Navbar />

      <main className="registrations-page registrations-v2">

        {/* Decorative background */}

        <div
          className="registrations-background-art"
          aria-hidden="true"
        />

        <div className="container">

          {/* ================================================
              HEADING
          ================================================ */}

          <header className="registrations-heading registrations-v2-heading">

            <div className="registrations-heading-copy">

              <span className="registrations-eyebrow">
                <span className="registrations-eyebrow-dot" />
                YOUR CAMPUS EXPERIENCES
              </span>

              <h1>
                Your events.
                <br />
                <span>Your moments.</span>
              </h1>

              <p>
                Every event you've signed up for,
                every experience waiting to happen.
                It's all right here.
              </p>

            </div>

            <div
              className="registrations-heading-art"
              aria-hidden="true"
            >
              <div className="registrations-heading-circle">
                <span>✳</span>
              </div>

              <span className="registrations-heading-art-text">
                SHOW UP.
                <br />
                STAND OUT.
              </span>
            </div>

          </header>

          {/* ================================================
              SUMMARY CARDS
          ================================================ */}

          {!loading && !error && (
            <section
              className="registrations-v2-stats"
              aria-label="Registration statistics"
            >

              <article className="registrations-v2-stat registrations-v2-stat-primary">

                <div>
                  <span>ACTIVE REGISTRATIONS</span>
                  <strong>{statistics.active}</strong>
                </div>

                <span
                  className="registrations-stat-decoration"
                  aria-hidden="true"
                >
                  ✳
                </span>

                <p>Your reserved campus experiences</p>

              </article>

              <article className="registrations-v2-stat">

                <div>
                  <span>UPCOMING EVENTS</span>
                  <strong>{statistics.upcoming}</strong>
                </div>

                <p>Experiences still ahead</p>

              </article>

              <article className="registrations-v2-stat registrations-v2-stat-lavender">

                <div>
                  <span>STARTED / PAST</span>
                  <strong>{statistics.past}</strong>
                </div>

                <p>Registered events already started</p>

              </article>

            </section>
          )}

          {/* ================================================
              FEEDBACK
          ================================================ */}

          {message && (
            <div
              className="registration-success"
              role="status"
            >
              ✓ {message}
            </div>
          )}

          {error && (
            <div
              className="registration-error"
              role="alert"
            >
              {error}
            </div>
          )}

          {/* ================================================
              SECTION HEADER AND FILTERS
          ================================================ */}

          <section className="registrations-v2-section">

            <div className="registrations-v2-section-heading">

              <div>
                <span className="registrations-eyebrow">
                  YOUR EVENT COLLECTION
                </span>

                <h2>My experiences<span>.</span></h2>
              </div>

              {!loading && (
                <Link
                  to="/events"
                  className="registrations-explore-link"
                >
                  Explore more events ↗
                </Link>
              )}

            </div>

            {!loading && !error && (
              <div
                className="registrations-v2-filters"
                role="group"
                aria-label="Filter registrations"
              >

                {[
                  {
                    value: "all",
                    label: "All events",
                    count: registrations.length,
                  },
                  {
                    value: "upcoming",
                    label: "Upcoming",
                    count: statistics.upcoming,
                  },
                  {
                    value: "past",
                    label: "Started / Past",
                    count: statistics.past,
                  },
                  {
                    value: "cancelled",
                    label: "Cancelled",
                    count: statistics.cancelled,
                  },
                ].map((filter) => (
                  <button
                    key={filter.value}
                    type="button"
                    className={
                      activeFilter === filter.value
                        ? "registrations-filter-active"
                        : ""
                    }
                    onClick={() =>
                      setActiveFilter(filter.value)
                    }
                    aria-pressed={
                      activeFilter === filter.value
                    }
                  >
                    {filter.label}

                    <span>{filter.count}</span>
                  </button>
                ))}

              </div>
            )}

            {/* LOADING */}

            {(loading || authLoading) && (
              <div
                className="registrations-v2-loading"
                role="status"
              >
                <span className="registrations-loading-icon">
                  ✳
                </span>

                Loading your campus experiences...
              </div>
            )}

            {/* NO REGISTRATIONS */}

            {!loading &&
              !error &&
              registrations.length === 0 && (

                <div className="registrations-empty">

                  <span>✳</span>

                  <h2>
                    Your next experience is waiting.
                  </h2>

                  <p>
                    You haven't registered for an event yet.
                    Find something exciting happening
                    around campus.
                  </p>

                  <Link to="/events">
                    Discover Events ↗
                  </Link>

                </div>
              )}

            {/* FILTER EMPTY STATE */}

            {!loading &&
              !error &&
              registrations.length > 0 &&
              filteredRegistrations.length === 0 && (

                <div className="registrations-empty">

                  <span>✳</span>

                  <h2>No events in this category.</h2>

                  <p>
                    Try another filter to see
                    your registrations.
                  </p>

                  <button
                    type="button"
                    className="registrations-clear-filter"
                    onClick={() =>
                      setActiveFilter("all")
                    }
                  >
                    Show all registrations →
                  </button>

                </div>
              )}

            {/* ================================================
                REGISTRATION CARDS
            ================================================ */}

            {!loading &&
              filteredRegistrations.length > 0 && (

                <div className="registrations-list registrations-v2-list">

                  {filteredRegistrations.map(
                    (registration, index) => {

                      const state =
                        getEventState(registration);

                      const isCancelled =
                        state === "cancelled";

                      const isPast =
                        state === "past";

                      const isUpcoming =
                        state === "upcoming";

                      return (
                        <article
                          className={`registration-card registration-v2-card ${
                            isCancelled
                              ? "registration-v2-cancelled"
                              : ""
                          }`}
                          key={registration.id}
                          style={{
                            "--registration-index":
                              Math.min(index, 8),
                          }}
                        >

                          {/* EVENT ARTWORK */}

                          <div
                            className={`registration-v2-artwork event-category-${registration.event_category}`}
                            aria-hidden="true"
                          >

                            <span className="registration-v2-art-label">
                              EVENTHUB / CAMPUS
                            </span>

                            <EventArtworkIcon
                              event={{
                                title:
                                  registration.event_title,
                                category:
                                  registration.event_category,
                              }}
                            />

                            <span className="registration-v2-art-bottom">
                              SHOW UP.
                            </span>

                          </div>

                          {/* EVENT INFORMATION */}

                          <div className="registration-v2-content">

                            <span className="registration-category">
                              {getCategoryLabel(
                                registration.event_category
                              )}
                            </span>

                            <h3>
                              {registration.event_title}
                            </h3>

                            <div className="registration-v2-event-details">

                              <div>
                                <span aria-hidden="true">◷</span>

                                {formatEventDateTime(
                                  registration.event_start
                                )}
                              </div>

                              <div>
                                <span aria-hidden="true">⌖</span>

                                {registration.event_venue}
                              </div>

                            </div>

                            <div className="registration-v2-event-state">

                              {isUpcoming && (
                                <span className="registration-v2-upcoming-label">
                                  ✦ Coming up
                                </span>
                              )}

                              {isPast && (
                                <span className="registration-v2-past-label">
                                  Event started or passed
                                </span>
                              )}

                              {isCancelled && (
                                <span className="registration-v2-cancelled-label">
                                  Registration cancelled
                                </span>
                              )}

                            </div>

                          </div>

                          {/* ACTIONS */}

                          <div className="registration-card-actions registration-v2-actions">

                            <span
                              className={
                                isCancelled
                                  ? "registration-status cancelled"
                                  : "registration-status registered"
                              }
                            >
                              {isCancelled
                                ? "Cancelled"
                                : "Registered"}
                            </span>

                            {!isCancelled && (
                              <Link
                                to={`/my-registrations/${registration.id}/ticket`}
                                className="registration-ticket-link"
                              >
                                View Ticket
                                <span aria-hidden="true">
                                  ↗
                                </span>
                              </Link>
                            )}

                            <Link
                              to={`/events/${registration.event}`}
                              className="registration-v2-event-link"
                            >
                              View event →
                            </Link>

                            {!isCancelled && !isPast && (
                              <button
                                type="button"
                                className="registration-v2-cancel-button"
                                onClick={() =>
                                  handleCancel(registration)
                                }
                                disabled={
                                  cancellingId !== null
                                }
                              >
                                {cancellingId ===
                                registration.id
                                  ? "Cancelling..."
                                  : "Cancel registration"}
                              </button>
                            )}

                          </div>

                        </article>
                      );
                    }
                  )}

                </div>
              )}

          </section>

        </div>
      </main>
    </>
  );
}