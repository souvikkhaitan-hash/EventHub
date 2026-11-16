import { Link } from "react-router";
import EventCover from "./EventCover";
import { formatEventDateTime, getCategoryLabel } from "../utils/eventFormat";

function number(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : null;
}
export function getExploreStatus(event, now) {
  const deadline = Date.parse(event.registration_deadline);
  if (Number.isFinite(deadline) && deadline <= now) return { label: "Registration closed", kind: "closed" };
  if (number(event.available_seats) === 0) return { label: "Event full", kind: "closed" };
  if (Number.isFinite(deadline) && deadline - now <= 172800000) return { label: "Closing soon", kind: "soon" };
  return { label: "Registration open", kind: "open" };
}
export default function ExploreEventCard({ event, now, index }) {
  const status = getExploreStatus(event, now);
  const capacity = number(event.capacity);
  const available = number(event.available_seats);
  const reserved = number(event.registered_count) ?? (capacity !== null && available !== null ? Math.max(0, capacity - available) : null);
  const start = new Date(event.start_datetime);
  const dateOptions = { timeZone: "Asia/Kolkata" };
  return (
    <article className="ex-card" style={{ "--ex-index": Math.min(index, 6) }}>
      <div className="ex-card-cover">
        <EventCover category={event.category} />
        <time className="ex-date" dateTime={event.start_datetime}>
          <strong>{new Intl.DateTimeFormat("en-IN", { ...dateOptions, day: "2-digit" }).format(start)}</strong>
          <span>{new Intl.DateTimeFormat("en-IN", { ...dateOptions, month: "short" }).format(start)}</span>
        </time>
        <span className="ex-cover-label">Category cover</span>
      </div>
      <div className="ex-card-content">
        <div className="ex-card-tags"><span>{getCategoryLabel(event.category)}</span><span className="ex-mode">{event.registration_mode === "team" ? "Team event" : "Individual event"}</span><span className={`ex-status ex-status--${status.kind}`}>{status.label}</span></div>
        <h2><Link to={`/events/${encodeURIComponent(event.id)}`}>{event.title}</Link></h2>
        {event.description && <p className="ex-description">{event.description}</p>}
        <dl className="ex-facts">
          <div><dt>Date & time</dt><dd>{formatEventDateTime(event.start_datetime)}</dd></div>
          <div><dt>Venue</dt><dd>{event.venue || "To be announced"}</dd></div>
          <div><dt>Register by</dt><dd>{event.registration_deadline ? formatEventDateTime(event.registration_deadline) : "Not specified"}</dd></div>
          <div><dt>Organiser</dt><dd>{event.organizer_name || "Campus organiser"}</dd></div>
        </dl>
        {available !== null && <div className="ex-seats"><div><span><strong>{available}</strong>{capacity > 0 ? ` of ${capacity}` : ""} seats available</span>{reserved !== null && <small>{reserved} reserved</small>}</div>{capacity > 0 && reserved !== null && <progress value={Math.min(capacity, reserved)} max={capacity} aria-label={`Seats reserved for ${event.title}`} />}</div>}
        <div className="ex-card-bottom"><span>{status.kind === "soon" ? "Registration closes soon" : "Find your next campus experience"}</span><Link className="ex-button" to={`/events/${encodeURIComponent(event.id)}`} aria-label={`View ${event.title}`}>View event <span aria-hidden="true">↗</span></Link></div>
      </div>
    </article>
  );
}
