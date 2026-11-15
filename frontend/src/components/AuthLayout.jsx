import { Link } from "react-router";

function AuthLayout({ children, title, description }) {
  return (
    <main className="auth-layout">
      <section className="auth-brand-panel">
        <Link
          to="/"
          className="auth-brand"
          aria-label="EventHub homepage"
        >
          <img src="/eventhub-logo.svg" alt="EventHub Logo" className="auth-logo" />
          <span>EventHub</span>
        </Link>

        <div className="auth-brand-content">
          <span className="auth-eyebrow">
            MADE FOR CAMPUS LIFE
          </span>

          <h1>
            More than
            <br />
            just another
            <br />
            <span className="auth-highlight">event.</span>
          </h1>

          <p>
            The workshops you'll remember.
            The people you'll meet.
            The experiences you'll talk about.
          </p>

          <div className="auth-poster" aria-hidden="true">
            <div className="poster-top">
              <span>EVENTHUB / CAMPUS CULTURE</span>
              <span>01 — 26</span>
            </div>

            <div className="poster-center">
              <span>SHOW</span>
              <span>UP.</span>
              <span>STAND</span>
              <span>OUT.</span>
            </div>

            <div className="poster-bottom">
              <span>EXPLORE SOMETHING NEW</span>
              <span>↗</span>
            </div>
          </div>
        </div>

        <div className="auth-brand-footer">
          <span>DISCOVER</span>
          <span>CONNECT</span>
          <span>EXPERIENCE</span>
        </div>
      </section>

      <section className="auth-form-panel">
        <div className="auth-form-container">
          <Link to="/" className="auth-back-link">
            ← Back to EventHub
          </Link>

          <div className="auth-form-heading">
            <span className="auth-form-eyebrow">
              YOUR CAMPUS STARTS HERE
            </span>

            <h2>{title}</h2>
            <p>{description}</p>
          </div>

          {children}
        </div>
      </section>
    </main>
  );
}

export default AuthLayout;