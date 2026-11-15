import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  Link,
  useParams,
} from "react-router";

import {
  getOrganizerEventTeams,
  getOrganizerAttendance,
} from "../services/events";

import "../styles/organizer.css";
import "../styles/organizer-v2.css";
import "../styles/organizerTeams.css";


// ============================================================
// ERROR HANDLING
// ============================================================

function getErrorMessage(error) {
  return (
    error?.details?.message ||
    error?.details?.detail ||
    error?.message ||
    "Unable to load teams."
  );
}


// ============================================================
// TEAM STATUS LABELS
// ============================================================

function getStatusLabel(status) {
  const labels = {
    forming: "Forming",
    confirmed: "Confirmed",
    withdrawn: "Withdrawn",
  };

  return labels[status] || status;
}


// ============================================================
// MAIN COMPONENT
// ============================================================

export default function OrganizerTeams() {
  const { id } = useParams();


  // ==========================================================
  // STATE
  // ==========================================================

  const [data, setData] = useState(null);

  const [attendance, setAttendance] = useState([]);

  const [loading, setLoading] = useState(true);

  const [error, setError] = useState("");

  const [attendanceError, setAttendanceError] =
    useState("");

  const [search, setSearch] = useState("");

  const [filter, setFilter] = useState("all");

  const [expandedTeams, setExpandedTeams] = useState({});


  // ==========================================================
  // LOAD TEAM AND ATTENDANCE DATA
  // ==========================================================

  const loadTeams = useCallback(async () => {
    setLoading(true);
    setError("");
    setAttendanceError("");

    try {
      // Fetch team information and attendance.
      // Both APIs verify organizer ownership.

      const [teamsResult, attendanceResult] =
        await Promise.allSettled([
          getOrganizerEventTeams(id),
          getOrganizerAttendance(id),
        ]);

      // Team data is required for this page.
      if (teamsResult.status === "rejected") {
        throw teamsResult.reason;
      }

      setData(teamsResult.value);

      // Attendance errors should not hide team data.
      if (attendanceResult.status === "fulfilled") {
        setAttendance(
          attendanceResult.value.attendance || []
        );
      } else {
        setAttendance([]);
        setAttendanceError(
          getErrorMessage(attendanceResult.reason)
        );
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [id]);


  // ==========================================================
  // INITIAL LOAD
  // ==========================================================

  useEffect(() => {
    let active = true;

    async function initialize() {
      setLoading(true);
      setError("");
      setAttendanceError("");
      setData(null);
      setAttendance([]);
      setExpandedTeams({});

      try {
        const [teamsResult, attendanceResult] =
          await Promise.allSettled([
            getOrganizerEventTeams(id),
            getOrganizerAttendance(id),
          ]);

        if (!active) return;

        if (teamsResult.status === "rejected") {
          throw teamsResult.reason;
        }

        setData(teamsResult.value);

        if (attendanceResult.status === "fulfilled") {
          setAttendance(
            attendanceResult.value.attendance || []
          );
        } else {
          setAttendanceError(
            getErrorMessage(attendanceResult.reason)
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

    initialize();

    return () => {
      active = false;
    };
  }, [id]);


  // ==========================================================
  // TEAM DATA
  // ==========================================================

  const teams = useMemo(
    () => data?.teams || [],
    [data]
  );


  // ==========================================================
  // ACTIVE TEAMS
  // ==========================================================

  const activeTeams = useMemo(
    () =>
      teams.filter(
        (team) => team.status !== "withdrawn"
      ),
    [teams]
  );


  // ==========================================================
  // TEAM STATISTICS
  // ==========================================================

  const confirmedTeams = activeTeams.filter(
    (team) => team.status === "confirmed"
  );

  const formingTeams = activeTeams.filter(
    (team) => team.status === "forming"
  );

  const totalMembers = activeTeams.reduce(
    (total, team) =>
      total + (team.members?.length || 0),
    0
  );


  // ==========================================================
  // ATTENDANCE LOOKUP
  // ==========================================================

  /*
   * The attendance API returns individual records:
   *
   * {
   *   student_username: "souvik",
   *   attendance_status: "present"
   * }
   *
   * We connect these records with team members.
   */

  const attendanceLookup = useMemo(() => {
    const lookup = new Map();

    for (const record of attendance) {
      lookup.set(
        record.student_username,
        record.attendance_status === "present"
      );
    }

    return lookup;
  }, [attendance]);


  // ==========================================================
  // OVERALL TEAM ATTENDANCE
  // ==========================================================

  const checkedInMembers = activeTeams.reduce(
    (total, team) => {
      const present = (team.members || []).filter(
        (member) =>
          attendanceLookup.get(member.username) === true
      ).length;

      return total + present;
    },
    0
  );


  // ==========================================================
  // SEARCH AND FILTER
  // ==========================================================

  const filteredTeams = useMemo(() => {
    const query = search.trim().toLowerCase();

    return teams.filter((team) => {
      const matchesStatus =
        filter === "all" ||
        team.status === filter;

      const matchesSearch =
        !query ||
        team.name.toLowerCase().includes(query) ||
        (team.leader_username || "")
          .toLowerCase()
          .includes(query) ||
        (team.members || []).some((member) =>
          (member.username || "")
            .toLowerCase()
            .includes(query)
        );

      return matchesStatus && matchesSearch;
    });
  }, [teams, search, filter]);


  // ==========================================================
  // EXPAND / COLLAPSE TEAM ROSTER
  // ==========================================================

  function toggleTeam(teamId) {
    setExpandedTeams((previous) => ({
      ...previous,
      [teamId]: !previous[teamId],
    }));
  }


  // ==========================================================
  // PAGE
  // ==========================================================

  return (
    <div className="organizer-teams-page">

      {/* BACK LINK */}

      <Link
        to={`/organizer/events/${id}/participants`}
        className="organizer-back-link"
      >
        ← Back to Participants
      </Link>


      {/* ====================================================
          HEADER
      ==================================================== */}

      <section className="org-teams-header">

        <div>

          <span className="org-eyebrow">
            TEAM MANAGEMENT
          </span>

          <h1>
            Better
            <br />
            <span>together.</span>
          </h1>

          <p>
            Manage teams, review members,
            and track group attendance
            throughout your event.
          </p>

          {data?.event && (

            <div className="org-teams-event-name">
              ✳ {data.event.title}
            </div>

          )}

        </div>


        {/* HEADER ACTIONS */}

        <div className="org-teams-header-actions">

          <button
            type="button"
            className="org-teams-refresh"
            onClick={loadTeams}
            disabled={loading}
          >
            {loading
              ? "Refreshing..."
              : "↻ Refresh"}
          </button>

          <Link
            to={`/organizer/events/${id}/attendance`}
            className="org-teams-attendance-link"
          >
            Attendance Scanner ↗
          </Link>

        </div>

      </section>


      {/* ====================================================
          ERRORS
      ==================================================== */}

      {error && (

        <div
          className="organizer-error"
          role="alert"
        >
          {error}
        </div>

      )}

      {attendanceError && !error && (

        <div
          className="organizer-error"
          role="alert"
        >
          Team information loaded, but attendance
          statistics could not be retrieved.
          {" "}
          {attendanceError}
        </div>

      )}


      {/* ====================================================
          LOADING
      ==================================================== */}

      {loading && !data && (

        <div
          className="organizer-loading"
          role="status"
        >
          Loading registered teams...
        </div>

      )}


      {/* ====================================================
          MAIN DASHBOARD
      ==================================================== */}

      {data && (

        <>

          {/* ================================================
              STATISTICS
          ================================================ */}

          <div className="org-teams-stats">


            {/* ACTIVE TEAMS */}

            <div className="org-teams-stat-card">

              <span>
                TOTAL ACTIVE TEAMS
              </span>

              <strong>
                {activeTeams.length}
              </strong>

              <p>
                Maximum {data.event.max_teams}
                {" "}teams allowed
              </p>

            </div>


            {/* CONFIRMED TEAMS */}

            <div className="org-teams-stat-card org-teams-stat-blue">

              <span>
                CONFIRMED TEAMS
              </span>

              <strong>
                {confirmedTeams.length}
              </strong>

              <p>
                Teams with locked rosters
              </p>

            </div>


            {/* FORMING TEAMS */}

            <div className="org-teams-stat-card org-teams-stat-lime">

              <span>
                FORMING TEAMS
              </span>

              <strong>
                {formingTeams.length}
              </strong>

              <p>
                Teams still recruiting members
              </p>

            </div>


            {/* TOTAL TEAM MEMBERS */}

            <div className="org-teams-stat-card">

              <span>
                TEAM MEMBERS
              </span>

              <strong>
                {totalMembers}
              </strong>

              <p>
                Students in active teams
              </p>

            </div>

          </div>


          {/* ================================================
              TEAM ATTENDANCE OVERVIEW
          ================================================ */}

          <div className="org-teams-info">

            <span aria-hidden="true">
              ✳
            </span>

            <p>
              Each team requires at least{" "}
              <strong>
                {data.event.min_team_size}
              </strong>{" "}
              members and allows up to{" "}
              <strong>
                {data.event.max_team_size}
              </strong>{" "}
              members.

              Confirmed teams have locked rosters.

              {!attendanceError && (
                <>
                  {" "}
                  Across all active teams,{" "}
                  <strong>
                    {checkedInMembers} of {totalMembers}
                  </strong>{" "}
                  members have checked in.
                </>
              )}
            </p>

          </div>


          {/* ================================================
              TEAM LIST SECTION
          ================================================ */}

          <section className="org-teams-section">

            <div className="org-teams-section-heading">

              <div>

                <span className="org-eyebrow">
                  PARTICIPATING TEAMS
                </span>

                <h2>
                  Meet the teams.
                </h2>

                <p>
                  Review registrations, attendance,
                  and individual team members.
                </p>

              </div>

              <span className="org-teams-count">
                {filteredTeams.length} teams
              </span>

            </div>


            {/* ==============================================
                SEARCH AND STATUS FILTER
            ============================================== */}

            <div className="org-teams-controls">

              <input
                type="search"
                value={search}
                onChange={(event) =>
                  setSearch(event.target.value)
                }
                placeholder="Search team or student..."
                aria-label="Search teams"
              />


              <div className="org-teams-filters">

                {[
                  ["all", "All"],
                  ["confirmed", "Confirmed"],
                  ["forming", "Forming"],
                  ["withdrawn", "Withdrawn"],
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


            {/* ==============================================
                EMPTY STATE
            ============================================== */}

            {filteredTeams.length === 0 && (

              <div className="org-teams-empty">

                <span>✳</span>

                <h3>No teams found.</h3>

                <p>
                  {teams.length === 0
                    ? "Teams will appear here when students create them for this event."
                    : "Try changing your search or status filter."}
                </p>

              </div>

            )}


            {/* ==============================================
                TEAM CARDS
            ============================================== */}

            <div className="org-teams-list">

              {filteredTeams.map((team) => {

                const expanded = Boolean(
                  expandedTeams[team.id]
                );

                const members =
                  team.members || [];

                const memberCount =
                  members.length;

                // ------------------------------------------
                // TEAM SIZE PERCENTAGE
                // ------------------------------------------

                const maxTeamSize =
                  Number(data.event.max_team_size) || 1;

                const percentage = Math.min(
                  100,
                  (memberCount / maxTeamSize) * 100
                );


                // ------------------------------------------
                // TEAM ATTENDANCE
                // ------------------------------------------

                const teamPresentCount =
                  members.filter(
                    (member) =>
                      attendanceLookup.get(
                        member.username
                      ) === true
                  ).length;

                const teamAttendancePercentage =
                  memberCount > 0
                    ? Math.round(
                        (teamPresentCount / memberCount) * 100
                      )
                    : 0;


                // ------------------------------------------
                // MINIMUM MEMBERS REQUIREMENT
                // ------------------------------------------

                const minimumMet =
                  memberCount >=
                  Number(data.event.min_team_size);


                return (

                  <article
                    key={team.id}
                    className="org-team-card"
                  >

                    <div className="org-team-card-main">


                      {/* TEAM ICON */}

                      <div className="org-team-icon">
                        {team.name
                          .charAt(0)
                          .toUpperCase()}
                      </div>


                      {/* TEAM INFORMATION */}

                      <div className="org-team-content">


                        {/* NAME AND STATUS */}

                        <div className="org-team-title-row">

                          <h3>
                            {team.name}
                          </h3>

                          <span
                            className={
                              `org-team-status org-team-status-${team.status}`
                            }
                          >
                            {getStatusLabel(
                              team.status
                            )}
                          </span>

                        </div>


                        {/* LEADER */}

                        <p>
                          Led by{" "}
                          <strong>
                            {team.leader_username}
                          </strong>
                        </p>


                        {/* MINIMUM REQUIREMENT */}

                        {team.status === "confirmed" &&
                          minimumMet && (

                            <span className="org-team-minimum-met">
                              ✓ Minimum team requirement met
                            </span>

                          )}


                        {/* ==================================
                            TEAM SIZE
                        ================================== */}

                        <div className="org-team-progress-row">

                          <span>
                            Team size: {memberCount} of{" "}
                            {data.event.max_team_size}
                            {" "}allowed
                          </span>

                          <span>
                            {Math.round(percentage)}%
                          </span>

                        </div>


                        <div className="org-team-progress-track">

                          <div
                            className="org-team-progress-fill"
                            style={{
                              width: `${percentage}%`,
                            }}
                          />

                        </div>


                        {/* ==================================
                            TEAM ATTENDANCE
                        ================================== */}

                        {team.status !== "withdrawn" &&
                          !attendanceError && (

                            <div className="org-team-attendance-summary">

                              <div className="org-team-attendance-heading">

                                <span>
                                  ATTENDANCE
                                </span>

                                <strong>
                                  {teamPresentCount} /{" "}
                                  {memberCount} checked in
                                </strong>

                              </div>


                              <div
                                className="org-team-attendance-track"
                                role="progressbar"
                                aria-label={
                                  `${team.name} attendance`
                                }
                                aria-valuemin={0}
                                aria-valuemax={100}
                                aria-valuenow={
                                  teamAttendancePercentage
                                }
                              >

                                <div
                                  style={{
                                    width:
                                      `${teamAttendancePercentage}%`,
                                  }}
                                />

                              </div>


                              <span className="org-team-attendance-percentage">
                                {teamAttendancePercentage}%
                                {" "}attendance
                              </span>

                            </div>

                          )}

                      </div>


                      {/* VIEW MEMBERS BUTTON */}

                      <button
                        type="button"
                        className="org-team-view-button"
                        onClick={() =>
                          toggleTeam(team.id)
                        }
                        aria-expanded={expanded}
                        aria-controls={
                          `team-roster-${team.id}`
                        }
                      >
                        {expanded
                          ? "Hide Members ↑"
                          : "View Members ↓"}
                      </button>

                    </div>


                    {/* ======================================
                        TEAM ROSTER
                    ====================================== */}

                    {expanded && (

                      <div
                        id={`team-roster-${team.id}`}
                        className="org-team-roster"
                      >

                        <h4>
                          Team roster
                        </h4>


                        <div className="org-team-roster-list">

                          {members.map((member) => {

                            const isPresent =
                              attendanceLookup.get(
                                member.username
                              ) === true;

                            return (

                              <div
                                className="org-team-roster-member"
                                key={member.id}
                              >

                                <div className="org-team-member-avatar">
                                  {(member.username || "")
                                    .charAt(0)
                                    .toUpperCase()}
                                </div>


                                {/* MEMBER NAME */}

                                <strong>
                                  {member.username}
                                </strong>


                                {/* ATTENDANCE STATUS */}

                                {team.status !== "withdrawn" &&
                                  !attendanceError && (

                                    <span
                                      className={
                                        isPresent
                                          ? "org-team-member-leader"
                                          : "org-team-member-role"
                                      }
                                    >
                                      {isPresent
                                        ? "Present"
                                        : "Pending"}
                                    </span>

                                  )}


                                {/* TEAM ROLE */}

                                <span
                                  className={
                                    member.role === "leader"
                                      ? "org-team-member-leader"
                                      : "org-team-member-role"
                                  }
                                >
                                  {member.role === "leader"
                                    ? "Leader"
                                    : "Member"}
                                </span>

                              </div>

                            );
                          })}

                        </div>

                      </div>

                    )}

                  </article>

                );
              })}

            </div>

          </section>

        </>

      )}

    </div>
  );
}