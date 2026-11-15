import { useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router";

import { useAuth } from "../context/AuthContext";

export default function Navbar() {
  const { user, loading, logout } = useAuth();
  const location = useLocation();

  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");

  // Close mobile navigation when the page changes.
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname, location.hash]);

  // Change navbar shadow when scrolling.
  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 16);
    };

    onScroll();

    window.addEventListener("scroll", onScroll, {
      passive: true,
    });

    return () => {
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  // Allow Escape to close the mobile menu.
  useEffect(() => {
    if (!menuOpen) return;

    const onEscape = (event) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    };

    window.addEventListener("keydown", onEscape);

    return () => {
      window.removeEventListener("keydown", onEscape);
    };
  }, [menuOpen]);

  async function handleLogout() {
    setLoggingOut(true);
    setLogoutError("");

    try {
      await logout();
      setMenuOpen(false);
    } catch (error) {
      setLogoutError(
        error.message || "Unable to log out."
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

        {/* BRAND */}

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

        {/* MOBILE MENU BUTTON */}

        <button
          className="nav-menu-toggle"
          type="button"
          aria-expanded={menuOpen}
          aria-controls="eventhub-nav-panel"
          aria-label={
            menuOpen ? "Close menu" : "Open menu"
          }
          onClick={() => {
            setMenuOpen((value) => !value);
          }}
        >
          <span />
          <span />
          <span />
        </button>

        {/* NAVIGATION PANEL */}

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
              className={({ isActive }) =>
                isActive ? "nav-active" : ""
              }
            >
              Home
            </NavLink>

            <NavLink
              to="/events"
              className={({ isActive }) =>
                isActive ? "nav-active" : ""
              }
            >
              Explore Events
            </NavLink>

            <Link to="/#about">
              About
            </Link>

            {/* ORGANIZER NAVIGATION */}

            {!loading && user?.is_organizer && (
              <Link to="/organizer">
                Organizer Dashboard
              </Link>
            )}

          </nav>

          {/* ACCOUNT ACTIONS */}

          <div className="nav-actions">

            {loading ? (
              <span className="nav-label">
                Loading...
              </span>
            ) : user ? (
              <>

                <span className="nav-username">
                  Hi, {user.username}
                </span>

                {/* STUDENT ONLY */}

                {!user.is_organizer && (
                  <Link
                    to="/my-registrations"
                    className="nav-my-registrations"
                  >
                    My Registrations
                  </Link>
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