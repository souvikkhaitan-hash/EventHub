import { useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router";

import { useAuth } from "../context/AuthContext";
import NotificationBell from "./NotificationBell";

export default function Navbar() {
  const { user, loading, logout } = useAuth();
  const location = useLocation();

  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");

  const isOrganizer = Boolean(user?.is_organizer);
  const canReviewOrganizers = Boolean(
    user?.can_review_organizers
  );

  const isStudent =
    Boolean(user) &&
    !isOrganizer &&
    !canReviewOrganizers;

  function getNavClass({ isActive }) {
    return isActive ? "nav-active" : "";
  }

  // Close the mobile menu after navigation.
  useEffect(() => {
    setMenuOpen(false);
    setLogoutError("");
  }, [
    location.pathname,
    location.search,
    location.hash,
  ]);

  // Update the navbar appearance when scrolling.
  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 16);
    }

    onScroll();

    window.addEventListener("scroll", onScroll, {
      passive: true,
    });

    return () => {
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  // Support closing the mobile menu with Escape.
  useEffect(() => {
    if (!menuOpen) return;

    function onEscape(event) {
      if (event.key === "Escape") {
        setMenuOpen(false);

        document
          .getElementById("eventhub-menu-toggle")
          ?.focus();
      }
    }

    window.addEventListener("keydown", onEscape);

    return () => {
      window.removeEventListener("keydown", onEscape);
    };
  }, [menuOpen]);

  async function handleLogout() {
    if (loggingOut) return;

    setLoggingOut(true);
    setLogoutError("");

    try {
      await logout();
      setMenuOpen(false);
    } catch (error) {
      setLogoutError(
        error?.message ||
          "Unable to log out. Please try again."
      );
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <header
      className={`site-header ${
        scrolled ? "site-header-scrolled" : ""
      }`}
    >
      <div className="container navbar">
        <Link
          to="/"
          className="brand"
          aria-label="EventHub home"
        >
          <img
            src="/eventhub-logo.svg"
            alt=""
            className="brand-logo"
          />

          <span className="brand-name">
            EventHub
          </span>
        </Link>
        <NotificationBell />

        <button
          id="eventhub-menu-toggle"
          className="nav-menu-toggle"
          type="button"
          aria-expanded={menuOpen}
          aria-controls="eventhub-nav-panel"
          aria-label={
            menuOpen ? "Close menu" : "Open menu"
          }
          onClick={() => {
            setMenuOpen((previous) => !previous);
          }}
        >
          <span aria-hidden="true" />
          <span aria-hidden="true" />
          <span aria-hidden="true" />
        </button>

        <div
          id="eventhub-nav-panel"
          className={`nav-panel ${
            menuOpen ? "nav-panel-open" : ""
          }`}
        >
          <nav
            className="nav-links"
            aria-label="Main navigation"
          >
            <NavLink
              to="/"
              end
              className={getNavClass}
            >
              Home
            </NavLink>

            <NavLink
              to="/events"
              className={getNavClass}
            >
              Explore Events
            </NavLink>

            <Link to="/#about">
              About
            </Link>

            {!loading && !user && (
              <NavLink
                to="/organizer/login"
                className={getNavClass}
              >
                For organizers
              </NavLink>
            )}

            {!loading && isOrganizer && (
              <NavLink
                to="/organizer"
                className={getNavClass}
              >
                Organizer Dashboard
              </NavLink>
            )}

            {!loading && canReviewOrganizers && (
              <NavLink
                to="/admin/applications"
                className={getNavClass}
              >
                Admin Workspace
              </NavLink>
            )}
          </nav>

          <div className="nav-actions">
            {loading ? (
              <span
                className="nav-label"
                role="status"
              >
                Loading...
              </span>
            ) : user ? (
              <>
                <span className="nav-username">
                  Hi, {user.username}
                </span>

                <NavLink
                  to="/account/profile"
                  className={getNavClass}
                >
                  My Profile
                </NavLink>

                {isStudent && (
                  <>
                  <NavLink
  to="/organizer/workspace"
  className={getNavClass}
>
  Event staff workspace
</NavLink>
                    <NavLink
                      to="/become-organizer"
                      className={getNavClass}
                    >
                      Become an organizer
                    </NavLink>

                    <NavLink
                      to="/my-registrations"
                      className={({ isActive }) =>
                        [
                          "nav-my-registrations",
                          isActive ? "nav-active" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")
                      }
                    >
                      My Registrations
                    </NavLink>
                  </>
                )}

                <button
                  type="button"
                  className="nav-logout-button"
                  disabled={loggingOut}
                  onClick={handleLogout}
                >
                  {loggingOut
                    ? "Signing out..."
                    : "Logout"}
                </button>
              </>
            ) : (
              <>
                <Link
                  to="/login"
                  className="nav-login-link"
                >
                  Log in
                </Link>

                <Link
                  to="/register"
                  className="nav-register-button"
                >
                  Get started
                  <span aria-hidden="true">
                    ↗
                  </span>
                </Link>
              </>
            )}
          </div>

          {logoutError && (
            <p
              className="nav-error"
              role="alert"
            >
              {logoutError}
            </p>
          )}
        </div>
      </div>
    </header>
  );
}