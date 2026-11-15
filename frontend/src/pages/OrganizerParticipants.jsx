import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";

import {
  getOrganizerParticipants,
  getOrganizerEventTeams,
} from "../services/events";

import "../styles/organizer.css";
import "../styles/organizer-v2.css";


// ============================================================
// DATE FORMATTER
// ============================================================

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
    minute: "2-digit",
    hour: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(date);
}


// ============================================================
// MAIN COMPONENT
// ============================================================

export default function OrganizerParticipants() {
  const { id } = useParams();

  // ----------------------------------------------------------
  // STATE
  // ----------------------------------------------------------

  const [data, setData] = useState(null);
  const [teams, setTeams] = useState([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [teamError, setTeamError] = useState("");

  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");


  // ==========================================================
  // LOAD PARTICIPANTS AND TEAM INFORMATION
  // ==========================================================

  useEffect(() => {
    let active = true;

    async function loadParticipants() {
      setLoading(true);
      setError("");
      setTeamError("");

      setData(null);
      setTeams([]);

      try {
        // Load participant records.
        const result = await getOrganizerParticipants(id);

        if (!active) return;

        setData(result);

        // Team data is only needed for team events.
        if (result.event?.registration_mode === "team") {
          try {
            const teamResponse =
              await getOrganizerEventTeams(id);

            if (active) {
              setTeams(teamResponse.teams || []);
            }
          } catch (err) {
            if (active) {
              setTeamError(
                err.message ||
                  "Unable to load team information."
              );
            }
          }
        }
      } catch (err) {
        if (active) {
          setError(
            err.message ||
              "Unable to load participants."
          );
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadParticipants();

    return () => {
      active = false;
    };
  }, [id]);


  // ==========================================================
  // PARTICIPANT DATA
  // ==========================================================

  const participants = useMemo(
    () => data?.participants || [],
    [data]
  );

  const isTeamEvent =
    data?.event?.registration_mode === "team";


  // ==========================================================
  // TEAM MEMBER LOOKUP
  // ==========================================================

  /*
   * The team endpoint returns teams containing their members.
   *
   * We create a lookup using student usernames so that
   * each participant can be connected to a team.
   *
   * Example:
   *
   * souvik -> Code Warriors, Leader
   * rahul_sen -> Code Warriors, Member
   *
   * Withdrawn teams are excluded from active membership.
   */

  const teamMemberLookup = useMemo(() => {
    const lookup = new Map();

    for (const team of teams) {
      if (team.status === "withdrawn") {
        continue;
      }

      for (const member of team.members || []) {
        lookup.set(member.username, {
          teamId: team.id,
          teamName: team.name,
          teamStatus: team.status,
          role: member.role,
        });
      }
    }

    return lookup;
  }, [teams]);


  // ==========================================================
  // SEARCH AND FILTER
  // ==========================================================

  const filteredParticipants = useMemo(() => {
    const query = search.trim().toLowerCase();

    return participants.filter((participant) => {
      const username =
        participant.student_username || "";

      const teamInfo = teamMemberLookup.get(username);

      const matchesStatus =
        filter === "all" ||
        participant.status === filter;

      const matchesSearch =
        !query ||
        username.toLowerCase().includes(query) ||
        (teamInfo?.teamName || "")
          .toLowerCase()
          .includes(query);

      return matchesStatus && matchesSearch;
    });
  }, [
    participants,
    filter,
    search,
    teamMemberLookup,
  ]);


  // ==========================================================
  // LOADING
  // ==========================================================

  if (loading) {
    return (
      <div
        className="organizer-loading"
        role="status"
      >
        Loading participants...
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
        <p>{error}</p>

        <Link to="/organizer">
          Return to Dashboard →
        </Link>
      </div>
    );
  }

  if (!data) return null;


  // ==========================================================
  // REGISTRATION STATISTICS
  // ==========================================================

  const capacity = Number(data.event.capacity || 0);

  const registered = Number(
    data.statistics?.registered || 0
  );

  const available = Number(
    data.statistics?.available_seats || 0
  );

  const utilization =
    capacity > 0
      ? Math.min(
          100,
          (registered / capacity) * 100
        )
      : 0;


  // ==========================================================
  // PAGE
  // ==========================================================

  return (
    <div className="organizer-participants-page organizer-v2">

      {/* BACK LINK */}

      <Link
        to="/organizer"
        className="organizer-back-link"
      >
        ← Back to Dashboard
      </Link>


      {/* ====================================================
          HERO
      ==================================================== */}

      <section className="org-participants-hero">

        <div>

          <span className="org-eyebrow">
            THE PEOPLE BEHIND THE EXPERIENCE
          </span>

          <h1>
            Your event.
            <br />
            <span>Your people.</span>
          </h1>

          <p>{data.event.title}</p>

        </div>


        {/* ACTION BUTTONS */}

        <div className="org-participants-actions">

          <Link
            to={`/organizer/events/${id}/attendance`}
            className="org-button-primary"
          >
            ▣ Attendance Scanner ↗
          </Link>

          {isTeamEvent && (
            <Link
              to={`/organizer/events/${id}/teams`}
              className="org-button-outline"
            >
              View Teams →
            </Link>
          )}

          <Link
            to={`/organizer/events/${id}/edit`}
            className="org-button-outline"
          >
            Manage Event →
          </Link>

        </div>

      </section>


      {/* ====================================================
          REGISTRATION STATISTICS
      ==================================================== */}

      <section
        className="org-stats-grid org-participants-stats"
        aria-label="Registration statistics"
      >

        {/* EVENT CAPACITY */}

        <article className="org-stat-card">

          <div className="org-stat-top">
            <span>EVENT CAPACITY</span>
            <span>◎</span>
          </div>

          <strong>{capacity}</strong>

          <p>Total available places</p>

        </article>


        {/* REGISTERED */}

        <article className="org-stat-card org-stat-blue">

          <div className="org-stat-top">
            <span>REGISTERED</span>
            <span>↗</span>
          </div>

          <strong>{registered}</strong>

          <p>Active student registrations</p>

        </article>


        {/* AVAILABLE */}

        <article className="org-stat-card org-stat-lime">

          <div className="org-stat-top">
            <span>SEATS REMAINING</span>
            <span>✳</span>
          </div>

          <strong>{available}</strong>

          <p>Available for students</p>

        </article>

      </section>


      {/* ====================================================
          REGISTRATION CAPACITY
      ==================================================== */}

      <section className="org-capacity-panel">

        <div className="org-capacity-heading">

          <div>

            <span className="org-eyebrow">
              REGISTRATION CAPACITY
            </span>

            <h2>Filling up.</h2>

            <p>
              {registered} of {capacity} seats reserved
            </p>

          </div>

          <strong>
            {utilization.toFixed(1)}%
          </strong>

        </div>


        <div
          className="org-capacity-track"
          role="progressbar"
          aria-label="Registration capacity utilization"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Number(utilization.toFixed(1))}
        >
          <div
            style={{
              width: `${utilization}%`,
            }}
          />
        </div>

      </section>


      {/* ====================================================
          TEAM INFORMATION NOTICE
      ==================================================== */}

      {isTeamEvent && (

        <div className="org-teams-info">

          <span aria-hidden="true">✳</span>

          <p>
            <strong>Team-based event.</strong>{" "}
            Students register individually through
            their teams.

            Team leaders and members are shown
            below.

            Visit{" "}
            <Link
              to={`/organizer/events/${id}/teams`}
            >
              View Teams
            </Link>{" "}
            to review complete team rosters.
          </p>

        </div>

      )}


      {/* TEAM DATA ERROR */}

      {teamError && (
        <div
          className="organizer-error"
          role="alert"
        >
          <p>
            Participant records loaded, but team
            information could not be retrieved:
            {" "}
            {teamError}
          </p>
        </div>
      )}


      {/* ====================================================
          PARTICIPANT MANAGEMENT
      ==================================================== */}

      <section className="org-participant-list-section">

        <div className="org-section-heading">

          <div>

            <span className="org-eyebrow">
              PARTICIPANT MANAGEMENT
            </span>

            <h2>Who's joining?</h2>

            <p>
              {isTeamEvent
                ? "Search students, teams, and registration records."
                : "Search and manage your registration records."}
            </p>

          </div>

          <span className="org-count-badge">
            {participants.length} records
          </span>

        </div>


        {/* ==================================================
            SEARCH AND FILTER
        ================================================== */}

        <div className="org-events-toolbar">

          <label className="org-search">

            <span className="org-visually-hidden">
              Search participants
            </span>

            <span aria-hidden="true">
              ⌕
            </span>

            <input
              type="search"
              placeholder={
                isTeamEvent
                  ? "Search student or team..."
                  : "Search student username..."
              }
              value={search}
              onChange={(event) =>
                setSearch(event.target.value)
              }
            />

          </label>


          <div
            className="org-filter-group"
            role="group"
            aria-label="Filter participants"
          >

            {[
              ["all", "All"],
              ["registered", "Registered"],
              ["cancelled", "Cancelled"],
            ].map(([value, label]) => (

              <button
                key={value}
                type="button"
                className={
                  filter === value ? "active" : ""
                }
                onClick={() => setFilter(value)}
                aria-pressed={filter === value}
              >
                {label}
              </button>

            ))}

          </div>

        </div>


        {/* ==================================================
            EMPTY STATE
        ================================================== */}

        {filteredParticipants.length === 0 ? (

          <div className="org-empty">

            <span>◎</span>

            <h3>No participants found.</h3>

            <p>
              {participants.length === 0
                ? "Students will appear here when they register for this event."
                : "Try changing your search or status filter."}
            </p>

          </div>

        ) : (

          /* ================================================
              PARTICIPANT TABLE
          ================================================ */

          <div className="org-participant-table-wrapper">

            <table className="org-participant-table">

              {/* TABLE HEADINGS */}

              <thead>

                <tr>

                  <th>STUDENT</th>

                  {isTeamEvent && (
                    <>
                      <th>TEAM</th>
                      <th>TEAM ROLE</th>
                    </>
                  )}

                  <th>REGISTERED AT</th>

                  <th>STATUS</th>

                  <th>CANCELLED AT</th>

                </tr>

              </thead>


              {/* TABLE BODY */}

              <tbody>

                {filteredParticipants.map((participant) => {

                  const username =
                    participant.student_username || "";

                  const teamInfo =
                    participant.status === "registered"
                      ? teamMemberLookup.get(username)
                      : null;

                  return (

                    <tr key={participant.id}>

                      {/* STUDENT */}

                      <td>

                        <div className="org-student-cell">

                          <div className="org-student-avatar">
                            {username
                              .charAt(0)
                              .toUpperCase()}
                          </div>

                          <strong>
                            {username}
                          </strong>

                        </div>

                      </td>


                      {/* TEAM NAME */}

                      {isTeamEvent && (

                        <td>

                          {teamInfo ? (

                            <Link
                              to={`/organizer/events/${id}/teams`}
                              className="org-participant-team-link"
                            >
                              {teamInfo.teamName}
                            </Link>

                          ) : (

                            <span className="org-participant-no-team">
                              —
                            </span>

                          )}

                        </td>

                      )}


                      {/* TEAM ROLE */}

                      {isTeamEvent && (

                        <td>

                          {teamInfo ? (

                            <span
                              className={
                                `org-participant-role org-participant-role-${teamInfo.role}`
                              }
                            >
                              {teamInfo.role === "leader"
                                ? "Leader"
                                : "Member"}
                            </span>

                          ) : (

                            <span className="org-participant-no-team">
                              —
                            </span>

                          )}

                        </td>

                      )}


                      {/* REGISTRATION DATE */}

                      <td>
                        {formatDate(
                          participant.registered_at
                        )}
                      </td>


                      {/* STATUS */}

                      <td>

                        <span
                          className={
                            `org-status org-status-${participant.status}`
                          }
                        >
                          {participant.status}
                        </span>

                      </td>


                      {/* CANCELLATION DATE */}

                      <td>
                        {formatDate(
                          participant.cancelled_at
                        )}
                      </td>

                    </tr>

                  );
                })}

              </tbody>

            </table>

          </div>

        )}

      </section>

    </div>
  );
}