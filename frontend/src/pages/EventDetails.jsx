import { useEffect, useState } from "react";
import {
  Link,
  useNavigate,
  useParams,
} from "react-router";
import Navbar from "../components/Navbar";
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
import "../styles/discovery.css";
import "../styles/registrations.css";
import EventArtworkIcon from "../components/EventArtworkIcon";
import TeamRegistrationPanel from "../components/TeamRegistrationPanel";
// ============================================================
// EVENTHUB 2.0 — EVENT DETAILS
// ============================================================
// Category artwork.
const categorySymbols = {
  technical: "{ }",
  cultural: "✳",
  workshop: "↗",
  seminar: "◎",
  sports: "◉",
};
// ============================================================
// HELPERS
// ============================================================
function getErrorMessage(error) {
  return (
    error?.details?.message ||
    error?.details?.detail ||
    error?.message ||
    "Something went wrong. Please try again."
  );
}
// Convert event dates into a calendar-compatible UTC format.
function formatCalendarDate(value) {
  const date = new Date(value);
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/**\.**\d{3}/, "");
}
// Escape special characters in an iCalendar text value.
function escapeCalendarText(value) {
  return String(value || "")
    .replace(/**\\\**/g, "\\\\\\\\")
    .replace(/\r?\n/g, "\\\n")
    .replace(/,/g, "\\\\,")
    .replace(/;/g, "\\\\;");
}
// ============================================================
// REGISTRATION COUNTDOWN
// ============================================================
function getCountdown(deadline) {
  const remaining =
    new Date(deadline).getTime() - Date.now();
  if (!Number.isFinite(remaining) || remaining <= 0) {
    return {
      expired: true,
      text: "Registration closed",
    };
  }
  const minutes = Math.floor(
    remaining / (1000 * 60)
  );
  const days = Math.floor(minutes / (60 * 24));
  const hours = Math.floor(
    (minutes % (60 * 24)) / 60
  );
  const remainingMinutes = minutes % 60;
  if (days > 0) {
    return {
      expired: false,
      text: `${days}d ${hours}h remaining`,
    };
  }
  if (hours > 0) {
    return {
      expired: false,
      text: `${hours}h ${remainingMinutes}m remaining`,
    };
  }
  return {
    expired: false,
    text:
      minutes > 0
        ? `${minutes}m remaining`
        : "Less than a minute remaining",
  };
}
// ============================================================
// EVENT TIMELINE
// ============================================================
function EventTimeline({ event }) {
  const now = Date.now();
  const timeline = [
    {
      number: "01",
      title: "Registration closes",
      date: event.registration_deadline,
    },
    {
      number: "02",
      title: "Event begins",
      date: event.start_datetime,
    },
    {
      number: "03",
      title: "Event ends",
      date: event.end_datetime,
    },
  ];
  return (
    <section className="event-v2-timeline-section">
      <div className="event-v2-section-heading">
        <span className="discovery-eyebrow">
          MARK YOUR CALENDAR
        </span>
        <h2>The event timeline.</h2>
        <p>
          Everything you need to know before
          the experience begins.
        </p>
      </div>
      <div className="event-v2-timeline">
        {timeline.map((item) => {
          const completed =
            new Date(item.date).getTime() <= now;
          return (
            <div
              key={item.number}
              className={`event-v2-timeline-item ${
                completed
                  ? "event-v2-timeline-completed"
                  : ""
              }`}
            >
              <div className="event-v2-timeline-marker">
                {completed ? "✓" : item.number}
              </div>
              <div className="event-v2-timeline-content">
                <h3>{item.title}</h3>
                <p>
                  {formatEventDateTime(item.date)}
                </p>
                <span>
                  {completed ? "Passed" : "Upcoming"}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
// ============================================================
// MAIN EVENT DETAILS COMPONENT
// ============================================================
export default function EventDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const {
    user,
    loading: authLoading,
  } = useAuth();
  // Event information.
  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notFound, setNotFound] = useState(false);
  // Registration information.
  const [registration, setRegistration] =
    useState(null);
  const [
    checkingRegistration,
    setCheckingRegistration,
  ] = useState(false);
  const [
    registrationChecked,
    setRegistrationChecked,
  ] = useState(false);
  const [registering, setRegistering] =
    useState(false);
  const [
    registrationError,
    setRegistrationError,
  ] = useState("");
  const [
    registrationSuccess,
    setRegistrationSuccess,
  ] = useState("");
  // Share feedback.
  const [shareMessage, setShareMessage] =
    useState("");
  // Current time for countdown and event status.
  const [currentTime, setCurrentTime] =
    useState(Date.now());
  // ==========================================================
  // UPDATE CURRENT TIME
  // ==========================================================
  useEffect(() => {
    const interval = window.setInterval(() => {
      setCurrentTime(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(interval);
    };
  }, []);
  // ==========================================================
  // LOAD PUBLIC EVENT
  // ==========================================================
  useEffect(() => {
    let active = true;
    async function loadEvent() {
      setLoading(true);
      setEvent(null);
      setError("");
      setNotFound(false);
      setRegistration(null);
      setRegistrationChecked(false);
      setRegistrationError("");
      setRegistrationSuccess("");
      setShareMessage("");
      try {
        const data = await getPublicEvent(id);
        if (active) {
          setEvent(data);
        }
      } catch (err) {
        if (active) {
          if (err.status === 404) {
            setNotFound(true);
          } else {
            setError(getErrorMessage(err));
          }
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }
    loadEvent();
    return () => {
      active = false;
    };
  }, [id]);
  // ==========================================================
  // CHECK EXISTING STUDENT REGISTRATION
  // ==========================================================
  useEffect(() => {
    let active = true;
    setRegistration(null);
    setRegistrationChecked(false);
    setRegistrationError("");
    setRegistrationSuccess("");
    if (authLoading || !event) {
      return () => {
        active = false;
      };
    }
    // Guests do not have existing registrations.
    if (!user) {
      setRegistrationChecked(true);
      return () => {
        active = false;
      };
    }
    // Organizers cannot access student registration APIs.
    if (user.is_organizer) {
      setRegistrationChecked(true);
      return () => {
        active = false;
      };
    }
    async function checkRegistration() {
      setCheckingRegistration(true);
      try {
        const registrations =
          await getMyRegistrations();
        const existing = registrations.find(
          (item) =>
            Number(item.event) === Number(event.id)
        );
        if (active) {
          setRegistration(existing || null);
          setRegistrationChecked(true);
        }
      } catch (err) {
        if (active) {
          setRegistrationError(
            "Unable to check your registration status. Refresh the page and try again."
          );
        }
      } finally {
        if (active) {
          setCheckingRegistration(false);
        }
      }
    }
    checkRegistration();
    return () => {
      active = false;
    };
  }, [user, authLoading, event?.id]);
  // ==========================================================
  // REGISTRATION STATE
  // ==========================================================
  const alreadyRegistered =
    registration?.status === "registered";
  const isOrganizer =
    Boolean(user?.is_organizer);
  const ownEvent = Boolean(
    user &&
      event &&
      user.username === event.organizer_name
  );
  const deadlineTime = event
    ? new Date(
        event.registration_deadline
      ).getTime()
    : 0;
  const startTime = event
    ? new Date(event.start_datetime).getTime()
    : 0;
  const endTime = event
    ? new Date(event.end_datetime).getTime()
    : 0;
  const registrationClosed =
    Boolean(event) &&
    currentTime >= deadlineTime;
  const eventStarted =
    Boolean(event) &&
    currentTime >= startTime;
  const eventEnded =
    Boolean(event) &&
    currentTime >= endTime;
  const availableSeats =
    event?.available_seats == null
      ? null
      : Math.max(
          0,
          Number(event.available_seats)
        );
  const registeredCount =
    event?.registered_count == null
      ? null
      : Number(event.registered_count);
  const capacity = Number(
    event?.capacity || 0
  );
  const eventFull =
    availableSeats !== null &&
    availableSeats <= 0;
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
      : 0;
  const checking =
    authLoading ||
    (
      Boolean(user) &&
      !isOrganizer &&
      (
        checkingRegistration ||
        !registrationChecked
      )
    );
  const registrationDisabled =
    registering ||
    checking ||
    alreadyRegistered ||
    registrationClosed ||
    eventStarted ||
    eventFull ||
    isOrganizer;
  const countdown = event
    ? getCountdown(
        event.registration_deadline
      )
    : null;
  // ==========================================================
  // REGISTRATION STATUS
  // ==========================================================
  function getRegistrationStatus() {
    if (alreadyRegistered) {
      return {
        label: "YOU'RE REGISTERED",
        type: "registered",
      };
    }
    if (eventEnded) {
      return {
        label: "EVENT ENDED",
        type: "closed",
      };
    }
    if (eventStarted) {
      return {
        label: "EVENT STARTED",
        type: "closed",
      };
    }
    if (registrationClosed) {
      return {
        label: "REGISTRATION CLOSED",
        type: "closed",
      };
    }
    if (eventFull) {
      return {
        label: "EVENT FULL",
        type: "full",
      };
    }
    return {
      label: "REGISTRATION OPEN",
      type: "open",
    };
  }
  const registrationStatus =
    getRegistrationStatus();
  // ==========================================================
  // BUTTON TEXT
  // ==========================================================
  function getRegistrationButtonText() {
    if (registering) {
      return "Registering...";
    }
    if (alreadyRegistered) {
      return "✓ You're Registered";
    }
    if (isOrganizer) {
      return ownEvent
        ? "Your Event"
        : "Organizer Account";
    }
    if (checking) {
      return "Checking registration...";
    }
    if (eventEnded) {
      return "Event Ended";
    }
    if (eventStarted) {
      return "Event Started";
    }
    if (registrationClosed) {
      return "Registration Closed";
    }
    if (eventFull) {
      return "Event Full";
    }
    if (!user) {
      return "Log in to Register →";
    }
    return "Register Now →";
  }
  // ==========================================================
  // REGISTER FOR EVENT
  // ==========================================================
  async function handleRegistration() {
    // Individual registration must never be used for team events.
    if (event?.registration_mode === "team") return;
    if (
      registering ||
      checking ||
      authLoading ||
      isOrganizer
    ) {
      return;
    }
    if (!user) {
      navigate("/login");
      return;
    }
    if (
      !registrationChecked ||
      !event ||
      alreadyRegistered ||
      registrationClosed ||
      eventStarted ||
      eventFull
    ) {
      return;
    }
    setRegistrationError("");
    setRegistrationSuccess("");
    setRegistering(true);
    try {
      const result =
        await registerForEvent(event.id);
      setRegistration(result.registration);
      setRegistrationSuccess(
        "You're in! Your place has been reserved. Your digital ticket is ready."
      );
      // Refresh public event counts after registration.
      // Django remains responsible for actual seat capacity.
      try {
        const updatedEvent =
          await getPublicEvent(event.id);
        setEvent(updatedEvent);
      } catch {
        // Registration has already succeeded.
        // Do not incorrectly report an error if the
        // secondary count refresh fails.
      }
    } catch (err) {
      setRegistrationError(
        getErrorMessage(err)
      );
    } finally {
      setRegistering(false);
    }
  }
  // ==========================================================
  // SHARE EVENT
  // ==========================================================
  async function handleShare() {
    if (!event) return;
    setShareMessage("");
    const shareData = {
      title: event.title,
      text: `Check out ${event.title} on EventHub!`,
      url: window.location.href,
    };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
        return;
      }
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(
          window.location.href
        );
        setShareMessage(
          "Event link copied to clipboard!"
        );
        return;
      }
      setShareMessage(
        "Copy the event URL from your browser's address bar."
      );
    } catch (err) {
      if (err?.name === "AbortError") {
        return;
      }
      setShareMessage(
        "Unable to share automatically. Copy the URL from your browser."
      );
    }
  }
  // ==========================================================
  // ADD TO CALENDAR
  // ==========================================================
  function handleAddToCalendar() {
    if (!event) return;
    const start = new Date(
      event.start_datetime
    );
    const end = new Date(
      event.end_datetime
    );
    if (
      Number.isNaN(start.getTime()) ||
      Number.isNaN(end.getTime())
    ) {
      return;
    }
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//EventHub//Campus Events//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "BEGIN:VEVENT",
      `UID:eventhub-event-${event.id}@eventhub.local`,
      `DTSTAMP:${formatCalendarDate(new Date())}`,
      `DTSTART:${formatCalendarDate(start)}`,
      `DTEND:${formatCalendarDate(end)}`,
      `SUMMARY:${escapeCalendarText(event.title)}`,
      `DESCRIPTION:${escapeCalendarText(
        event.description
      )}`,
      `LOCATION:${escapeCalendarText(event.venue)}`,
      "END:VEVENT",
      "END:VCALENDAR",
    ];
    const calendarContent =
      lines.join("\r\n") + "\r\n";
    const blob = new Blob(
      [calendarContent],
      {
        type: "text/calendar;charset=utf-8",
      }
    );
    const url = URL.createObjectURL(blob);
    const anchor =
      document.createElement("a");
    anchor.href = url;
    anchor.download =
      `eventhub-event-${event.id}.ics`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1000);
  }
  // ==========================================================
  // PAGE
  // ==========================================================
  return (
    <>
      <Navbar />
      <main className="event-details-page event-details-v2">
        <div className="container">
          {/* BACK NAVIGATION */}
          <Link
            to="/events"
            className="event-details-back"
          >
            ← Explore all events
          </Link>
          {/* LOADING */}
          {loading && (
            <div
              className="discovery-message"
              role="status"
            >
              <span className="discovery-message-icon">
                ✳
              </span>
              <h2>Getting your event ready...</h2>
              <p>
                Loading event information.
              </p>
            </div>
          )}
          {/* NOT FOUND */}
          {!loading && notFound && (
            <div className="discovery-message">
              <h2>Event not available.</h2>
              <p>
                This event may have been cancelled,
                removed, or may no longer be upcoming.
              </p>
              <Link
                to="/events"
                className="discovery-action-button"
              >
                Explore other events →
              </Link>
            </div>
          )}
          {/* ERROR */}
          {!loading && error && (
            <div
              className="discovery-message"
              role="alert"
            >
              <h2>Unable to load this event.</h2>
              <p>{error}</p>
            </div>
          )}
          {/* EVENT CONTENT */}
          {!loading &&
            event &&
            !error &&
            !notFound && (
              <>
                {/* ======================================
                    PREMIUM EVENT HERO
                ====================================== */}
                <section
                  className={`event-v2-hero event-v2-category-${event.category}`}
                >
                  <div className="event-v2-hero-copy">
                    <span className="event-v2-hero-eyebrow">
                      EVENTHUB / CAMPUS EXPERIENCES
                    </span>
                    <span className="event-v2-category-pill">
                      {getCategoryLabel(
                        event.category
                      )}
                    </span>
                    <h1>{event.title}</h1>
                    <p className="event-v2-organizer">
                      Organized by{" "}
                      <strong>
                        {event.organizer_name}
                      </strong>
                    </p>
                    <div className="event-v2-hero-actions">
                      <button
                        type="button"
                        className="event-v2-share-button"
                        onClick={handleShare}
                      >
                        <span aria-hidden="true">
                          ↗
                        </span>
                        Share event
                      </button>
                      <button
                        type="button"
                        className="event-v2-calendar-button"
                        onClick={handleAddToCalendar}
                      >
                        <span aria-hidden="true">
                          ◷
                        </span>
                        Add to calendar
                      </button>
                    </div>
                    {shareMessage && (
                      <p
                        className="event-v2-share-message"
                        role="status"
                      >
                        {shareMessage}
                      </p>
                    )}
                  </div>
                  {/* CATEGORY ARTWORK */}
                  <div
                    className="event-v2-hero-art"
                    aria-hidden="true"
                  >
                    <div className="event-v2-art-circle" />
                    <div className="event-v2-art-symbol">
                      <EventArtworkIcon event={event} />
                    </div>
                    <span className="event-v2-art-caption">
                      SHOW UP.
                      <br />
                      STAND OUT.
                    </span>
                    <span className="event-v2-art-spark">
                      ✳
                    </span>
                  </div>
                </section>
                {/* ======================================
                    EVENT QUICK FACTS
                ====================================== */}
                <div className="event-v2-quick-facts">
                  <div>
                    <span className="event-v2-fact-icon">
                      ◷
                    </span>
                    <div>
                      <span>EVENT STARTS</span>
                      <strong>
                        {formatEventDateTime(
                          event.start_datetime
                        )}
                      </strong>
                    </div>
                  </div>
                  <div>
                    <span className="event-v2-fact-icon">
                      ⌖
                    </span>
                    <div>
                      <span>LOCATION</span>
                      <strong>
                        {event.venue}
                      </strong>
                    </div>
                  </div>
                  <div>
                    <span className="event-v2-fact-icon">
                      ✳
                    </span>
                    <div>
                      <span>AVAILABLE SEATS</span>
                      <strong>
                        {availableSeats !== null
                          ? `${availableSeats} of ${capacity}`
                          : capacity}
                      </strong>
                    </div>
                  </div>
                </div>
                {/* ======================================
                    MAIN CONTENT
                ====================================== */}
                <div className="event-details-layout event-v2-layout">
                  {/* LEFT COLUMN */}
                  <div className="event-v2-main">
                    {/* ABOUT */}
                    <section className="event-details-description event-v2-about">
                      <span className="discovery-eyebrow">
                        THE EXPERIENCE
                      </span>
                      <h2>
                        About this event.
                      </h2>
                      <p>
                        {event.description}
                      </p>
                    </section>
                    {/* TIMELINE */}
                    <EventTimeline event={event} />
                    {/* ORGANIZER */}
                    <section className="event-v2-organizer-section">
                      <span className="discovery-eyebrow">
                        THE PEOPLE BEHIND IT
                      </span>
                      <h2>Meet your organizer.</h2>
                      <div className="event-v2-organizer-card">
                        <div className="event-v2-organizer-avatar">
                          {event.organizer_name
                            ?.charAt(0)
                            .toUpperCase()}
                        </div>
                        <div>
                          <strong>
                            {event.organizer_name}
                          </strong>
                          <span>
                            Event organizer
                          </span>
                        </div>
                      </div>
                    </section>
                  </div>
                  {/* ======================================
                      REGISTRATION SIDEBAR
                  ====================================== */}
                  <aside className="event-details-sidebar event-v2-sidebar">
                    {/* STATUS */}
                    <div
                      className={`event-v2-status event-v2-status-${registrationStatus.type}`}
                    >
                      <span className="event-v2-status-dot" />
                      {registrationStatus.label}
                    </div>
                    <h2>
                      Your next experience
                      starts here.
                    </h2>
                    {/* COUNTDOWN */}
                    {!alreadyRegistered &&
                      !registrationClosed &&
                      !eventStarted &&
                      !eventFull &&
                      countdown && (
                        <div className="event-v2-countdown">
                          <span>
                            REGISTRATION CLOSES IN
                          </span>
                          <strong>
                            {countdown.text}
                          </strong>
                        </div>
                      )}
                    {/* EVENT INFORMATION */}
                    <div className="event-details-info event-v2-info">
                      <div>
                        <span>STARTS</span>
                        <strong>
                          {formatEventDateTime(
                            event.start_datetime
                          )}
                        </strong>
                      </div>
                      <div>
                        <span>ENDS</span>
                        <strong>
                          {formatEventDateTime(
                            event.end_datetime
                          )}
                        </strong>
                      </div>
                      <div>
                        <span>VENUE</span>
                        <strong>
                          {event.venue}
                        </strong>
                      </div>
                      <div>
                        <span>
                          REGISTRATION DEADLINE
                        </span>
                        <strong>
                          {formatEventDateTime(
                            event.registration_deadline
                          )}
                        </strong>
                      </div>
                    </div>
                    {/* SEAT AVAILABILITY */}
                    <div className="event-v2-availability">
                      <div className="event-v2-seats-heading">
                        <span>
                          SEATS RESERVED
                        </span>
                        <strong>
                          {registeredCount ?? "—"}
                          {" / "}
                          {capacity}
                        </strong>
                      </div>
                      <div
                        className="event-v2-seat-track"
                        role="progressbar"
                        aria-label="Reserved event seats"
                        aria-valuemin={0}
                        aria-valuemax={capacity}
                        aria-valuenow={
                          registeredCount ?? 0
                        }
                      >
                        <div
                          className="event-v2-seat-fill"
                          style={{
                            width: `${occupancy}%`,
                          }}
                        />
                      </div>
                      <p>
                        {availableSeats !== null
                          ? `${availableSeats} seats remaining`
                          : `${capacity} total places`}
                      </p>
                    </div>
                    {/* ERROR */}
                    {registrationError && (
                      <div
                        className="registration-error"
                        role="alert"
                      >
                        {registrationError}
                      </div>
                    )}
                    {/* SUCCESS */}
                    {registrationSuccess && (
                      <div
                        className="registration-success"
                        role="status"
                      >
                        <strong>
                          ✓ You're in!
                        </strong>
                        <p>
                          {registrationSuccess}
                        </p>
                      </div>
                    )}
                    {event.registration_mode === "team" ? (
                      <TeamRegistrationPanel
                        key={event.id}
                        event={event}
                        user={user}
                        authLoading={authLoading}
                        onChanged={async () => {
                          try {
                            const updated = await getPublicEvent(event.id);
                            setEvent(updated);
                          } catch {
                            // Team changes already succeeded; counts may be stale.
                          }
                        }}
                      />
                    ) : (
                      <>
                    {/* REGISTER BUTTON */}
                    <button
                      type="button"
                      className={`event-registration-button event-v2-register-button ${
                        alreadyRegistered
                          ? "registration-completed"
                          : ""
                      }`}
                      disabled={registrationDisabled}
                      onClick={handleRegistration}
                    >
                      {getRegistrationButtonText()}
                    </button>
                    {/* REGISTRATION INFO */}
                    {alreadyRegistered ? (
                      <Link
                        to="/my-registrations"
                        className="registration-manage-link event-v2-manage-link"
                      >
                        View My Registrations →
                      </Link>
                    ) : (
                      <p className="event-registration-note">
                        {isOrganizer
                          ? "Organizer accounts cannot register as students."
                          : eventEnded
                            ? "This event has ended."
                            : eventStarted
                              ? "This event has already started."
                              : registrationClosed
                                ? "The registration deadline has passed."
                                : eventFull
                                  ? "All available places are reserved."
                                  : !user
                                    ? "Log in to reserve your place."
                                    : "Reserve your place before registration closes."}
                      </p>
                    )}
                      </>
                    )}
                    {/* FOOTER NOTE */}
                    <div className="event-v2-sidebar-footer">
                      <span aria-hidden="true">
                        ✳
                      </span>
                      <p>
                        Every great campus memory
                        starts with showing up.
                      </p>
                    </div>
                  </aside>
                </div>
              </>
            )}
        </div>
      </main>
    </>
  );
}
