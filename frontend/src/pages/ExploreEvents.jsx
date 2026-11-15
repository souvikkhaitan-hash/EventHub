import { useEffect, useMemo, useState } from "react";
import {
  Link,
  useSearchParams,
} from "react-router";

import Navbar from "../components/Navbar";
import EventCard from "../components/EventCard";

import { getPublicEvents } from "../services/events";
import { eventCategories } from "../utils/eventFormat";

import "../styles/discovery.css";


// ============================================================
// EVENTHUB — EXPLORE EVENTS
// ============================================================

export default function ExploreEvents() {
  const [events, setEvents] = useState([]);

  const [searchParams, setSearchParams] = useSearchParams();

  const [search, setSearch] = useState(
    searchParams.get("q") || ""
  );

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [sortBy, setSortBy] = useState("soonest");

  // ==========================================================
  // CATEGORY FILTER FROM URL
  // ==========================================================

  const validCategories = eventCategories.map(
    (item) => item.value
  );

  const requestedCategory =
    searchParams.get("category") || "all";

  const category = validCategories.includes(
    requestedCategory
  )
    ? requestedCategory
    : "all";

  // ==========================================================
  // KEEP SEARCH IN SYNC WITH BROWSER NAVIGATION
  // ==========================================================

  const queryFromUrl = searchParams.get("q") || "";

  useEffect(() => {
    setSearch(queryFromUrl);
  }, [queryFromUrl]);

  // ==========================================================
  // LOAD LIVE EVENTS FROM DJANGO
  // ==========================================================

  useEffect(() => {
    let active = true;

    async function loadEvents() {
      setLoading(true);
      setError("");

      try {
        const data = await getPublicEvents();

        if (active) {
          setEvents(Array.isArray(data) ? data : []);
        }
      } catch (err) {
        if (active) {
          setError(
            err.message ||
              "Unable to load upcoming events."
          );
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

  // ==========================================================
  // UPDATE CATEGORY
  // ==========================================================

  function changeCategory(value) {
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);

        if (value === "all") {
          next.delete("category");
        } else {
          next.set("category", value);
        }

        return next;
      },
      { replace: true }
    );
  }

  // ==========================================================
  // UPDATE SEARCH
  // ==========================================================

  function changeSearch(value) {
    setSearch(value);

    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);

        if (value.trim()) {
          next.set("q", value);
        } else {
          next.delete("q");
        }

        return next;
      },
      { replace: true }
    );
  }

  // ==========================================================
  // RESET FILTERS
  // ==========================================================

  function clearFilters() {
    setSearch("");
    setSortBy("soonest");
    setSearchParams({}, { replace: true });
  }

  // ==========================================================
  // FILTER AND SORT EVENTS
  // ==========================================================

  const filteredEvents = useMemo(() => {
    const query = search.trim().toLowerCase();

    const result = events.filter((event) => {
      const matchesCategory =
        category === "all" ||
        event.category === category;

      const searchableText = [
        event.title,
        event.description,
        event.venue,
        event.organizer_name,
        event.category,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      const matchesSearch =
        !query || searchableText.includes(query);

      return matchesCategory && matchesSearch;
    });

    // Soonest event first.
    if (sortBy === "soonest") {
      result.sort(
        (a, b) =>
          new Date(a.start_datetime) -
          new Date(b.start_datetime)
      );
    }

    // Latest event first.
    if (sortBy === "latest") {
      result.sort(
        (a, b) =>
          new Date(b.start_datetime) -
          new Date(a.start_datetime)
      );
    }

    // Events with most available seats first.
    if (sortBy === "availability") {
      result.sort(
        (a, b) =>
          (Number(b.available_seats) || 0) -
          (Number(a.available_seats) || 0)
      );
    }

    return result;
  }, [events, search, category, sortBy]);

  const hasFilters =
    category !== "all" || search.trim() !== "";

  // ==========================================================
  // RETURN
  // ==========================================================

  return (
    <>
      <Navbar />

      <main className="discovery-page discovery-v2">

        {/* ====================================================
            HERO SECTION
        ==================================================== */}

        <section className="discovery-hero">

          <div
            className="discovery-hero-glow"
            aria-hidden="true"
          />

          <div className="container">

            <span className="discovery-eyebrow discovery-hero-eyebrow">
              <span className="discovery-eyebrow-dot" />
              THE CAMPUS IS CALLING
            </span>

            <div className="discovery-hero-content">

              <div className="discovery-hero-copy">

                <h1>
                  <span className="discovery-title-line">
                    Find your
                  </span>

                  <span className="discovery-title-line discovery-title-blue">
                    next thing.
                  </span>
                </h1>

                <p>
                  Hackathons, workshops, cultural festivals,
                  competitions, and everything in between.
                  Discover what's happening on campus.
                </p>

                <a
                  href="#discover-events"
                  className="discovery-hero-action"
                >
                  Explore events
                  <span aria-hidden="true">↘</span>
                </a>

              </div>

              {/* DECORATIVE BADGE */}

              <div className="discovery-hero-art">

                <span
                  className="discovery-art-spark discovery-art-spark-one"
                  aria-hidden="true"
                >
                  ✳
                </span>

                <div
                  className="discovery-hero-badge"
                  aria-hidden="true"
                >
                  <span>GO</span>
                  <span>EXPLORE</span>
                  <span>✳</span>
                </div>

                <span
                  className="discovery-art-spark discovery-art-spark-two"
                  aria-hidden="true"
                >
                  ✦
                </span>

              </div>

            </div>

          </div>

        </section>

        {/* ====================================================
            DISCOVERY SECTION
        ==================================================== */}

        <section
          className="discovery-listing"
          id="discover-events"
        >

          <div className="container">

            {/* SECTION HEADING */}

            <div className="discovery-listing-heading">

              <div>
                <span className="discovery-eyebrow">
                  01 / DISCOVER EVENTS
                </span>

                <h2>
                  What's <span>happening.</span>
                </h2>

                <p className="discovery-listing-subtitle">
                  Find your people. Pick your experience.
                  Make every moment count.
                </p>
              </div>

              {!loading && !error && (
                <span
                  className="discovery-result-count"
                  aria-live="polite"
                >
                  <span className="discovery-count-dot" />

                  {filteredEvents.length}{" "}
                  {filteredEvents.length === 1
                    ? "event"
                    : "events"}{" "}
                  found
                </span>
              )}

            </div>

            {/* =================================================
                SEARCH AND FILTERS
            ================================================= */}

            <div className="discovery-controls">

              {/* SEARCH */}

              <div className="discovery-search">

                <label htmlFor="event-search">
                  SEARCH CAMPUS EVENTS
                </label>

                <div className="discovery-search-wrapper">

                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    className="discovery-search-icon"
                    aria-hidden="true"
                  >
                    <circle
                      cx="10.8"
                      cy="10.8"
                      r="6.8"
                    />

                    <path d="M16 16L21 21" />
                  </svg>

                  <input
                    id="event-search"
                    type="search"
                    value={search}
                    onChange={(event) =>
                      changeSearch(event.target.value)
                    }
                    placeholder="Search events, venues, or keywords..."
                    autoComplete="off"
                  />

                  {search && (
                    <button
                      type="button"
                      className="discovery-clear-search"
                      onClick={() => changeSearch("")}
                      aria-label="Clear event search"
                    >
                      ×
                    </button>
                  )}

                </div>

              </div>

              {/* CATEGORY FILTER */}

              <div className="discovery-filters">

                <span id="category-filter-label">
                  EXPLORE BY CATEGORY
                </span>

                <div
                  className="discovery-filter-buttons"
                  role="group"
                  aria-labelledby="category-filter-label"
                >

                  {eventCategories.map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      className={
                        category === item.value
                          ? "discovery-filter-active"
                          : ""
                      }
                      onClick={() =>
                        changeCategory(item.value)
                      }
                      aria-pressed={
                        category === item.value
                      }
                    >
                      {item.label}
                    </button>
                  ))}

                </div>

              </div>

              {/* SORT AND CLEAR */}

              <div className="discovery-toolbar">

                <div className="discovery-sort">

                  <label htmlFor="event-sort">
                    Sort by
                  </label>

                  <select
                    id="event-sort"
                    value={sortBy}
                    onChange={(event) =>
                      setSortBy(event.target.value)
                    }
                  >
                    <option value="soonest">
                      Date: Soonest
                    </option>

                    <option value="latest">
                      Date: Latest
                    </option>

                    <option value="availability">
                      Most seats available
                    </option>
                  </select>

                </div>

                {hasFilters && (
                  <button
                    type="button"
                    className="discovery-reset-filters"
                    onClick={clearFilters}
                  >
                    Clear all filters
                    <span aria-hidden="true">↺</span>
                  </button>
                )}

              </div>

            </div>

            {/* =================================================
                LOADING STATE
            ================================================= */}

            {loading && (
              <div
                className="discovery-loading-grid"
                role="status"
                aria-label="Loading upcoming events"
              >
                {[1, 2, 3].map((item) => (
                  <div
                    className="discovery-skeleton"
                    key={item}
                  >
                    <div className="discovery-skeleton-art" />

                    <div className="discovery-skeleton-body">
                      <span />
                      <strong />
                      <p />
                      <p />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* =================================================
                ERROR STATE
            ================================================= */}

            {!loading && error && (
              <div
                className="discovery-message"
                role="alert"
              >
                <span className="discovery-message-icon">
                  !
                </span>

                <h3>
                  We couldn't load the events.
                </h3>

                <p>{error}</p>

                <button
                  type="button"
                  onClick={() =>
                    window.location.reload()
                  }
                  className="discovery-action-button"
                >
                  Try again ↗
                </button>
              </div>
            )}

            {/* =================================================
                EMPTY STATE
            ================================================= */}

            {!loading &&
              !error &&
              filteredEvents.length === 0 && (

                <div className="discovery-message">

                  <span className="discovery-message-icon">
                    ✳
                  </span>

                  <h3>
                    {events.length === 0
                      ? "Something exciting is coming."
                      : "No events match your search."}
                  </h3>

                  <p>
                    {events.length === 0
                      ? "There are no upcoming published events yet. Check back when organizers announce something new."
                      : "Try another keyword or explore a different category."}
                  </p>

                  {hasFilters && (
                    <button
                      type="button"
                      className="discovery-action-button"
                      onClick={clearFilters}
                    >
                      Explore all events →
                    </button>
                  )}

                </div>
              )}

            {/* =================================================
                EVENTS GRID
            ================================================= */}

            {!loading &&
              !error &&
              filteredEvents.length > 0 && (

                <div className="discovery-event-grid">

                  {filteredEvents.map((event, index) => (
                    <EventCard
                      key={event.id}
                      event={event}
                      index={index}
                    />
                  ))}

                </div>
              )}

            {/* BOTTOM NAVIGATION */}

            <div className="discovery-bottom-link">
              <Link to="/">
                ← Back to EventHub
              </Link>
            </div>

          </div>

        </section>

      </main>
    </>
  );
}