import { useEffect, useState } from "react";

import {
  Link,
  Route,
  Routes,
  useLocation,
} from "react-router";

import Navbar from "./components/Navbar";

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
  return (
    <div
      className="hero-artwork"
      aria-hidden="true"
    >

      {/* DECORATIVE ELEMENTS */}

      <span className="home-spark home-spark-left">
        ✳
      </span>

      <span className="home-spark home-spark-right">
        ✦
      </span>

      {/* LIME POSTER */}

      <div className="poster poster-primary">

        <div className="poster-header">
          <span>EVENTHUB / 26</span>
          <span>001 ↗</span>
        </div>

        <div className="poster-primary-content">

          <span className="poster-small-text">
            THE CAMPUS EDITION
          </span>

          <strong>
            MAKE
            <br />
            SOME
            <br />
            NOISE.
          </strong>

        </div>

        <div className="poster-primary-footer">
          <span>CREATE YOUR MOMENT</span>
          <span>✳</span>
        </div>

      </div>

      {/* BLUE POSTER */}

      <div className="poster poster-secondary">

        <div className="poster-secondary-top">
          <span>GOOD IDEAS</span>
          <span>START HERE.</span>
        </div>

        <div className="poster-circle">
          <span>GO</span>
          <span>BEYOND</span>
        </div>

        <div className="poster-secondary-bottom">
          <span>BUILD / CREATE / CONNECT</span>
          <span>↗</span>
        </div>

      </div>

      {/* CORAL STICKER */}

      <div className="artwork-sticker">
        <span>YOUR</span>
        <span>CAMPUS</span>
        <span>YOUR</span>
        <span>SCENE ↗</span>
      </div>

      <span className="artwork-caption">
        MADE FOR THE MOMENTS THAT MATTER.
      </span>

    </div>
  );
}


// ============================================================
// EVENT CATEGORIES
// ============================================================

const categories = [
  {
    id: "tech",
    number: "01",
    label: "TECH & BUILD",
    title: "Think big.\nBuild bigger.",
    description: "Hackathons, coding and innovation.",
    className: "category-tech",
    symbol: "{ }",
    filter: "technical",
  },
  {
    id: "culture",
    number: "02",
    label: "CULTURE & ART",
    title: "Bring your\nenergy.",
    description: "Music, performances and creativity.",
    className: "category-culture",
    symbol: "✳",
    filter: "cultural",
  },
  {
    id: "workshops",
    number: "03",
    label: "WORKSHOPS",
    title: "Learn.\nTry. Repeat.",
    description: "New skills and practical experiences.",
    className: "category-workshops",
    symbol: "↗",
    filter: "workshop",
  },
  {
    id: "sports",
    number: "04",
    label: "SPORTS & MORE",
    title: "Game\non.",
    description: "Competitions, teams and campus life.",
    className: "category-sports",
    symbol: "◉",
    filter: "sports",
  },
];


// ============================================================
// CATEGORY SHOWCASE
// ============================================================

function CategoryShowcase() {
  return (
    <section
      className="discovery-section"
      id="events"
      data-reveal
    >

      <div className="container">

        <div className="section-intro">

          <div>
            <span className="section-kicker">
              01 / FIND YOUR THING
            </span>

            <h2>
              There's something
              <br />
              <span>for everyone.</span>
            </h2>
          </div>

          <p>
            Whether you're here to learn something new,
            meet your people, or try something different —
            your campus has more to offer.
          </p>

        </div>

        {/* CATEGORY CARDS */}

        <div className="category-grid">

          {categories.map((category) => (
            <Link
              to={`/events?category=${category.filter}`}
              className={`category-card ${category.className}`}
              key={category.id}
              aria-label={`Explore ${category.label.toLowerCase()} events`}
            >

              <div className="category-card-header">
                <span>
                  {category.number} / CATEGORY
                </span>

                <span>{category.label}</span>
              </div>

              <span
                className="category-go"
                aria-hidden="true"
              >
                ↗
              </span>

              <div
                className="category-symbol"
                aria-hidden="true"
              >
                {category.symbol}
              </div>

              <div className="category-card-content">

                <h3>
                  {category.title
                    .split("\n")
                    .map((line, index) => (
                      <span key={index}>
                        {line}
                        <br />
                      </span>
                    ))}
                </h3>

                <p>{category.description}</p>

              </div>

            </Link>
          ))}

        </div>

        <div className="discovery-note">
          <span className="discovery-note-dot" />

          <p>
            Find your kind of experience. Explore
            upcoming events created and published
            by campus organizers.{" "}
            <Link to="/events">
              Browse live events →
            </Link>
          </p>
        </div>

      </div>

    </section>
  );
}


// ============================================================
// HOW IT WORKS DATA
// ============================================================

const steps = [
  {
    number: "01",
    title: "Discover",
    description:
      "Explore workshops, competitions, festivals and experiences happening around campus.",
  },
  {
    number: "02",
    title: "Register",
    description:
      "Find an event you love, reserve your place and receive your digital ticket.",
  },
  {
    number: "03",
    title: "Show up",
    description:
      "Bring your ticket, check in and enjoy the experience.",
  },
];


// ============================================================
// HOW IT WORKS SECTION
// ============================================================

// ============================================================
// EVENTHUB 2.0 — HOW IT WORKS
// ============================================================

function HowItWorks() {
  const steps = [
    {
      number: "01",
      title: "Discover",
      description:
        "Explore workshops, competitions, festivals and experiences happening around campus.",
      icon: (
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M4 18L9 13L13 15L20 5" />
          <path d="M16 5H20V9" />
          <circle cx="5" cy="19" r="2" />
        </svg>
      ),
    },
    {
      number: "02",
      title: "Register",
      description:
        "Find an event you love, reserve your place and receive your digital ticket.",
      icon: (
        <svg viewBox="0 0 24 24" fill="none">
          <rect
            x="3"
            y="5"
            width="18"
            height="16"
            rx="2"
          />
          <path d="M7 3V7M17 3V7M3 10H21" />
          <path d="M8 15L11 18L16 13" />
        </svg>
      ),
    },
    {
      number: "03",
      title: "Show up",
      description:
        "Bring your ticket, check in and enjoy the experience.",
      icon: (
        <svg viewBox="0 0 24 24" fill="none">
          <circle cx="9" cy="8" r="3" />
          <path d="M3 20V18C3 15.8 5.2 14 9 14C12.8 14 15 15.8 15 18V20H3Z" />
          <path d="M16 5C18 5.5 19 7 19 8.5C19 10 18 11.5 16 12" />
          <path d="M17 14C20 14.5 21 16 21 18V20H18" />
        </svg>
      ),
    },
  ];

  return (
    <section
      className="experience-section experience-v2"
      id="how-it-works"
      data-reveal
    >
      {/* Decorative background */}

      <div
        className="experience-ambient experience-ambient-left"
        aria-hidden="true"
      />

      <div
        className="experience-ambient experience-ambient-right"
        aria-hidden="true"
      />

      <div className="container">

        {/* SECTION HEADING */}

        <div className="experience-heading">

          <span className="section-kicker">
            02 / THE EXPERIENCE
          </span>

          <h2>
            Less planning.
            <br />
            <span>More living.</span>
          </h2>

          <p>
            We're making campus participation simpler,
            from finding an event to walking through
            the door.
          </p>

        </div>

        {/* EXPERIENCE STEPS */}

        <div className="experience-v2-wrapper">

          {/* CONNECTING LINE */}

          <svg
            className="experience-connector"
            viewBox="0 0 1000 110"
            preserveAspectRatio="none"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M110 70 C250 70 250 15 500 55 S800 15 890 70"
              stroke="#8F83FF"
              strokeWidth="2"
              strokeDasharray="4 7"
              strokeLinecap="round"
            />

            <circle
              cx="110"
              cy="70"
              r="7"
              fill="#3659F5"
            />

            <circle
              cx="500"
              cy="55"
              r="7"
              fill="#3659F5"
            />

            <circle
              cx="890"
              cy="70"
              r="7"
              fill="#3659F5"
            />
          </svg>

          {/* CARDS */}

          <div className="experience-v2-grid">

            {steps.map((step, index) => (

              <article
                className="experience-v2-card"
                key={step.number}
                style={{
                  "--step-index": index,
                }}
              >

                <div className="experience-v2-top">

                  {/* ICON */}

                  <div className="experience-v2-icon">
                    {step.icon}
                  </div>

                  {/* NUMBER + TITLE */}

                  <div className="experience-v2-title">

                    <span className="experience-v2-number">
                      {step.number}
                    </span>

                    <h3>{step.title}</h3>

                  </div>

                </div>

                {/* DESCRIPTION */}

                <p className="experience-v2-description">
                  {step.description}
                </p>

                {/* BOTTOM DECORATION */}

                <span
                  className="experience-v2-corner"
                  aria-hidden="true"
                >
                  ✦
                </span>

              </article>

            ))}

          </div>

        </div>

      </div>
    </section>
  );
}

// ============================================================
// JOIN EVENTHUB SECTION
// ============================================================

// ============================================================
// EVENTHUB 2.0 — PREMIUM JOIN SECTION
// ============================================================

function JoinSection() {
  return (
    <section
      className="join-section join-v2"
      id="join"
      data-reveal
    >
      {/* Decorative sparkles — top right */}

      <svg
        className="join-decoration join-sparkles"
        viewBox="0 0 90 90"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M30 10L35 25L50 30L35 35L30 50L25 35L10 30L25 25Z"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />

        <path
          d="M65 2L69 14L81 18L69 22L65 34L61 22L49 18L61 14Z"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
      </svg>

      {/* Decorative background lighting */}

      <div
        className="join-v2-glow"
        aria-hidden="true"
      />

      <div className="container join-content">

        {/* LEFT CONTENT */}

        <div className="join-v2-copy">
          <span className="join-eyebrow">
            YOUR NEXT CHAPTER STARTS HERE
          </span>

          <h2>
            Don't just hear
            <br />
            about it.
            <br />

            <span className="join-highlight">
              Be there.

              {/* Hand-drawn underline */}

              <svg
                className="join-underline"
                viewBox="0 0 300 24"
                preserveAspectRatio="none"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M5 15C70 5 142 6 205 12C242 15 270 12 295 7"
                  stroke="currentColor"
                  strokeWidth="5"
                  strokeLinecap="round"
                />
              </svg>
            </span>
          </h2>
        </div>

        {/* RIGHT CONTENT */}

        <div className="join-action join-v2-action">
          <p>
            Be part of the campus community.
            Create your EventHub account and
            get ready for your next experience.
          </p>

          <div className="join-v2-button-wrap">
            <Link
              to="/register"
              className="join-button join-v2-button"
            >
              <span>Join EventHub</span>

              <span
                className="join-v2-arrow"
                aria-hidden="true"
              >
                ↗
              </span>
            </Link>

            {/* Decorative accent strokes */}

            <svg
              className="join-decoration join-button-strokes"
              viewBox="0 0 65 65"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M15 28L30 10"
                stroke="currentColor"
                strokeWidth="4"
                strokeLinecap="round"
              />

              <path
                d="M28 43L48 40"
                stroke="currentColor"
                strokeWidth="4"
                strokeLinecap="round"
              />

              <circle
                cx="11"
                cy="48"
                r="3"
                fill="currentColor"
              />
            </svg>
          </div>
        </div>

      </div>
    </section>
  );
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

      <main className="home-v2">

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


        {/* ================================================
            ANIMATED CAMPUS STRIP
        ================================================ */}

        <div
          className="culture-strip"
          aria-hidden="true"
        >

          <div className="culture-strip-content">

            {[0, 1].map((repeat) => (
              <div
                className="culture-strip-group"
                key={repeat}
              >
                <span>✦ DISCOVER MORE</span>
                <span>✦ CREATE MEMORIES</span>
                <span>✦ MEET YOUR PEOPLE</span>
                <span>✦ SHOW UP</span>
              </div>
            ))}

          </div>

        </div>


        {/* ================================================
            INTERACTIVE EVENT CATEGORIES
        ================================================ */}

        <CategoryShowcase />


        {/* ================================================
            HOW IT WORKS
        ================================================ */}

        <HowItWorks />


        {/* ================================================
            JOIN EVENTHUB
        ================================================ */}

        <JoinSection />

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