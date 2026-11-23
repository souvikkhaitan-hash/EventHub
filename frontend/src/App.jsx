import {
  lazy,
  Suspense,
  useEffect,
  useState,
} from "react";

import {
  Link,
  Route,
  Routes,
  useLocation,
} from "react-router";

import Navbar from "./components/Navbar";

import HomeSections, {
  CampusHeroArtwork,
} from "./components/HomeSections";

import EventAccessGate, {
  OrganizerOnly,
} from "./components/EventAccessGate";

import EventPromotionLink from "./components/EventPromotionLink";

import "./App.css";
import "./styles/auth.css";
import "./styles/home-v2.css";
import "./styles/home-editorial.css";

// Feature pages load when needed.

const Login = lazy(() => import("./pages/Login"));
const Register = lazy(() => import("./pages/Register"));

const OrganizerLayout = lazy(
  () => import("./components/OrganizerLayout")
);

const EventForm = lazy(
  () => import("./pages/EventForm")
);

const ExploreEvents = lazy(
  () => import("./pages/ExploreEvents")
);

const EventDetails = lazy(
  () => import("./pages/EventDetails")
);

const MyRegistrations = lazy(
  () => import("./pages/MyRegistrations")
);

const StudentTicket = lazy(
  () => import("./pages/StudentTicket")
);

const OrganizerParticipants = lazy(
  () => import("./pages/OrganizerParticipants")
);

const OrganizerTeams = lazy(
  () => import("./pages/OrganizerTeams")
);

const OrganizerAttendance = lazy(
  () => import("./pages/OrganizerAttendance")
);

const OrganizerAnalytics = lazy(
  () => import("./pages/OrganizerAnalytics")
);

const OrganizerCertificates = lazy(
  () => import("./pages/OrganizerCertificates")
);

const OrganizerCommunication = lazy(
  () => import("./pages/OrganizerCommunication")
);

const OrganizerPromotion = lazy(
  () => import("./pages/OrganizerPromotion")
);

const VerifyCertificate = lazy(
  () => import("./pages/VerifyCertificate")
);

const AccountProfile = lazy(
  () => import("./pages/AccountProfile")
);

const ForgotPassword = lazy(
  () => import("./pages/ForgotPassword")
);

const ResetPassword = lazy(
  () => import("./pages/ResetPassword")
);

const OrganizerApplication = lazy(
  () => import("./pages/OrganizerApplication")
);

const AdminLogin = lazy(
  () => import("./pages/AdminLogin")
);

const AdminApplications = lazy(
  () => import("./pages/AdminApplications")
);

const EventStaff = lazy(
  () => import("./pages/EventStaff")
);

const EventWorkspace = lazy(
  () => import("./pages/EventWorkspace")
);

const WorkspaceHome = lazy(() =>
  import("./pages/EventWorkspace").then((module) => ({
    default: module.WorkspaceHome,
  }))
);

const EventWorkspaceDetail = lazy(() =>
  import("./pages/EventWorkspace").then((module) => ({
    default: module.EventWorkspaceDetail,
  }))
);

const EventCommunicationLink = lazy(() =>
  import("./components/EventCommunication").then(
    (module) => ({
      default: module.EventCommunicationLink,
    })
  )
);

// Separate boundaries keep the organiser layout visible
// while a child page's code loads.
function Page({ children }) {
  return (
    <Suspense
      fallback={
        <div
          role="status"
          aria-live="polite"
          style={{
            padding: "32px",
            color: "#64718a",
          }}
        >
          Loading page…
        </div>
      }
    >
      {children}
    </Suspense>
  );
}

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

    const frame = requestAnimationFrame(() => {
      const section =
        document.getElementById(sectionId);

      if (!section) return;

      const reducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)"
      ).matches;

      section.scrollIntoView({
        behavior: reducedMotion
          ? "instant"
          : "smooth",
      });
    });

    return () => cancelAnimationFrame(frame);
  }, [location.pathname, location.hash]);

  return null;
}

function Footer() {
  return (
    <footer className="site-footer" id="about">
      <div className="container">
        <div className="footer-main">
          <div className="footer-brand">
            <Link to="/" className="footer-logo">
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
              <Link to="/login">Sign in</Link>
              <Link to="/register">Get started</Link>
            </div>
          </div>
        </div>

        <div className="footer-bottom">
          <span>© 2026 EventHub</span>

          <span>
            COLLEGE EVENT REGISTRATION & MANAGEMENT
          </span>

          <span>MADE FOR CAMPUS LIFE ✳</span>
        </div>
      </div>
    </footer>
  );
}

function BackToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    function handleScroll() {
      setVisible(window.scrollY > 500);
    }

    handleScroll();

    window.addEventListener(
      "scroll",
      handleScroll,
      { passive: true }
    );

    return () => {
      window.removeEventListener(
        "scroll",
        handleScroll
      );
    };
  }, []);

  if (!visible) return null;

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

function Home() {
  useEffect(() => {
    const main =
      document.querySelector(".home-v2");

    if (!main) return;

    const sections =
      main.querySelectorAll("[data-reveal]");

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
      { threshold: 0.08 }
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
        <section className="home-hero" id="home">
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
                  <span aria-hidden="true">↗</span>
                </Link>

                <Link
                  to="/#how-it-works"
                  className="hero-secondary-button"
                >
                  How it works
                  <span aria-hidden="true">↗</span>
                </Link>
              </div>

              <div className="hero-bottom-label">
                <span>BUILT FOR THE CURIOUS.</span>
                <span>MADE FOR THE BOLD.</span>
              </div>
            </div>

            <CampusHeroArtwork />
          </div>
        </section>

        <HomeSections />
      </main>

      <Footer />
      <BackToTop />
    </>
  );
}

export default function App() {
  return (
    <>
      <ScrollToSection />

      <Routes>
        {/* Public */}

        <Route path="/" element={<Home />} />

        <Route
          path="/events"
          element={
            <Page><ExploreEvents /></Page>
          }
        />

        <Route
          path="/events/:id"
          element={
            <Page><EventDetails /></Page>
          }
        />

        <Route
          path="/certificates/verify/:certificateId"
          element={
            <Page><VerifyCertificate /></Page>
          }
        />

        {/* Accounts */}

        <Route
          path="/login"
          element={<Page><Login /></Page>}
        />

        <Route
          path="/register"
          element={<Page><Register /></Page>}
        />

        <Route
          path="/account/profile"
          element={
            <Page><AccountProfile /></Page>
          }
        />

        <Route
          path="/forgot-password"
          element={
            <Page><ForgotPassword /></Page>
          }
        />

        <Route
          path="/reset-password/:uid/:token"
          element={
            <Page><ResetPassword /></Page>
          }
        />

        <Route
          path="/become-organizer"
          element={
            <Page><OrganizerApplication /></Page>
          }
        />

        <Route
          path="/organizer/login"
          element={
            <Page>
              <Login accountType="organizer" />
            </Page>
          }
        />

        <Route
          path="/organizer/register"
          element={
            <Page>
              <Register accountType="organizer" />
            </Page>
          }
        />

        {/* Admin */}

        <Route
          path="/admin/login"
          element={
            <Page><AdminLogin /></Page>
          }
        />

        <Route
          path="/admin/applications"
          element={
            <Page><AdminApplications /></Page>
          }
        />

        {/* Students */}

        <Route
          path="/my-registrations"
          element={
            <Page><MyRegistrations /></Page>
          }
        />

        <Route
          path="/my-registrations/:registrationId/ticket"
          element={
            <Page><StudentTicket /></Page>
          }
        />

        {/* Organisers and event staff */}

        <Route
          path="/organizer"
          element={
            <Page><OrganizerLayout /></Page>
          }
        >
          <Route
            index
            element={
              <Page><WorkspaceHome /></Page>
            }
          />

          <Route
            path="workspace"
            element={
              <Page><EventWorkspace /></Page>
            }
          />

          <Route
            path="events/new"
            element={
              <Page>
                <OrganizerOnly>
                  <EventForm />
                </OrganizerOnly>
              </Page>
            }
          />

          <Route
            path="events/:id/workspace"
            element={
              <Page>
                <EventAccessGate capability="view_event">
                  <EventCommunicationLink />
                  <EventPromotionLink />
                  <EventWorkspaceDetail />
                </EventAccessGate>
              </Page>
            }
          />

          <Route
            path="events/:id/communication"
            element={
              <Page>
                <EventAccessGate capability="edit_event">
                  <OrganizerCommunication />
                </EventAccessGate>
              </Page>
            }
          />

          <Route
            path="events/:id/promotion"
            element={
              <Page>
                <EventAccessGate capability="edit_event">
                  <OrganizerPromotion />
                </EventAccessGate>
              </Page>
            }
          />

          <Route
            path="events/:id/staff"
            element={
              <Page>
                <EventAccessGate capability="manage_staff">
                  <EventStaff />
                </EventAccessGate>
              </Page>
            }
          />

          <Route
            path="events/:id/edit"
            element={
              <Page>
                <EventAccessGate capability="edit_event">
                  <EventForm />
                </EventAccessGate>
              </Page>
            }
          />

          <Route
            path="events/:id/participants"
            element={
              <Page>
                <EventAccessGate capability="view_participants">
                  <OrganizerParticipants />
                </EventAccessGate>
              </Page>
            }
          />

          <Route
            path="events/:id/teams"
            element={
              <Page>
                <EventAccessGate ownerOnly>
                  <OrganizerTeams />
                </EventAccessGate>
              </Page>
            }
          />

          <Route
            path="events/:id/attendance"
            element={
              <Page>
                <EventAccessGate capability="view_attendance">
                  <OrganizerAttendance />
                </EventAccessGate>
              </Page>
            }
          />

          <Route
            path="events/:id/certificates"
            element={
              <Page>
                <EventAccessGate capability="manage_certificates">
                  <OrganizerCertificates />
                </EventAccessGate>
              </Page>
            }
          />

          <Route
            path="analytics"
            element={
              <Page>
                <OrganizerOnly>
                  <OrganizerAnalytics />
                </OrganizerOnly>
              </Page>
            }
          />
        </Route>

        <Route path="*" element={<Home />} />
      </Routes>
    </>
  );
}