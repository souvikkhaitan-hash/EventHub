import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import Navbar from "../components/Navbar";
import EventCover from "../components/EventCover";
import ExploreEventCard from "../components/ExploreEventCard";
import { getPublicEvents } from "../services/events";
import { eventCategories, getCategoryLabel } from "../utils/eventFormat";
import "../styles/explore-editorial.css";

export default function ExploreEvents() {
  const [params, setParams] = useSearchParams();
  const [revision, setRevision] = useState(0);
  const [response, setResponse] = useState({
    revision: -1,
    events: [],
    error: "",
  });
  const [now, setNow] = useState(() => Date.now());
  const search = params.get("q") || "";
  const requested = params.get("category") || "all";
  const category = eventCategories.some((item) => item.value === requested)
    ? requested
    : "all";
  const requestedSort = params.get("sort") || "soonest";
  const sort = ["soonest", "latest", "availability"].includes(requestedSort)
    ? requestedSort
    : "soonest";
  const loading = response.revision !== revision;
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    getPublicEvents(controller.signal)
      .then((data) => {
        if (!Array.isArray(data))
          throw new Error(
            "The server returned an unexpected event list. Please try again.",
          );
        if (active) setResponse({ revision, events: data, error: "" });
      })
      .catch((error) => {
        if (active && error.name !== "AbortError")
          setResponse({
            revision,
            events: [],
            error: error.message || "Unable to load events.",
          });
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [revision]);
  const upcoming = useMemo(
    () =>
      response.events.filter((event) => {
        const start = Date.parse(event.start_datetime);
        return (
          event.status === "published" && Number.isFinite(start) && start > now
        );
      }),
    [response.events, now],
  );
  const events = useMemo(() => {
    const query = search.trim().toLowerCase();
    return upcoming
      .filter(
        (event) =>
          (category === "all" || category === event.category) &&
          (!query ||
            [
              event.title,
              event.description,
              event.venue,
              event.organizer_name,
              getCategoryLabel(event.category),
            ]
              .filter(Boolean)
              .join(" ")
              .toLowerCase()
              .includes(query)),
      )
      .sort((a, b) =>
        sort === "availability"
          ? (Number(b.available_seats) || 0) -
              (Number(a.available_seats) || 0) ||
            Date.parse(a.start_datetime) - Date.parse(b.start_datetime)
          : sort === "latest"
            ? Date.parse(b.start_datetime) - Date.parse(a.start_datetime)
            : Date.parse(a.start_datetime) - Date.parse(b.start_datetime),
      );
  }, [upcoming, category, search, sort]);
  function update(key, value, fallback = "") {
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (!value.trim() || value === fallback) next.delete(key);
        else next.set(key, value);
        return next;
      },
      { replace: true },
    );
  }
  function clearFilters() {
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        ["q", "category", "sort"].forEach((key) => next.delete(key));
        return next;
      },
      { replace: true },
    );
  }
  const hasFilters = search.trim() || category !== "all" || sort !== "soonest";
  return (
    <>
      <Navbar />
      <main className="ex-page">
        <div className="ex-shell">
          <header className="ex-intro">
            <div>
              <p className="ex-eyebrow">● &nbsp; EXPLORE CAMPUS EVENTS</p>
              <h1>
                Find your
                <br />
                <span>next thing.</span>
              </h1>
              <p className="ex-intro-copy">
                Workshops, competitions and experiences worth showing up for.
              </p>
            </div>
            <div className="ex-intro-photo" aria-hidden="true">
              <EventCover category="community" />
              <span>GO EXPLORE ↗</span>
            </div>
          </header>
          <section className="ex-controls" aria-label="Find events">
            <div className="ex-control-row">
              <div className="ex-search">
                <label htmlFor="event-search">Search events</label>
                <div>
                  <span aria-hidden="true">⌕</span>
                  <input
                    id="event-search"
                    type="search"
                    value={search}
                    onChange={(event) => update("q", event.target.value)}
                    placeholder="Search events, venues or keywords…"
                  />
                </div>
              </div>
              <div className="ex-sort">
                <label htmlFor="event-sort">Sort by</label>
                <select
                  id="event-sort"
                  value={sort}
                  onChange={(event) =>
                    update("sort", event.target.value, "soonest")
                  }
                >
                  <option value="soonest">Date: soonest</option>
                  <option value="latest">Date: latest</option>
                  <option value="availability">Most seats available</option>
                </select>
              </div>
            </div>
            <div
              className="ex-categories"
              role="group"
              aria-label="Explore by category"
            >
              {eventCategories.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  aria-pressed={category === item.value}
                  onClick={() => update("category", item.value, "all")}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </section>
          <section
            className="ex-results"
            aria-labelledby="ex-results-title"
            aria-busy={loading}
          >
            <div className="ex-results-heading">
              <h2 id="ex-results-title" aria-live="polite">
                {loading
                  ? "Finding your next thing…"
                  : response.error
                    ? "Upcoming events"
                    : `${events.length} upcoming ${events.length === 1 ? "event" : "events"}`}
              </h2>
              {hasFilters && (
                <button type="button" onClick={clearFilters}>
                  Clear filters
                </button>
              )}
            </div>
            {loading ? (
              <div className="ex-skeleton" role="status">
                <span>Loading campus events…</span>
              </div>
            ) : response.error ? (
              <div className="ex-message" role="alert">
                <h3>We couldn’t load the events.</h3>
                <p>{response.error}</p>
                <button
                  className="ex-button"
                  onClick={() => setRevision((value) => value + 1)}
                  type="button"
                >
                  Try again ↗
                </button>
              </div>
            ) : events.length ? (
              <>
                <div className="ex-list">
                  {events.map((event, index) => (
                    <ExploreEventCard
                      key={event.id}
                      event={event}
                      index={index}
                      now={now}
                    />
                  ))}
                </div>
                <p className="ex-note">
                  More campus events will appear here as organisers publish
                  them.
                </p>
              </>
            ) : (
              <div className="ex-message">
                <h3>
                  {upcoming.length
                    ? "No events match these filters."
                    : "Your next campus plan is on its way."}
                </h3>
                <p>
                  {upcoming.length
                    ? "Try another keyword or choose a different category."
                    : "There are no upcoming published events yet. Check back for new announcements."}
                </p>
                {hasFilters && (
                  <button
                    className="ex-button"
                    type="button"
                    onClick={clearFilters}
                  >
                    Explore all events →
                  </button>
                )}
              </div>
            )}
          </section>
          <footer className="ex-bottom">
            <Link to="/">← Back to EventHub</Link>
            <span>Explore. Register. Show up.</span>
          </footer>
        </div>
      </main>
    </>
  );
}
