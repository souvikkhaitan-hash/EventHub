import { useEffect, useState } from "react";
import { Link } from "react-router";

import { getPublicEvents } from "../services/events";
import { useAuth } from "../context/AuthContext";
import { formatEventDateTime, getCategoryLabel } from "../utils/eventFormat";
import EventCover from "./EventCover";

const categories = [
  { value: "technical", label: "Tech & Build", text: "Hackathons, coding and innovation.", symbol: "{ }", color: "lime" },
  { value: "cultural", label: "Culture & Art", text: "Music, performances and creativity.", symbol: "✳", color: "blue" },
  { value: "workshop", label: "Workshops", text: "New skills and practical experiences.", symbol: "↗", color: "lavender" },
  { value: "sports", label: "Sports", text: "Competitions, teams and campus life.", symbol: "◎", color: "coral" },
];

function Icon({ name }) {
  const paths = {
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
    pin: <><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" /><circle cx="12" cy="10" r="2.5" /></>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export function CampusHeroArtwork() {
  return (
    <div className="eh-hero-art" aria-hidden="true">
      <link rel="preload" as="image" href="/images/eventhub-campus-scenes.webp" />
      <div className="eh-photo eh-photo--concert eh-hero-photo" />
      <div className="eh-ticket-blue" />
      <div className="eh-campus-pass">
        <div className="eh-pass-top"><span>CAMPUS PASS</span><span>◎</span></div>
        <strong>MAKE<br />SOME<br />NOISE.</strong>
        <span className="eh-pass-edition">THE CAMPUS EDITION</span>
        <span className="eh-pass-barcode" />
      </div>
      <span className="eh-pass-dot" />
    </div>
  );
}

function eventStatus(event, now) {
  const deadline = new Date(event.registration_deadline).getTime();
  if (Number.isFinite(deadline) && deadline <= now) return "Registration closed";
  if (event.available_seats != null && Number(event.available_seats) <= 0) return "Event full";
  if (Number.isFinite(deadline) && deadline - now <= 48 * 60 * 60 * 1000) return "Closes soon";
  return "";
}

function CampusEventCard({ event, now, index }) {
  const start = new Date(event.start_datetime);
  const options = { timeZone: "Asia/Kolkata" };
  const day = new Intl.DateTimeFormat("en-IN", { ...options, day: "2-digit" }).format(start);
  const month = new Intl.DateTimeFormat("en-IN", { ...options, month: "short" }).format(start);
  const status = eventStatus(event, now);

  return (
    <article className="eh-event-card" style={{ "--eh-card-index": index }}>
      <Link className="eh-event-card-link" to={`/events/${event.id}`}>
        <div className="eh-event-media">
          <EventCover category={event.category} />
          <time className="eh-event-date" dateTime={event.start_datetime} aria-label={formatEventDateTime(event.start_datetime)}>
            <strong>{day}</strong><span>{month}</span>
          </time>
          {status && <span className="eh-event-status">{status}</span>}
        </div>
        <div className="eh-event-copy">
          <h3>{event.title}</h3>
          <p className="eh-event-meta">
            {getCategoryLabel(event.category)}
            {event.registration_mode === "team" && " · Team event"}
          </p>
          <div className="eh-event-bottom">
            <span className="eh-event-venue"><Icon name="pin" />{event.venue || "Venue to be announced"}</span>
            <span className="eh-event-action">View event ↗</span>
          </div>
        </div>
      </Link>
    </article>
  );
}

export default function HomeSections() {
  const { user, loading: authLoading } = useAuth();
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [revision, setRevision] = useState(0);
  const [response, setResponse] = useState({ revision: -1, events: [], error: "" });
  const [clock, setClock] = useState(() => Date.now());
  const loading = response.revision !== revision;

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    getPublicEvents(controller.signal).then((data) => {
      const events = Array.isArray(data) ? data : data?.results;
      if (!Array.isArray(events)) throw new Error("Unexpected event response. Please try again.");
      if (active) setResponse({ revision, events, error: "" });
    }).catch((error) => {
      if (active && !controller.signal.aborted) {
        setResponse({ revision, events: [], error: error.message || "Unable to load events." });
      }
    });
    return () => { active = false; controller.abort(); };
  }, [revision]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  const query = search.trim().toLowerCase();
  const events = (loading ? [] : response.events).filter((event) => {
    const start = new Date(event.start_datetime).getTime();
    return event.status === "published" && Number.isFinite(start) && start > clock
      && (category === "all" || event.category === category)
      && (!query || [event.title, event.description, event.venue, event.organizer_name, getCategoryLabel(event.category)]
        .filter(Boolean).join(" ").toLowerCase().includes(query));
  }).sort((a, b) => new Date(a.start_datetime) - new Date(b.start_datetime));

  const params = new URLSearchParams();
  if (category !== "all") params.set("category", category);
  if (search.trim()) params.set("q", search.trim());
  const exploreLink = `/events${params.size ? `?${params}` : ""}`;
  const filtered = category !== "all" || Boolean(search.trim());

  function clearFilters() { setCategory("all"); setSearch(""); }

  return (
    <>
      <section className="eh-categories container" aria-labelledby="eh-categories-title" data-reveal>
        <p className="eh-eyebrow" id="eh-categories-title">Find your thing</p>
        <div className="eh-category-grid">
          {categories.map((item) => (
            <button
              key={item.value} type="button"
              className={`eh-category eh-category--${item.color}`}
              aria-pressed={category === item.value}
              onClick={() => setCategory((previous) => previous === item.value ? "all" : item.value)}
            >
              <span className="eh-category-symbol" aria-hidden="true">{item.symbol}</span>
              <span className="eh-category-arrow" aria-hidden="true">↗</span>
              <strong>{item.label}</strong><span className="eh-category-description">{item.text}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="eh-calendar container" id="events" aria-labelledby="eh-calendar-title" data-reveal>
        <div className="eh-section-heading">
          <div><p className="eh-eyebrow">The campus calendar</p><h2 id="eh-calendar-title">Coming up <span>on campus.</span></h2></div>
          <Link className="eh-text-link" to={exploreLink}>Explore all events ↗</Link>
        </div>
        <div className="eh-calendar-tools">
          <button type="button" className="eh-all-events" aria-pressed={category === "all"} onClick={() => setCategory("all")}>All events</button>
          <label className="eh-search">
            <span className="eh-sr-only">Search upcoming events</span>
            <Icon name="search" />
            <input type="search" value={search} maxLength={100} placeholder="Search events" onChange={(e) => setSearch(e.target.value)} />
          </label>
        </div>

        {loading ? (
          <div role="status"><span className="eh-sr-only">Loading upcoming events…</span><div className="eh-event-grid" aria-hidden="true">{[0, 1, 2].map((i) => <div key={i} className="eh-event-placeholder" />)}</div></div>
        ) : response.error ? (
          <div className="eh-empty" role="alert"><h3>We couldn’t load the campus calendar.</h3><p>{response.error}</p><button type="button" onClick={() => setRevision((value) => value + 1)}>Try again</button></div>
        ) : events.length ? (
          <>
            <div className="eh-event-grid">{events.slice(0, 3).map((event, index) => <CampusEventCard key={event.id} event={event} now={clock} index={index} />)}</div>
            <p className="eh-calendar-caption">Showing {Math.min(3, events.length)} of {events.length} upcoming {events.length === 1 ? "event" : "events"}. Cover photography is illustrative.</p>
          </>
        ) : (
          <div className="eh-empty" role="status">
            <h3>{filtered ? "No events match these filters." : "Your next campus plan is on its way."}</h3>
            <p>{filtered ? "Try another category or search term." : "Upcoming published events will appear here. Check back for the next announcement."}</p>
            {filtered && <button type="button" onClick={clearFilters}>Clear filters</button>}
          </div>
        )}
      </section>

      <section className="eh-how container" id="how-it-works" aria-labelledby="eh-how-title" data-reveal>
        <h2 id="eh-how-title">Less planning. <span>More showing up.</span></h2>
        <p>Discover events across your campus, from competitions and performances to hands-on workshops.</p>
        <ol className="eh-steps">
          {[
            ["Discover", "Find an event that interests you."],
            ["Register", "Reserve your place and keep your ticket."],
            ["Show up", "Check in and enjoy the experience."],
          ].map(([title, text], index) => (
            <li key={title}><span className="eh-step-number">0{index + 1}</span><div><h3>{title}</h3><p>{text}</p></div></li>
          ))}
        </ol>
      </section>

      <section className="eh-cta container" aria-labelledby="eh-cta-title" data-reveal>
        <h2 id="eh-cta-title">Your next campus<br />story starts here.</h2>
        <div>
          <p>Discover events, register in a few clicks, and keep your tickets and published certificates together.</p>
          <Link className="eh-cta-button" to={!authLoading && user?.is_organizer ? "/organizer" : "/events"}>
            {!authLoading && user?.is_organizer ? "Organiser workspace" : "Explore events"}<span aria-hidden="true">↗</span>
          </Link>
        </div>
      </section>
    </>
  );
}
