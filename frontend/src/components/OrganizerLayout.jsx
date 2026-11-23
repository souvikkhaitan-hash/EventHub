import { useEffect, useState } from "react";
import {
  Link,
  NavLink,
  Navigate,
  Outlet,
  useLocation,
} from "react-router";

import { useAuth } from "../context/AuthContext";
import { getOrganizerEvents } from "../services/events";

import "../styles/organizer.css";
import "../styles/organizer-v2.css";
import "../styles/event-staff.css";

export default function OrganizerLayout() {
  const { user, loading } = useAuth();
  const location = useLocation();

  const [menuOpen, setMenuOpen] = useState(false);
  const [retry, setRetry] = useState(0);
  const [access, setAccess] = useState({
    userId: null,
    status: "loading",
    message: "",
  });

  useEffect(() => {
    if (!user || user.is_organizer) return;

    let active = true;

    setAccess({
      userId: user.id,
      status: "loading",
      message: "",
    });

    getOrganizerEvents()
      .then((events) => {
        if (!Array.isArray(events)) {
          throw new Error(
            "The server returned an unexpected workspace response."
          );
        }

        if (active) {
          setAccess({
            userId: user.id,
            status: events.length ? "allowed" : "denied",
            message: "",
          });
        }
      })
      .catch((error) => {
        if (!active) return;

        const denied = [401, 403, 404].includes(error.status);

        setAccess({
          userId: user.id,
          status: denied ? "denied" : "error",
          message: denied
            ? "You do not currently have an event staff assignment."
            : error.message || "Unable to load your workspace.",
        });
      });

    return () => {
      active = false;
    };
  }, [user?.id, user?.is_organizer, retry]);

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (!menuOpen) return;

    function handleEscape(event) {
      if (event.key === "Escape") {
        setMenuOpen(false);
        document.getElementById("workspace-menu-toggle")?.focus();
      }
    }

    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("keydown", handleEscape);
    };
  }, [menuOpen]);

  if (loading) {
    return (
      <div className="organizer-loading" role="status">
        Loading your workspace...
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (
    !user.is_organizer &&
    (access.userId !== user.id || access.status === "loading")
  ) {
    return (
      <div className="organizer-loading" role="status">
        Checking your event assignments...
      </div>
    );
  }

  if (!user.is_organizer && access.status !== "allowed") {
    return (
      <div className="organizer-access-message">
        <h2>
          {access.status === "error"
            ? "Unable to load your workspace"
            : "No event assignment"}
        </h2>

        <p>
          {access.message ||
            "Ask an event owner to add your username to their event staff."}
        </p>

        <button
          type="button"
          onClick={() => setRetry((value) => value + 1)}
        >
          Check again
        </button>

        <p>
          <Link to="/">Return to EventHub</Link>
        </p>
      </div>
    );
  }

  const navigationItems = [
    {
      to: "/organizer",
      label: user.is_organizer ? "Overview" : "My events",
      icon: "▦",
      end: true,
    },
    {
      to: "/organizer/workspace",
      label: "Event access",
      icon: "◇",
      end: false,
    },
    ...(user.is_organizer
      ? [
          {
            to: "/organizer/events/new",
            label: "Create Event",
            icon: "＋",
            end: false,
          },
          {
            to: "/organizer/analytics",
            label: "Analytics",
            icon: "▥",
            end: false,
          },
        ]
      : []),
  ];

  return (
    <div className="organizer-app organizer-v2-layout">
      <header className="org-mobile-header">
        <Link
          to="/organizer"
          className="org-mobile-brand"
          onClick={() => setMenuOpen(false)}
        >
          <img src="/eventhub-logo.svg" alt="" />
          <strong>EventHub</strong>
        </Link>

        <button
          id="workspace-menu-toggle"
          type="button"
          className="org-mobile-menu-button"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
          aria-controls="organizer-sidebar"
          onClick={() => setMenuOpen((value) => !value)}
        >
          <span className="org-menu-line" aria-hidden="true" />
          <span className="org-menu-line" aria-hidden="true" />
          <span className="org-menu-line" aria-hidden="true" />
        </button>
      </header>

      {menuOpen && (
        <button
          type="button"
          className="org-mobile-backdrop"
          aria-label="Close navigation menu"
          onClick={() => setMenuOpen(false)}
        />
      )}

      <aside
        id="organizer-sidebar"
        className={`organizer-sidebar ${
          menuOpen ? "org-sidebar-open" : ""
        }`}
      >
        <Link to="/organizer" className="organizer-brand">
          <img src="/eventhub-logo.svg" alt="" />
          <span>EventHub</span>
        </Link>

        <div className="organizer-workspace-label">
          EVENT WORKSPACE
        </div>

        <nav
          className="organizer-navigation"
          aria-label="Event workspace navigation"
        >
          {navigationItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={() => setMenuOpen(false)}
              className={({ isActive }) =>
                isActive ? "organizer-nav-active" : ""
              }
            >
              <span aria-hidden="true">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="organizer-sidebar-bottom">
          <Link to="/" onClick={() => setMenuOpen(false)}>
            ← Back to EventHub
          </Link>
        </div>
      </aside>

      <div className="organizer-content">
        <header className="organizer-topbar">
          <span className="organizer-topbar-label">
            EVENT MANAGEMENT
          </span>

          <div className="organizer-profile">
            <span className="organizer-profile-avatar">
              {user.username.charAt(0).toUpperCase()}
            </span>

            <div>
              <strong>{user.username}</strong>
              <span>
                {user.is_organizer ? "Organizer" : "Event staff"}
              </span>
            </div>
          </div>
        </header>

        <main className="organizer-main">
          <Outlet context={{ user }} />
        </main>
      </div>
    </div>
  );
}