import { useEffect, useState } from "react";

import {
  Link,
  NavLink,
  Navigate,
  Outlet,
  useLocation,
} from "react-router";

import { getCurrentUser } from "../services/events";

import "../styles/organizer.css";
import "../styles/organizer-v2.css";

export default function OrganizerLayout() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [menuOpen, setMenuOpen] = useState(false);

  const location = useLocation();

  // ==========================================
  // VERIFY ORGANIZER
  // ==========================================

  useEffect(() => {
    let active = true;

    async function checkOrganizer() {
      try {
        const currentUser = await getCurrentUser();

        if (active) {
          setUser(currentUser);
        }
      } catch (err) {
        if (active) {
          setError(err.message);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    checkOrganizer();

    return () => {
      active = false;
    };
  }, []);

  // ==========================================
  // CLOSE MOBILE MENU ON NAVIGATION
  // ==========================================

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  // Close menu using Escape key.

  useEffect(() => {
    if (!menuOpen) return;

    function handleEscape(event) {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    }

    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener(
        "keydown",
        handleEscape
      );
    };
  }, [menuOpen]);

  // ==========================================
  // LOADING
  // ==========================================

  if (loading) {
    return (
      <div
        className="organizer-loading"
        role="status"
      >
        Loading your workspace...
      </div>
    );
  }

  // ==========================================
  // AUTHENTICATION
  // ==========================================

  if (!user && !error) {
    return <Navigate to="/login" replace />;
  }

  if (!user && error) {
    return (
      <div className="organizer-access-message">
        <h2>Unable to load your workspace</h2>

        <p>{error}</p>

        <Link to="/">
          Back to home
        </Link>
      </div>
    );
  }

  if (!user.is_organizer) {
    return (
      <div className="organizer-access-message">
        <h2>Organizer access required</h2>

        <p>
          This workspace is available only to
          approved EventHub organizers.
        </p>

        <Link to="/">
          Return to EventHub
        </Link>
      </div>
    );
  }

  // ==========================================
  // NAVIGATION
  // ==========================================

  const navigationItems = [
    {
      to: "/organizer",
      label: "Overview",
      icon: "▦",
      end: true,
    },
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
  ];

  return (
    <div className="organizer-app organizer-v2-layout">

      {/* ======================================
          MOBILE HEADER
      ====================================== */}

      <header className="org-mobile-header">

        <Link
          to="/organizer"
          className="org-mobile-brand"
          onClick={() => setMenuOpen(false)}
        >
          <img
            src="/eventhub-logo.svg"
            alt=""
          />

          <strong>EventHub</strong>
        </Link>

        <button
          type="button"
          className="org-mobile-menu-button"
          aria-label={
            menuOpen
              ? "Close organizer menu"
              : "Open organizer menu"
          }
          aria-expanded={menuOpen}
          aria-controls="organizer-sidebar"
          onClick={() => {
            setMenuOpen((previous) => !previous);
          }}
        >
          <span className="org-menu-line" />
          <span className="org-menu-line" />
          <span className="org-menu-line" />
        </button>

      </header>

      {/* ======================================
          MOBILE BACKDROP
      ====================================== */}

      {menuOpen && (
        <button
          type="button"
          className="org-mobile-backdrop"
          aria-label="Close navigation menu"
          onClick={() => setMenuOpen(false)}
        />
      )}

      {/* ======================================
          SIDEBAR
      ====================================== */}

      <aside
        id="organizer-sidebar"
        className={`organizer-sidebar ${
          menuOpen ? "org-sidebar-open" : ""
        }`}
      >

        <Link
          to="/organizer"
          className="organizer-brand"
          onClick={() => setMenuOpen(false)}
        >
          <img
            src="/eventhub-logo.svg"
            alt=""
          />

          <span>EventHub</span>
        </Link>

        <div className="organizer-workspace-label">
          ORGANIZER WORKSPACE
        </div>

        <nav
          className="organizer-navigation"
          aria-label="Organizer navigation"
        >
          {navigationItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={() => setMenuOpen(false)}
              className={({ isActive }) =>
                isActive
                  ? "organizer-nav-active"
                  : ""
              }
            >
              <span aria-hidden="true">
                {item.icon}
              </span>

              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="organizer-sidebar-bottom">

          <Link
            to="/"
            onClick={() => setMenuOpen(false)}
          >
            ← Back to EventHub
          </Link>

        </div>

      </aside>

      {/* ======================================
          CONTENT
      ====================================== */}

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

              <span>Organizer</span>
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