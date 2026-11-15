import { useEffect, useState } from "react";
import { Link } from "react-router";

import {
  getOrganizerAnalytics,
  getEventRegistrationGrowth,
} from "../services/events";

import "../styles/organizer.css";
import "../styles/analytics.css";
import "../styles/analytics-v2.css";


// ============================================================
// HELPER FUNCTIONS
// ============================================================

function formatPercentage(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}


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


// Format a date-only string without timezone shifting.
function formatChartDate(value) {
  if (!value) return "—";

  const [year, month, day] = value.split("-").map(Number);

  const date = new Date(year, month - 1, day);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
  });
}


// Display readable API errors.
function getErrorMessage(error) {
  return (
    error?.details?.message ||
    error?.details?.detail ||
    error?.message ||
    "Something went wrong. Please try again."
  );
}


// ============================================================
// EVENT REGISTRATION GROWTH COMPONENT
// ============================================================

function RegistrationGrowth({ events }) {
  const [selectedEventId, setSelectedEventId] = useState(
    events.length > 0 ? String(events[0].id) : ""
  );

  const [growthData, setGrowthData] = useState(null);

  const [loading, setLoading] = useState(false);

  const [error, setError] = useState("");


  // ==========================================================
  // LOAD SELECTED EVENT'S REGISTRATION GROWTH
  // ==========================================================

  useEffect(() => {
    if (!selectedEventId) {
      setGrowthData(null);
      setLoading(false);
      return;
    }

    let active = true;

    async function loadGrowth() {
      setLoading(true);
      setError("");
      setGrowthData(null);

      try {
        const response = await getEventRegistrationGrowth(
          selectedEventId
        );

        if (active) {
          setGrowthData(response);
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

    loadGrowth();

    return () => {
      active = false;
    };
  }, [selectedEventId]);


  // ==========================================================
  // EMPTY ORGANIZER STATE
  // ==========================================================

  if (events.length === 0) {
    return (
      <section className="analytics-trends-section">
        <div className="organizer-section-heading">
          <div>
            <span className="organizer-eyebrow">
              REGISTRATION ACTIVITY
            </span>

            <h2>Registration Growth</h2>
          </div>
        </div>

        <div className="organizer-empty-state">
          <h3>No events available.</h3>

          <p>
            Create and publish an event to start
            tracking registration growth.
          </p>

          <Link
            to="/organizer/events/new"
            className="organizer-primary-button"
          >
            Create Event →
          </Link>
        </div>
      </section>
    );
  }


  // ==========================================================
  // PREPARE GROWTH DATA
  // ==========================================================

  const growth = Array.isArray(growthData?.growth)
    ? growthData.growth
    : [];

  const summary = growthData?.summary || {};

  const period = growthData?.registration_period || {};

  const event = growthData?.event || {};

  const registered = Number(summary.registered) || 0;

  const capacity = Number(event.capacity) || 0;

  const availableSeats =
    Number(summary.available_seats) || 0;

  const maximumRegistrations = Math.max(
    1,
    ...growth.map(
      (day) =>
        Number(day.cumulative_registrations) || 0
    )
  );

  // Single-day data should have a compact presentation.
  const isSingleDay = growth.length === 1;

  const isLegacyEvent =
    period.start_source ===
    "first_recorded_registration";


  // ==========================================================
  // RENDER
  // ==========================================================

  return (
    <section className="analytics-trends-section">

      {/* Heading */}

      <div className="organizer-section-heading">
        <div>
          <span className="organizer-eyebrow">
            REGISTRATION ACTIVITY
          </span>

          <h2>Registration Growth</h2>
        </div>

        <span className="organizer-event-count">
          Event-specific analytics
        </span>
      </div>


      <div className="analytics-trends-card">

        {/* ================================================
            EVENT SELECTOR
        ================================================ */}

        <div className="analytics-event-selector">

          <div>
            <label htmlFor="analytics-event-select">
              SELECT EVENT
            </label>

            <select
              id="analytics-event-select"
              value={selectedEventId}
              onChange={(event) => {
                setSelectedEventId(event.target.value);
              }}
            >
              {events.map((event) => (
                <option
                  value={event.id}
                  key={event.id}
                >
                  {event.title}
                </option>
              ))}
            </select>
          </div>

          <span className="analytics-selector-caption">
            Explore registration activity
            for your events.
          </span>

        </div>


        {/* Loading */}

        {loading && (
          <div
            className="analytics-growth-message"
            role="status"
          >
            Loading registration growth...
          </div>
        )}


        {/* Error */}

        {!loading && error && (
          <div
            className="analytics-growth-error"
            role="alert"
          >
            {error}
          </div>
        )}


        {/* Growth Information */}

        {!loading && !error && growthData && (
          <>

            {/* ============================================
                REGISTRATION PERIOD
            ============================================ */}

            <div className="analytics-period-info">

              <div>
                <span>REGISTRATION START</span>

                <strong>
                  {period.published_at
                    ? formatDate(period.published_at)
                    : period.chart_start
                    ? formatChartDate(
                        period.chart_start
                      )
                    : "Not available"}
                </strong>

                {isLegacyEvent && (
                  <small>
                    First recorded active registration
                  </small>
                )}
              </div>


              <div>
                <span>REGISTRATION DEADLINE</span>

                <strong>
                  {formatDate(
                    period.registration_deadline
                  )}
                </strong>
              </div>


              <div>
                <span>EVENT CAPACITY</span>

                <strong>{capacity}</strong>
              </div>

            </div>


            {/* ============================================
                METRIC CARDS
            ============================================ */}

            <div className="analytics-growth-metrics">

              <article>
                <span>ACTIVE REGISTRATIONS</span>

                <strong>{registered}</strong>

                <p>Currently registered students</p>
              </article>


              <article>
                <span>AVAILABLE SEATS</span>

                <strong>{availableSeats}</strong>

                <p>Remaining event capacity</p>
              </article>


              <article>
                <span>CAPACITY UTILIZATION</span>

                <strong>
                  {formatPercentage(
                    summary.capacity_utilization
                  )}
                </strong>

                <p>Seats currently reserved</p>
              </article>

            </div>


            {/* ============================================
                SINGLE-DAY REGISTRATION ACTIVITY
            ============================================ */}

            {isSingleDay && (
              <div className="analytics-single-day">

                <div className="analytics-single-day-date">
                  <span>RECORDED REGISTRATION ACTIVITY</span>

                  <strong>
                    {formatChartDate(growth[0].date)}
                  </strong>
                </div>

                <div className="analytics-single-day-value">
                  <strong>
                    {growth[0].daily_registrations}
                  </strong>

                  <span>
                    Active registrations recorded
                    on this date
                  </span>
                </div>

                <div className="analytics-single-day-progress">
                  <div
                    style={{
                      width: `${Math.min(
                        100,
                        Math.max(
                          0,
                          Number(
                            summary.capacity_utilization
                          ) || 0
                        )
                      )}%`,
                    }}
                  />
                </div>

                <p>
                  This event currently has one day of
                  recorded registration activity.
                </p>

              </div>
            )}


            {/* ============================================
                MULTI-DAY REGISTRATION GROWTH
            ============================================ */}

            {growth.length > 1 && (
              <>

                <div className="analytics-growth-chart-heading">

                  <div>
                    <h3>Registration activity</h3>

                    <p>
                      Daily registrations and cumulative
                      active registrations.
                    </p>
                  </div>

                  <div className="analytics-growth-legend">
                    <span className="analytics-legend-daily">
                      Daily
                    </span>

                    <span className="analytics-legend-total">
                      Cumulative
                    </span>
                  </div>

                </div>


                <div
                  className="analytics-chart-scroll"
                  role="region"
                  aria-label="Event registration growth chart"
                  tabIndex={0}
                >

                  <div
                    className="analytics-growth-chart"
                    style={{
                      gridTemplateColumns:
                        `repeat(${growth.length}, ` +
                        `minmax(44px, 1fr))`,

                      minWidth: `${Math.max(
                        620,
                        growth.length * 56
                      )}px`,
                    }}
                  >

                    {growth.map((day) => {

                      const daily =
                        Number(
                          day.daily_registrations
                        ) || 0;

                      const cumulative =
                        Number(
                          day.cumulative_registrations
                        ) || 0;

                      const dailyHeight =
                        (daily /
                          maximumRegistrations) *
                        100;

                      const cumulativeHeight =
                        (cumulative /
                          maximumRegistrations) *
                        100;

                      return (
                        <div
                          className="analytics-growth-column"
                          key={day.date}
                        >

                          <span className="analytics-growth-count">
                            {cumulative}
                          </span>


                          <div className="analytics-growth-bar-area">

                            <div
                              className="analytics-growth-bar-total"
                              style={{
                                height:
                                  `${cumulativeHeight}%`,
                              }}
                              title={
                                `${formatChartDate(day.date)}: ` +
                                `${cumulative} cumulative`
                              }
                            />


                            <div
                              className="analytics-growth-bar-daily"
                              style={{
                                height:
                                  `${dailyHeight}%`,
                              }}
                              title={
                                `${formatChartDate(day.date)}: ` +
                                `${daily} daily`
                              }
                            />

                          </div>


                          <span className="analytics-growth-date">
                            {formatChartDate(day.date)}
                          </span>

                        </div>
                      );
                    })}

                  </div>

                </div>

              </>
            )}


            {/* ============================================
                NO RECORDED ACTIVITY
            ============================================ */}

            {growth.length === 0 && (
              <div className="analytics-growth-message">
                <h3>No registration history available.</h3>

                <p>
                  Registration activity will appear
                  once students register for this event.
                </p>
              </div>
            )}


            {/* ============================================
                HISTORICAL DATA EXPLANATION
            ============================================ */}

            <p className="analytics-growth-note">

              {isLegacyEvent
                ? "This event was published before publication timestamps were introduced. The chart begins with the earliest recorded active registration."
                : period.published_at
                ? "The chart begins on the event's recorded publication date."
                : "An exact publication date is not available for this event."}

              {" "}The values represent currently active
              registrations grouped by their latest
              registration date. They are not a complete
              historical record of cancellations or
              previous seat occupancy.

            </p>

          </>
        )}

      </div>

    </section>
  );
}


// ============================================================
// MAIN ORGANIZER ANALYTICS PAGE
// ============================================================

export default function OrganizerAnalytics() {
  const [data, setData] = useState(null);

  const [loading, setLoading] = useState(true);

  const [error, setError] = useState("");


  // ==========================================================
  // LOAD ORGANIZER OVERVIEW ANALYTICS
  // ==========================================================

  useEffect(() => {
    let active = true;

    async function loadAnalytics() {
      setLoading(true);
      setError("");

      try {
        const response = await getOrganizerAnalytics();

        if (active) {
          setData(response);
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

    loadAnalytics();

    return () => {
      active = false;
    };
  }, []);


  // ==========================================================
  // LOADING
  // ==========================================================

  if (loading) {
    return (
      <div
        className="organizer-loading"
        role="status"
      >
        Loading analytics...
      </div>
    );
  }


  // ==========================================================
  // ERROR
  // ==========================================================

  if (error) {
    return (
      <div
        className="organizer-error"
        role="alert"
      >
        <h3>Unable to load analytics.</h3>

        <p>{error}</p>

        <Link to="/organizer">
          ← Return to Dashboard
        </Link>
      </div>
    );
  }


  if (!data) {
    return null;
  }


  // ==========================================================
  // PREPARE ANALYTICS
  // ==========================================================

  const summary = data.summary || {};

  const events = Array.isArray(data.events)
    ? data.events
    : [];

  const categories = Array.isArray(data.categories)
    ? data.categories
    : [];


  // ==========================================================
  // RENDER
  // ==========================================================

  return (
    <div className="organizer-analytics-page">

      {/* Back */}

      <Link
        to="/organizer"
        className="organizer-back-link"
      >
        ← Back to Dashboard
      </Link>


      {/* Heading */}

      <div className="organizer-page-heading">
        <div>
          <span className="organizer-eyebrow">
            EVENT PERFORMANCE
          </span>

          <h1>
            Know your
            <br />
            <span>impact.</span>
          </h1>

          <p>
            Understand registrations, attendance,
            and engagement across your events.
          </p>
        </div>
      </div>


      {/* ====================================================
          SUMMARY CARDS
      ==================================================== */}

      <section className="analytics-summary-grid">

        <article className="analytics-summary-card">
          <span>TOTAL EVENTS</span>

          <strong>
            {summary.total_events ?? 0}
          </strong>

          <p>Events you've created</p>
        </article>


        <article className="analytics-summary-card analytics-blue">
          <span>REGISTRATIONS</span>

          <strong>
            {summary.total_registrations ?? 0}
          </strong>

          <p>Active registrations</p>
        </article>


        <article className="analytics-summary-card analytics-lime">
          <span>CHECKED IN</span>

          <strong>
            {summary.total_checked_in ?? 0}
          </strong>

          <p>Verified attendees</p>
        </article>


        <article className="analytics-summary-card">
          <span>ATTENDANCE RATE</span>

          <strong>
            {formatPercentage(
              summary.attendance_rate
            )}
          </strong>

          <p>Of active registrations</p>
        </article>

      </section>


      {/* ====================================================
          SECONDARY ANALYTICS
      ==================================================== */}

      <div className="analytics-secondary-grid">

        <article className="analytics-metric-panel">
          <span>CAPACITY UTILIZATION</span>

          <strong>
            {formatPercentage(
              summary.capacity_utilization
            )}
          </strong>

          <div
            className="analytics-progress-track"
            role="progressbar"
            aria-label="Capacity utilization"
            aria-valuenow={
              Number(
                summary.capacity_utilization
              ) || 0
            }
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="analytics-progress-fill"
              style={{
                width: `${Math.min(
                  100,
                  Math.max(
                    0,
                    Number(
                      summary.capacity_utilization
                    ) || 0
                  )
                )}%`,
              }}
            />
          </div>

          <p>
            Percentage of available event seats
            currently reserved.
          </p>
        </article>


        <article className="analytics-metric-panel">
          <span>EVENT STATUS</span>

          <div className="analytics-status-list">

            <div>
              <span>Published</span>
              <strong>
                {summary.published_events ?? 0}
              </strong>
            </div>

            <div>
              <span>Draft</span>
              <strong>
                {summary.draft_events ?? 0}
              </strong>
            </div>

            <div>
              <span>Cancelled</span>
              <strong>
                {summary.cancelled_events ?? 0}
              </strong>
            </div>

          </div>
        </article>

      </div>


      {/* ====================================================
          NEW EVENT-SPECIFIC REGISTRATION GROWTH
      ==================================================== */}

      <RegistrationGrowth events={events} />


      {/* ====================================================
          EVENT PERFORMANCE
      ==================================================== */}

      <section className="analytics-events-section">

        <div className="organizer-section-heading">

          <div>
            <span className="organizer-eyebrow">
              EVENT ANALYTICS
            </span>

            <h2>Event Performance</h2>
          </div>

          <span className="organizer-event-count">
            {events.length}{" "}
            {events.length === 1 ? "event" : "events"}
          </span>

        </div>


        {events.length === 0 ? (

          <div className="organizer-empty-state">
            <h3>No events to analyze yet.</h3>

            <p>
              Create and publish an event to start
              collecting analytics.
            </p>

            <Link
              to="/organizer/events/new"
              className="organizer-primary-button"
            >
              Create Event →
            </Link>
          </div>

        ) : (

          <>

            {/* Desktop Table */}

            <div className="organizer-table-wrapper analytics-desktop-table">

              <table className="organizer-events-table">

                <thead>
                  <tr>
                    <th>EVENT</th>
                    <th>DATE</th>
                    <th>REGISTERED</th>
                    <th>CHECKED IN</th>
                    <th>ATTENDANCE</th>
                    <th>UTILIZATION</th>
                  </tr>
                </thead>


                <tbody>

                  {events.map((event) => (

                    <tr key={event.id}>

                      <td>
                        <strong>
                          {event.title}
                        </strong>
                      </td>

                      <td>
                        {formatDate(
                          event.start_datetime
                        )}
                      </td>

                      <td>
                        {event.registered}
                        {" / "}
                        {event.capacity}
                      </td>

                      <td>
                        {event.checked_in}
                      </td>

                      <td>
                        {formatPercentage(
                          event.attendance_rate
                        )}
                      </td>

                      <td>
                        {formatPercentage(
                          event.capacity_utilization
                        )}
                      </td>

                    </tr>

                  ))}

                </tbody>

              </table>

            </div>


            {/* Mobile Cards */}

            <div className="analytics-mobile-events">

              {events.map((event) => (

                <article
                  className="analytics-mobile-event-card"
                  key={event.id}
                >

                  <span className="organizer-eyebrow">
                    {event.category}
                  </span>

                  <h3>
                    {event.title}
                  </h3>

                  <p>
                    {formatDate(
                      event.start_datetime
                    )}
                  </p>


                  <div className="analytics-mobile-event-metrics">

                    <div>
                      <span>REGISTERED</span>

                      <strong>
                        {event.registered}
                        {" / "}
                        {event.capacity}
                      </strong>
                    </div>


                    <div>
                      <span>CHECKED IN</span>

                      <strong>
                        {event.checked_in}
                      </strong>
                    </div>


                    <div>
                      <span>ATTENDANCE</span>

                      <strong>
                        {formatPercentage(
                          event.attendance_rate
                        )}
                      </strong>
                    </div>


                    <div>
                      <span>UTILIZATION</span>

                      <strong>
                        {formatPercentage(
                          event.capacity_utilization
                        )}
                      </strong>
                    </div>

                  </div>

                </article>

              ))}

            </div>

          </>

        )}

      </section>


      {/* ====================================================
          CATEGORIES
      ==================================================== */}

      <section className="analytics-categories-section">

        <div className="organizer-section-heading">

          <div>
            <span className="organizer-eyebrow">
              EVENT DISTRIBUTION
            </span>

            <h2>Categories</h2>
          </div>

        </div>


        {categories.length === 0 ? (

          <div className="organizer-empty-state">

            <h3>No categories available.</h3>

            <p>
              Category statistics will appear
              after creating an event.
            </p>

          </div>

        ) : (

          <div className="analytics-category-grid">

            {categories.map((category) => (

              <article
                className="analytics-category-card"
                key={category.category}
              >

                <span>
                  {category.category.toUpperCase()}
                </span>

                <strong>
                  {category.events}
                </strong>

                <p>
                  {category.events === 1
                    ? "Event created"
                    : "Events created"}
                </p>

              </article>

            ))}

          </div>

        )}

      </section>

    </div>
  );
}