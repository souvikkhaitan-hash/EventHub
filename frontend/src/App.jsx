import { useEffect, useState } from "react";

import {
  Link,
  Route,
  Routes,
  useLocation,
} from "react-router";

import Navbar from "./components/Navbar";
import HomeSections, { CampusHeroArtwork } from "./components/HomeSections";

import Login from "./pages/Login";
import Register from "./pages/Register";

import OrganizerLayout from "./components/OrganizerLayout";
import OrganizerDashboard from "./pages/OrganizerDashboard";
import EventForm from "./pages/EventForm";

import ExploreEvents from "./pages/ExploreEvents";
import EventDetails from "./pages/EventDetails";

import MyRegistrations from "./pages/MyRegistrations";
import StudentTicket from "./pages/StudentTicket";

import OrganizerParticipants from "./pages/OrganizerParticipants";
import OrganizerTeams from "./pages/OrganizerTeams";
import OrganizerAttendance from "./pages/OrganizerAttendance";
import OrganizerAnalytics from "./pages/OrganizerAnalytics";

import "./App.css";
import "./styles/auth.css";
import "./styles/home-v2.css";
import "./styles/home-editorial.css";
import OrganizerCertificates from "./pages/OrganizerCertificates";
import VerifyCertificate from "./pages/VerifyCertificate";

// ============================================================
// SCROLL TO PAGE SECTION
// ============================================================

function ScrollToSection() {
  const location = useLocation();

  useEffect(() => {
    if (!location.hash) {
      window.scrollTo(0, 0);
      return;
    }

    const sectionId = decodeURIComponent(
      location.hash.slice(1)
    );

    requestAnimationFrame(() => {
      const section = document.getElementById(
        sectionId
      );

      if (section) {
        const prefersReducedMotion = window.matchMedia(
          "(prefers-reduced-motion: reduce)"
        ).matches;

        section.scrollIntoView({
          behavior: prefersReducedMotion
            ? "instant"
            : "smooth",
        });
      }
    });
  }, [location.pathname, location.hash]);

  return null;
}


// ============================================================
// HERO POSTER ARTWORK
// ============================================================

function PosterArtwork() {
  return <CampusHeroArtwork />;
}

// ============================================================
// FOOTER
// ============================================================

function Footer() {
  return (
    <footer
      className="site-footer"
      id="about"
    >

      <div className="container">

        <div className="footer-main">

          {/* BRAND */}

          <div className="footer-brand">

            <Link
              to="/"
              className="footer-logo"
            >
              <img
                src="/eventhub-logo.svg"
                alt="EventHub Logo"
                className="footer-brand-logo"
              />

              EventHub
            </Link>

            <p>
              Making campus life a little more
              exciting, one event at a time.
            </p>

          </div>

          {/* FOOTER LINKS */}

          <div className="footer-links">

            <div>
              <h3>Explore</h3>

              <Link to="/events">
                Explore events
              </Link>

              <Link to="/#how-it-works">
                How it works
              </Link>
            </div>

            <div>
              <h3>Account</h3>

              <Link to="/login">
                Sign in
              </Link>

              <Link to="/register">
                Get started
              </Link>
            </div>

          </div>

        </div>

        <div className="footer-bottom">

          <span>© 2026 EventHub</span>

          <span>
            COLLEGE EVENT REGISTRATION & MANAGEMENT
          </span>

          <span>
            MADE FOR CAMPUS LIFE ✳
          </span>

        </div>

      </div>

    </footer>
  );
}


// ============================================================
// BACK TO TOP BUTTON
// ============================================================

function BackToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    function handleScroll() {
      setVisible(window.scrollY > 500);
    }

    handleScroll();

    window.addEventListener("scroll", handleScroll, {
      passive: true,
    });

    return () => {
      window.removeEventListener(
        "scroll",
        handleScroll
      );
    };
  }, []);

  function scrollToTop() {
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    window.scrollTo({
      top: 0,
      behavior: reducedMotion
        ? "instant"
        : "smooth",
    });
  }

  if (!visible) {
    return null;
  }

  return (
    <button
      type="button"
      className="back-to-top"
      onClick={scrollToTop}
      aria-label="Back to top"
      title="Back to top"
    >
      ↑
    </button>
  );
}


// ============================================================
// HOME PAGE
// ============================================================

function Home() {

  // Reveal sections as the visitor scrolls.
  useEffect(() => {
    const main = document.querySelector(
      ".home-v2"
    );

    if (!main) return;

    const sections = main.querySelectorAll(
      "[data-reveal]"
    );

    if (
      !("IntersectionObserver" in window) ||
      window.matchMedia(
        "(prefers-reduced-motion: reduce)"
      ).matches
    ) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add(
              "is-visible"
            );

            observer.unobserve(entry.target);
          }
        });
      },
      {
        threshold: 0.08,
      }
    );

    main.classList.add("reveal-ready");

    sections.forEach((section) => {
      observer.observe(section);
    });

    return () => {
      observer.disconnect();
      main.classList.remove("reveal-ready");
    };
  }, []);

  return (
    <>
      <Navbar />

      <main className="home-v2 eh-home">

        {/* ================================================
            HERO SECTION
        ================================================ */}

        <section
          className="home-hero"
          id="home"
        >

          <div className="container hero-layout">

            <div className="hero-copy">

              <div className="hero-eyebrow">
                <span className="eyebrow-dot" />
                THE CAMPUS CULTURE PLATFORM
              </div>

              <h1>
                <span className="hero-line hero-line-one">
                  SHOW UP.
                </span>

                <span className="hero-line hero-outlined hero-line-two">
                  STAND
                </span>

                <span className="hero-line hero-highlight hero-line-three">
                  OUT.
                </span>
              </h1>

              <p className="hero-description">
                The best parts of college don't
                happen in a classroom. Discover
                events, meet your people, and make
                every moment count.
              </p>

              <div className="hero-actions">

                <Link
                  to="/events"
                  className="hero-primary-button"
                >
                  Explore Events

                  <span aria-hidden="true">
                    ↗
                  </span>
                </Link>

                <Link
                  to="/#how-it-works"
                  className="hero-secondary-button"
                >
                  How it works

                  <span aria-hidden="true">
                    ↗
                  </span>
                </Link>

              </div>

              <div className="hero-bottom-label">
                <span>
                  BUILT FOR THE CURIOUS.
                </span>

                <span>
                  MADE FOR THE BOLD.
                </span>
              </div>

            </div>

            <PosterArtwork />

          </div>

        </section>


        <HomeSections />

      </main>

      <Footer />
      <BackToTop />
    </>
  );
}


// ============================================================
// APPLICATION ROUTES
// ============================================================

function App() {
  return (
    <>
      <ScrollToSection />

      <Routes>

        {/* PUBLIC ROUTES */}

        <Route
          path="/"
          element={<Home />}
        />

        <Route
          path="/login"
          element={<Login />}
        />

        <Route
          path="/register"
          element={<Register />}
        />

        <Route
          path="/events"
          element={<ExploreEvents />}
        />

        <Route
          path="/events/:id"
          element={<EventDetails />}
        />
        <Route
          path="/certificates/verify/:certificateId"
          element={<VerifyCertificate />}
        />


        {/* STUDENT ROUTES */}

        <Route
          path="/my-registrations"
          element={<MyRegistrations />}
        />

        <Route
          path="/my-registrations/:registrationId/ticket"
          element={<StudentTicket />}
        />


        {/* ORGANIZER WORKSPACE */}

        <Route
          path="/organizer"
          element={<OrganizerLayout />}
        >

          <Route
            index
            element={<OrganizerDashboard />}
          />

          <Route
            path="events/new"
            element={<EventForm />}
          />

          <Route
            path="events/:id/edit"
            element={<EventForm />}
          />

          <Route
            path="events/:id/participants"
            element={<OrganizerParticipants />}
          />
          <Route
            path="events/:id/teams"
            element={<OrganizerTeams />}
          />

          <Route
            path="events/:id/attendance"
            element={<OrganizerAttendance />}
          />
          <Route
            path="events/:id/certificates"
            element={<OrganizerCertificates />}
          />

          <Route
            path="analytics"
            element={<OrganizerAnalytics />}
          />

        </Route>



        {/* FALLBACK */}

        <Route
          path="*"
          element={<Home />}
        />

      </Routes>
    </>
  );
}

export default App;