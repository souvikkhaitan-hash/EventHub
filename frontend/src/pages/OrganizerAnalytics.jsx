import {
  useEffect,
  useId,
  useState,
} from "react";

import { Link } from "react-router";

import {
  getOrganizerAnalytics,
  getEventRegistrationGrowth,
} from "../services/events";

import {
  getCategoryLabel,
} from "../utils/eventFormat";

import "../styles/analytics-editorial.css";

function number(value) {
  return (
    value != null &&
    value !== "" &&
    Number.isFinite(Number(value))
  )
    ? Math.max(0, Number(value))
    : null;
}

function percentage(value) {
  const result = number(value);

  return result === null
    ? "—"
    : `${result.toFixed(1)}%`;
}

function display(value) {
  return number(value) ?? "—";
}

function dateLabel(value, short = false) {
  if (!value) return "—";

  // Interpret date-only API values in the campus timezone.
  const date = new Date(
    /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? `${value}T00:00:00+05:30`
      : value
  );

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    ...(short ? {} : { year: "numeric" }),
    timeZone: "Asia/Kolkata",
  }).format(date);
}

function messageFrom(error) {
  return (
    error?.details?.message ||
    error?.details?.detail ||
    error?.message ||
    "Unable to load analytics."
  );
}

// Daily bars and cumulative line share the same scale.
function RegistrationChart({ growth }) {
  const titleId = useId();

  if (!growth.length) {
    return (
      <div className="ap-empty">
        <h3>No registration activity yet.</h3>

        <p>
          Recorded activity will appear here
          when students register.
        </p>
      </div>
    );
  }

  const width = Math.max(
    420,
    growth.length * 44
  );

  const height = 250;

  const left = 45;
  const right = 22;
  const top = 28;
  const bottom = 40;

  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;

  const maximum = Math.max(
    1,
    ...growth.flatMap((day) => [
      number(day.daily_registrations) || 0,
      number(day.cumulative_registrations) || 0,
    ])
  );

  // Integer tick marks work for both small and large counts.
  const step = Math.max(
    1,
    Math.ceil(maximum / 4)
  );

  const ceiling =
    Math.ceil(maximum / step) * step;

  const ticks = Array.from(
    { length: ceiling / step + 1 },
    (_, index) => index * step
  );

  const slot = plotWidth / growth.length;

  const x = (index) =>
    left + slot * (index + 0.5);

  const y = (value) =>
    top + plotHeight * (1 - value / ceiling);

  const points = growth
    .map(
      (day, index) =>
        `${x(index)},${y(
          number(day.cumulative_registrations) || 0
        )}`
    )
    .join(" ");

  const labelEvery = Math.max(
    1,
    Math.ceil(growth.length / 10)
  );

  return (
    <>
      <div
        className="ap-chart-scroll"
        tabIndex={0}
        role="region"
        aria-label="Registration chart. Scroll horizontally for longer periods."
      >
        <svg
          className="ap-chart"
          viewBox={`0 0 ${width} ${height}`}
          style={{ minWidth: width }}
          role="img"
          aria-labelledby={titleId}
        >
          <title id={titleId}>
            Daily and cumulative current active
            registrations. Exact values are available
            in the data table below.
          </title>

          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={left}
                x2={width - right}
                y1={y(tick)}
                y2={y(tick)}
                stroke="#e1e4ec"
              />

              <text
                x={left - 11}
                y={y(tick) + 4}
                textAnchor="end"
                className="ap-axis-label"
              >
                {tick}
              </text>
            </g>
          ))}

          {growth.map((day, index) => {
            const daily =
              number(day.daily_registrations) || 0;

            const barWidth = Math.min(
              30,
              slot * 0.45
            );

            const showDate =
              index % labelEvery === 0 ||
              index === growth.length - 1;

            return (
              <g key={day.date}>
                <rect
                  className="ap-daily-bar"
                  x={x(index) - barWidth / 2}
                  y={y(daily)}
                  width={barWidth}
                  height={Math.max(
                    0,
                    y(0) - y(daily)
                  )}
                  rx="3"
                >
                  <title>
                    {dateLabel(day.date)}: {daily}
                    {" "}daily registrations
                  </title>
                </rect>

                {showDate && (
                  <text
                    x={x(index)}
                    y={height - 13}
                    textAnchor="middle"
                    className="ap-axis-label"
                  >
                    {dateLabel(day.date, true)}
                  </text>
                )}
              </g>
            );
          })}

          {growth.length > 1 && (
            <polyline
              points={points}
              fill="none"
              stroke="#3659f5"
              strokeWidth="2.5"
              strokeLinejoin="round"
            />
          )}

          {growth.map((day, index) => {
            const cumulative =
              number(
                day.cumulative_registrations
              ) || 0;

            return (
              <g key={day.date}>
                <circle
                  cx={x(index)}
                  cy={y(cumulative)}
                  r="4"
                  fill="#3659f5"
                >
                  <title>
                    {dateLabel(day.date)}:{" "}
                    {cumulative} cumulative registrations
                  </title>
                </circle>

                {growth.length <= 12 && (
                  <text
                    x={x(index)}
                    y={y(cumulative) - 12}
                    textAnchor="middle"
                    className="ap-point-label"
                  >
                    {cumulative}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      <div className="ap-legend">
        <span>
          <i className="ap-legend-daily" />
          Daily registrations
        </span>

        <span>
          <i className="ap-legend-cumulative" />
          Cumulative
        </span>
      </div>

      <details className="ap-chart-data">
        <summary>View chart data</summary>

        <div
          className="ap-table-scroll"
          tabIndex={0}
          role="region"
          aria-label="Exact registration chart data"
        >
          <table>
            <caption className="ap-sr-only">
              Current active registrations
              by registration date
            </caption>

            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Daily</th>
                <th scope="col">Cumulative</th>
              </tr>
            </thead>

            <tbody>
              {growth.map((day) => (
                <tr key={day.date}>
                  <th scope="row">
                    {dateLabel(day.date)}
                  </th>

                  <td>
                    {display(day.daily_registrations)}
                  </td>

                  <td>
                    {display(
                      day.cumulative_registrations
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}

function RegistrationActivity({ events }) {
  const [selection, setSelection] = useState("");
  const [revision, setRevision] = useState(0);

  const eventId = events.some(
    (event) => String(event.id) === selection
  )
    ? selection
    : String(events[0]?.id ?? "");

  const requestKey = `${eventId}:${revision}`;

  const [result, setResult] = useState({
    key: "",
    data: null,
    error: "",
  });

  // Prevent the previous event's data appearing under a new selection.
  const loading =
    Boolean(eventId) &&
    result.key !== requestKey;

  const data =
    loading || result.key !== requestKey
      ? null
      : result.data;

  useEffect(() => {
    if (!eventId) return;

    let active = true;

    getEventRegistrationGrowth(eventId)
      .then((response) => {
        if (
          !response ||
          !Array.isArray(response.growth) ||
          !response.event ||
          !response.summary
        ) {
          throw new Error(
            "The server returned incomplete registration analytics."
          );
        }

        if (active) {
          setResult({
            key: requestKey,
            data: response,
            error: "",
          });
        }
      })
      .catch((error) => {
        if (active) {
          setResult({
            key: requestKey,
            data: null,
            error: messageFrom(error),
          });
        }
      });

    return () => {
      active = false;
    };
  }, [eventId, requestKey]);

  if (!events.length) {
    return (
      <section className="ap-panel ap-empty">
        <h2>No events to analyse yet.</h2>

        <p>
          Create an event to start collecting
          registrations and attendance.
        </p>

        <Link
          className="ap-button"
          to="/organizer/events/new"
        >
          Create event →
        </Link>
      </section>
    );
  }

  const growth = data?.growth || [];
  const period = data?.registration_period || {};
  const summary = data?.summary || {};
  const event = data?.event || {};

  const legacy =
    period.start_source ===
    "first_recorded_registration";

  return (
    <div className="ap-activity-grid">
      <section
        className="ap-panel ap-registration-panel"
        aria-busy={loading}
      >
        <div className="ap-chart-heading">
          <div>
            <h2>Registration activity</h2>

            <p>
              Current active registrations
              by registration date.
            </p>
          </div>

          <div className="ap-selector">
            <label htmlFor="ap-event">
              Select event
            </label>

            <select
              id="ap-event"
              value={eventId}
              onChange={(event) =>
                setSelection(event.target.value)
              }
            >
              {events.map((event) => (
                <option
                  key={event.id}
                  value={event.id}
                >
                  {event.title}
                </option>
              ))}
            </select>
          </div>
        </div>

        {loading ? (
          <div className="ap-empty" role="status">
            Loading registration activity…
          </div>
        ) : result.error ? (
          <div className="ap-empty" role="alert">
            <p>{result.error}</p>

            <button
              className="ap-button"
              onClick={() =>
                setRevision((value) => value + 1)
              }
            >
              Try again
            </button>
          </div>
        ) : data && (
          <>
            <RegistrationChart growth={growth} />

            <p className="ap-chart-note">
              Current active registrations grouped
              by their latest registration date;
              not a complete history of cancellations
              or previous seat occupancy.{" "}

              {legacy
                ? "Legacy event: the chart starts at the first recorded active registration."
                : period.published_at
                  ? "The chart starts on the recorded publication date."
                  : "An exact publication date is unavailable."}
            </p>
          </>
        )}
      </section>

      <aside
        className="ap-panel ap-snapshot"
        aria-busy={loading}
      >
        <h2>Event snapshot</h2>

        {loading ? (
          <p className="ap-muted" role="status">
            Loading selected event…
          </p>
        ) : data ? (
          <>
            <h3>
              {event.title ||
                events.find(
                  (item) =>
                    String(item.id) === eventId
                )?.title}
            </h3>

            <dl>
              <div>
                <dt>Registration deadline</dt>
                <dd>
                  {dateLabel(
                    period.registration_deadline
                  )}
                </dd>
              </div>

              <div>
                <dt>
                  {legacy
                    ? "First active registration"
                    : "Registration start"}
                </dt>

                <dd>
                  {dateLabel(
                    period.published_at ||
                    period.chart_start
                  )}
                </dd>
              </div>

              <div>
                <dt>Capacity</dt>
                <dd>{display(event.capacity)}</dd>
              </div>

              <div>
                <dt>Active registrations</dt>
                <dd>
                  {display(summary.registered)}
                </dd>
              </div>

              <div>
                <dt>Available seats</dt>
                <dd>
                  {display(summary.available_seats)}
                </dd>
              </div>

              <div>
                <dt>Occupancy</dt>
                <dd>
                  {percentage(
                    summary.capacity_utilization
                  )}
                </dd>
              </div>
            </dl>

            {number(
              summary.capacity_utilization
            ) !== null && (
              <progress
                value={Math.min(
                  100,
                  number(
                    summary.capacity_utilization
                  )
                )}
                max="100"
                aria-label="Selected event capacity utilisation"
              />
            )}
          </>
        ) : (
          <p className="ap-muted">
            The selected event’s snapshot
            is unavailable.
          </p>
        )}
      </aside>
    </div>
  );
}

export default function OrganizerAnalytics() {
  const [revision, setRevision] = useState(0);

  const [result, setResult] = useState({
    revision: -1,
    data: null,
    error: "",
  });

  const loading =
    result.revision !== revision;

  useEffect(() => {
    let active = true;

    getOrganizerAnalytics()
      .then((data) => {
        if (
          !data?.summary ||
          !Array.isArray(data.events) ||
          !Array.isArray(data.categories)
        ) {
          throw new Error(
            "The server returned incomplete analytics."
          );
        }

        if (active) {
          setResult({
            revision,
            data,
            error: "",
          });
        }
      })
      .catch((error) => {
        if (active) {
          setResult({
            revision,
            data: null,
            error: messageFrom(error),
          });
        }
      });

    return () => {
      active = false;
    };
  }, [revision]);

  const data = result.data;
  const summary = data?.summary || {};
  const events = data?.events || [];
  const categories = data?.categories || [];

  const categoryTotal = categories.reduce(
    (total, item) =>
      total + (number(item.events) || 0),
    0
  );

  return (
    <div className="ap-page">
      <Link
        className="ap-back"
        to="/organizer"
      >
        ← Back to Dashboard
      </Link>

      <header className="ap-heading">
        <h1>
          Know your <span>impact.</span>
        </h1>

        <p>
          Registrations, attendance and capacity
          across your events.
        </p>
      </header>

      {loading ? (
        <div
          className="ap-panel ap-empty"
          role="status"
        >
          Loading analytics…
        </div>
      ) : result.error ? (
        <div
          className="ap-panel ap-empty"
          role="alert"
        >
          <h2>Unable to load analytics.</h2>

          <p>{result.error}</p>

          <button
            className="ap-button"
            onClick={() =>
              setRevision((value) => value + 1)
            }
          >
            Try again
          </button>
        </div>
      ) : (
        <>
          <section
            className="ap-kpis"
            aria-label="Overall event metrics"
          >
            {[
              [
                "Total events",
                display(summary.total_events),
                "",
              ],
              [
                "Active registrations",
                display(
                  summary.total_registrations
                ),
                "blue",
              ],
              [
                "Checked in",
                display(summary.total_checked_in),
                "lime",
              ],
              [
                "Attendance rate",
                percentage(
                  summary.attendance_rate
                ),
                "",
              ],
            ].map(
              ([label, value, accent], index) => (
                <article
                  className={`ap-kpi ${
                    accent
                      ? `ap-kpi--${accent}`
                      : ""
                  }`}
                  key={label}
                  style={{
                    "--ap-index": index,
                  }}
                >
                  <span>{label}</span>
                  <strong>{value}</strong>
                </article>
              )
            )}
          </section>

          <RegistrationActivity events={events} />

          <section className="ap-panel ap-performance">
            <div className="ap-section-heading">
              <h2>Event performance</h2>

              <span>
                {events.length}{" "}
                {events.length === 1
                  ? "event"
                  : "events"}
              </span>
            </div>

            {!events.length ? (
              <p className="ap-muted">
                Event performance will appear
                here after you create an event.
              </p>
            ) : (
              <div
                className="ap-table-scroll"
                tabIndex={0}
                role="region"
                aria-label="Event performance table"
              >
                <table>
                  <caption className="ap-sr-only">
                    Registrations, attendance and
                    utilisation for each event
                  </caption>

                  <thead>
                    <tr>
                      {[
                        "Event",
                        "Date",
                        "Registered",
                        "Checked in",
                        "Attendance",
                        "Utilisation",
                      ].map((label) => (
                        <th
                          scope="col"
                          key={label}
                        >
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>

                  <tbody>
                    {events.map((event) => (
                      <tr key={event.id}>
                        <th scope="row">
                          {event.title}
                        </th>

                        <td>
                          {dateLabel(
                            event.start_datetime
                          )}
                        </td>

                        <td>
                          {display(event.registered)}
                          {" / "}
                          {display(event.capacity)}
                        </td>

                        <td>
                          {display(event.checked_in)}
                        </td>

                        <td>
                          {percentage(
                            event.attendance_rate
                          )}
                        </td>

                        <td>
                          {percentage(
                            event.capacity_utilization
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <div className="ap-bottom-grid">
            <section className="ap-panel ap-status">
              <h2>Event status</h2>

              <dl>
                {[
                  [
                    "Published",
                    summary.published_events,
                  ],
                  [
                    "Draft",
                    summary.draft_events,
                  ],
                  [
                    "Cancelled",
                    summary.cancelled_events,
                  ],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{display(value)}</dd>
                  </div>
                ))}
              </dl>

              <div className="ap-overall-capacity">
                <span>
                  Overall capacity utilisation
                </span>

                <strong>
                  {percentage(
                    summary.capacity_utilization
                  )}
                </strong>
              </div>
            </section>

            <section className="ap-panel ap-categories">
              <h2>Categories</h2>

              <p>Events created by category.</p>

              {categories.length ? (
                <ul>
                  {categories.map((item) => (
                    <li key={item.category}>
                      <span>
                        {getCategoryLabel(
                          item.category
                        )}
                      </span>

                      <div
                        className="ap-category-track"
                        aria-hidden="true"
                      >
                        <div
                          style={{
                            width: `${
                              categoryTotal
                                ? (
                                    (number(item.events) || 0) /
                                    categoryTotal
                                  ) * 100
                                : 0
                            }%`,
                          }}
                        />
                      </div>

                      <strong>
                        {display(item.events)}
                      </strong>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="ap-muted">
                  No category data yet.
                </p>
              )}
            </section>
          </div>
        </>
      )}

      <footer className="ap-footer">
        Show up. Stand out.
      </footer>
    </div>
  );
}