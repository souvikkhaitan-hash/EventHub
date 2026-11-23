import { useEffect, useRef, useState } from "react";
import {
  Link,
  useNavigate,
  useParams,
} from "react-router";

import Navbar from "../components/Navbar";
import EventCover from "../components/EventCover";
import TeamRegistrationPanel from "../components/TeamRegistrationPanel";

import { useAuth } from "../context/AuthContext";

import {
  getPublicEvent,
  getMyRegistrations,
  registerForEvent,
} from "../services/events";

import {
  formatEventDateTime,
  getCategoryLabel,
} from "../utils/eventFormat";

import "../styles/event-details-editorial.css";
import EventCommunication from "../components/EventCommunication";

// Convert a date into the UTC format used by calendar files.
function calendarDate(value) {
  return new Date(value)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

// Escape text that will be written into an .ics calendar file.
function calendarText(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function errorMessage(error) {
  return (
    error?.details?.message ||
    error?.details?.detail ||
    error?.message ||
    "Please try again."
  );
}

// Keep missing numbers separate from a genuine zero.
function count(value) {
  return (
    value != null &&
    value !== "" &&
    Number.isFinite(Number(value))
  )
    ? Math.max(0, Number(value))
    : null;
}

export default function EventDetails() {
  const { id } = useParams();
  const { user, loading } = useAuth();

  // A different event/account starts with fresh registration state.
  const pageKey = [
    id,
    user?.id ?? user?.username ?? "guest",
    Boolean(user?.is_organizer),
  ].join(":");

  return (
    <>
      <Navbar />

      <EventDetailsContent
        key={pageKey}
        id={id}
        user={user}
        authLoading={loading}
      />
    </>
  );
}

function EventDetailsContent({
  id,
  user,
  authLoading,
}) {
  const navigate = useNavigate();

  const page = useRef(null);
  const alive = useRef(false);
  const busy = useRef(false);

  const [event, setEvent] = useState(null);

  const [load, setLoad] = useState({
    loading: true,
    error: "",
    missing: false,
  });

  const [revision, setRevision] = useState(0);

  const [registration, setRegistration] = useState(null);

  const [check, setCheck] = useState({
    loading: true,
    error: "",
  });

  const [checkRevision, setCheckRevision] = useState(0);
  const [registering, setRegistering] = useState(false);
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");
  const [shareMessage, setShareMessage] = useState("");

  const [now, setNow] = useState(() => Date.now());

  // Update time-based availability without reloading the page.
  useEffect(() => {
    alive.current = true;

    const timer = setInterval(() => {
      setNow(Date.now());
    }, 15000);

    return () => {
      alive.current = false;
      clearInterval(timer);
    };
  }, []);

  // Load the selected public event.
  useEffect(() => {
    let active = true;

    setLoad({
      loading: true,
      error: "",
      missing: false,
    });

    getPublicEvent(id)
      .then((data) => {
        if (!active) return;

        setEvent(data);

        setLoad({
          loading: false,
          error: "",
          missing: false,
        });
      })
      .catch((error) => {
        if (!active) return;

        setLoad({
          loading: false,
          error: errorMessage(error),
          missing: error.status === 404,
        });
      });

    return () => {
      active = false;
    };
  }, [id, revision]);

  // Check individual registration only for student accounts.
  // TeamRegistrationPanel handles the team flow separately.
  useEffect(() => {
    let active = true;

    if (authLoading || !event) return;

    setRegistration(null);

    if (
      !user ||
      user.is_organizer ||
      event.registration_mode === "team"
    ) {
      setCheck({
        loading: false,
        error: "",
      });

      return;
    }

    setCheck({
      loading: true,
      error: "",
    });

    getMyRegistrations()
      .then((items) => {
        if (!Array.isArray(items)) {
          throw new Error(
            "Unable to check your registration."
          );
        }

        if (!active) return;

        const existing = items.find(
          (item) =>
            String(item.event) === String(event.id) &&
            item.status === "registered"
        );

        setRegistration(existing || null);

        setCheck({
          loading: false,
          error: "",
        });
      })
      .catch((error) => {
        if (!active) return;

        setCheck({
          loading: false,
          error: errorMessage(error),
        });
      });

    return () => {
      active = false;
    };
  }, [
    event?.id,
    event?.registration_mode,
    authLoading,
    user,
    checkRevision,
  ]);

  // Reveal lower sections once when they enter the viewport.
  useEffect(() => {
    const node = page.current;

    if (
      !node ||
      load.loading ||
      !event ||
      !window.IntersectionObserver ||
      window.matchMedia?.(
        "(prefers-reduced-motion: reduce)"
      ).matches
    ) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;

          entry.target.classList.add("ed-visible");
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.08 }
    );

    node.classList.add("ed-observing");

    node
      .querySelectorAll("[data-ed-reveal]")
      .forEach((element) => observer.observe(element));

    return () => {
      observer.disconnect();
      node.classList.remove("ed-observing");
    };
  }, [event?.id, load.loading]);

  const teamEvent =
    event?.registration_mode === "team";

  const organiser = Boolean(user?.is_organizer);

  const registered =
    registration?.status === "registered";

  const available = count(event?.available_seats);
  const capacity = count(event?.capacity);

  const reserved =
    count(event?.registered_count) ??
    (
      capacity !== null && available !== null
        ? Math.max(0, capacity - available)
        : null
    );

  const deadline = Date.parse(
    event?.registration_deadline
  );

  const starts = Date.parse(event?.start_datetime);
  const ends = Date.parse(event?.end_datetime);

  const closed =
    !Number.isFinite(deadline) || now >= deadline;

  const started =
    Number.isFinite(starts) && now >= starts;

  const ended =
    Number.isFinite(ends) && now >= ends;

  const full = available === 0;

  const open =
    event?.status === "published" &&
    !closed &&
    !started &&
    !full;

  const checking =
    authLoading ||
    (
      Boolean(user) &&
      !organiser &&
      !teamEvent &&
      check.loading
    );

  const status = registered
    ? "You're registered"
    : ended
      ? "Event ended"
      : started
        ? "Event started"
        : closed
          ? "Registration closed"
          : full
            ? "Event full"
            : "Registration open";

  async function refreshEvent() {
    try {
      const updated = await getPublicEvent(id);

      if (alive.current) {
        setEvent(updated);
      }
    } catch {
      // A successful registration/team action stays successful
      // even if the secondary count refresh fails.
    }
  }

  async function register() {
    if (
      busy.current ||
      checking ||
      organiser ||
      teamEvent ||
      !open ||
      registered ||
      check.error
    ) {
      return;
    }

    if (!user) {
      navigate("/login");
      return;
    }

    // The ref blocks two clicks before React updates the button.
    busy.current = true;
    setRegistering(true);
    setActionError("");
    setNotice("");

    try {
      const result = await registerForEvent(event.id);

      if (!alive.current) return;

      setRegistration(result.registration);

      setNotice(
        "Your place is reserved. Your digital ticket is ready in My Registrations."
      );

      await refreshEvent();
    } catch (error) {
      if (alive.current) {
        setActionError(errorMessage(error));
      }
    } finally {
      busy.current = false;

      if (alive.current) {
        setRegistering(false);
      }
    }
  }

  async function share() {
    setShareMessage("");

    try {
      if (navigator.share) {
        await navigator.share({
          title: event.title,
          url: window.location.href,
        });
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(
          window.location.href
        );

        if (alive.current) {
          setShareMessage("Event link copied.");
        }
      } else {
        setShareMessage(
          "Copy the link from your browser's address bar."
        );
      }
    } catch (error) {
      if (
        error.name !== "AbortError" &&
        alive.current
      ) {
        setShareMessage(
          "Copy the link from your browser's address bar."
        );
      }
    }
  }

  function addToCalendar() {
    if (![starts, ends].every(Number.isFinite)) {
      setShareMessage(
        "Calendar dates are unavailable."
      );
      return;
    }

    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//EventHub//Campus Events//EN",
      "BEGIN:VEVENT",
      `UID:eventhub-${event.id}@eventhub.local`,
      `DTSTAMP:${calendarDate(Date.now())}`,
      `DTSTART:${calendarDate(starts)}`,
      `DTEND:${calendarDate(ends)}`,
      `SUMMARY:${calendarText(event.title)}`,
      `DESCRIPTION:${calendarText(event.description)}`,
      `LOCATION:${calendarText(event.venue)}`,
      "END:VEVENT",
      "END:VCALENDAR",
    ];

    const blob = new Blob(
      [lines.join("\r\n") + "\r\n"],
      { type: "text/calendar;charset=utf-8" }
    );

    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.href = url;
    anchor.download = `eventhub-${event.id}.ics`;

    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <main className="ed-page" ref={page}>
      <div className="ed-shell">
        <Link className="ed-back" to="/events">
          ← Explore all events
        </Link>

        {load.loading ? (
          <div className="ed-message" role="status">
            Getting your event ready…
          </div>
        ) : load.error ? (
          <div className="ed-message" role="alert">
            <h1>
              {load.missing
                ? "Event not available."
                : "Unable to load this event."}
            </h1>

            <p>
              {load.missing
                ? "It may no longer be upcoming or published."
                : load.error}
            </p>

            {!load.missing && (
              <button
                className="ed-button"
                onClick={() =>
                  setRevision((value) => value + 1)
                }
              >
                Try again
              </button>
            )}
          </div>
        ) : event && (
          <>
            <header className="ed-hero">
              <div className="ed-hero-copy">
                <div className="ed-tags">
                  <span>
                    {getCategoryLabel(event.category)}
                  </span>

                  <span>
                    {teamEvent
                      ? "Team event"
                      : "Individual event"}
                  </span>
                </div>

                <h1>{event.title}</h1>

                <p>
                  Organised by{" "}
                  <strong>
                    {event.organizer_name}
                  </strong>
                </p>

                <div className="ed-actions">
                  <button
                    className="ed-button"
                    onClick={share}
                  >
                    ↗ &nbsp; Share event
                  </button>

                  <button
                    className="ed-button ed-button--light"
                    onClick={addToCalendar}
                  >
                    ▦ &nbsp; Add to calendar
                  </button>
                </div>

                {shareMessage && (
                  <p
                    className="ed-feedback"
                    role="status"
                  >
                    {shareMessage}
                  </p>
                )}
              </div>

              <div className="ed-hero-photo">
                <EventCover
                  category={event.category}
                />

                <span>Category cover</span>
              </div>
            </header>

            <dl className="ed-quick-facts">
              <div>
                <dt>Event starts</dt>
                <dd>
                  {formatEventDateTime(
                    event.start_datetime
                  )}
                </dd>
              </div>

              <div>
                <dt>Venue</dt>
                <dd>
                  {event.venue || "To be announced"}
                </dd>
              </div>

              <div>
                <dt>Seats available</dt>
                <dd>
                  {available ?? "—"}
                  {capacity > 0 && ` of ${capacity}`}
                </dd>
              </div>
            </dl>

            <div className="ed-layout">
              <div className="ed-main">
                <section data-ed-reveal>
                  <p className="ed-eyebrow">
                    The experience
                  </p>

                  <h2>About this event.</h2>

                  <p className="ed-description">
                    {event.description ||
                      "The organiser has not added a description yet."}
                  </p>
                </section>

                <section data-ed-reveal>
                  <p className="ed-eyebrow">
                    Mark your calendar
                  </p>

                  <h2>Event timeline.</h2>

                  <p className="ed-muted">
                    Everything you need to know before
                    the experience begins.
                  </p>

                  <ol className="ed-timeline">
                    {[
                      [
                        "Registration closes",
                        event.registration_deadline,
                      ],
                      [
                        "Event begins",
                        event.start_datetime,
                      ],
                      [
                        "Event ends",
                        event.end_datetime,
                      ],
                    ].map(([label, date], index) => {
                      const time = Date.parse(date);

                      const passed =
                        Number.isFinite(time) &&
                        now >= time;

                      return (
                        <li key={label}>
                          <span className="ed-number">
                            {passed
                              ? "✓"
                              : `0${index + 1}`}
                          </span>

                          <div>
                            <h3>{label}</h3>

                            <time dateTime={date}>
                              {formatEventDateTime(date)}
                            </time>
                          </div>

                          <span className="ed-timeline-state">
                            {!Number.isFinite(time)
                              ? "Unspecified"
                              : passed
                                ? "Passed"
                                : "Upcoming"}
                          </span>
                        </li>
                      );
                    })}
                  </ol>
                </section>

                <section data-ed-reveal>
                  <p className="ed-eyebrow">
                    The people behind it
                  </p>

                  <h2>Meet your organiser.</h2>

                  <div className="ed-organiser">
                    <span>
                      {event.organizer_name
                        ?.charAt(0)
                        .toUpperCase() || "E"}
                    </span>

                    <div>
                      <strong>
                        {event.organizer_name}
                      </strong>

                      <small>Event organiser</small>
                    </div>
                  </div>
                </section>
              </div>

              <aside className="ed-sidebar">
                <span
                  className={`ed-status ${
                    open || registered
                      ? "ed-status--open"
                      : ""
                  }`}
                >
                  ● &nbsp; {status}
                </span>

                <h2>Plan your place.</h2>

                <div className="ed-deadline">
                  <span>Registration deadline</span>

                  <strong>
                    {formatEventDateTime(
                      event.registration_deadline
                    )}
                  </strong>
                </div>

                <div className="ed-availability">
                  <div>
                    <span>Seats available</span>

                    <strong>
                      {available ?? "—"}
                      {capacity > 0 &&
                        ` of ${capacity}`}
                    </strong>
                  </div>

                  {capacity > 0 &&
                    reserved !== null && (
                      <progress
                        value={Math.min(
                          capacity,
                          reserved
                        )}
                        max={capacity}
                        aria-label="Seats reserved"
                      />
                    )}

                  <p>
                    {reserved !== null
                      ? `${reserved} reserved`
                      : "Availability is confirmed when you register."}
                  </p>
                </div>

                {teamEvent ? (
                  <TeamRegistrationPanel
                    key={event.id}
                    event={event}
                    user={user}
                    authLoading={authLoading}
                    onChanged={refreshEvent}
                  />
                ) : (
                  <div className="ed-individual">
                    {actionError && (
                      <p
                        className="ed-error"
                        role="alert"
                      >
                        {actionError}
                      </p>
                    )}

                    {notice && (
                      <p
                        className="ed-success"
                        role="status"
                      >
                        {notice}
                      </p>
                    )}

                    {checking ? (
                      <p
                        role="status"
                        className="ed-muted"
                      >
                        Checking your registration…
                      </p>
                    ) : check.error ? (
                      <div role="alert">
                        <p className="ed-error">
                          {check.error}
                        </p>

                        <button
                          className="ed-button ed-button--light"
                          onClick={() =>
                            setCheckRevision(
                              (value) => value + 1
                            )
                          }
                        >
                          Check again
                        </button>
                      </div>
                    ) : registered ? (
                      <Link
                        className="ed-button ed-wide"
                        to="/my-registrations"
                      >
                        View My Registrations →
                      </Link>
                    ) : organiser ? (
                      <p className="ed-account-note">
                        Organiser accounts cannot
                        register as students.
                      </p>
                    ) : (
                      <>
                        <button
                          className="ed-button ed-wide"
                          disabled={!open || registering}
                          onClick={register}
                        >
                          {registering
                            ? "Registering…"
                            : !open
                              ? status
                              : user
                                ? "Reserve my place →"
                                : "Log in to register →"}
                        </button>

                        <p className="ed-muted">
                          {open
                            ? "Your digital ticket will be available in My Registrations."
                            : "Registration is unavailable for this event."}
                        </p>
                      </>
                    )}
                  </div>
                )}
              </aside>
            </div>
            <EventCommunication eventId={event.id} />

            <footer className="ed-footer">
              <Link to="/">
                ← Back to EventHub
              </Link>

              <strong>
                Show up. Stand out.
              </strong>
            </footer>
          </>
        )}
      </div>
    </main>
  );
}