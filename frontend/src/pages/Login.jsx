import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";

import AuthLayout from "../components/AuthLayout";
import { useAuth } from "../context/AuthContext";

import "../styles/auth.css";
import "../styles/password-security.css";
import AuthPortalSwitch from "../components/AuthPortalSwitch";

export default function Login({
  accountType = "student",
}) {
  const organizerLogin =
    accountType === "organizer";
  const navigate = useNavigate();
  const location = useLocation();

  const { login } = useAuth();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const [showPassword, setShowPassword] = useState(false);

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();

    if (loading) return;

    setError("");
    setLoading(true);

    try {
     const result = await login({
  username: username.trim(),
  password,
  portal: "account",
});

const destination = organizerLogin
  ? (
      result.user.is_organizer
        ? "/organizer"
        : "/become-organizer"
    )
  : "/";

navigate(destination, {
  replace: true,
});
    } catch (err) {
      setError(
        err.message ||
          "Unable to sign in. Please try again."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
   <AuthLayout
  title={
    organizerLogin
      ? "Your next event starts here."
      : "Welcome back."
  }
  description={
    organizerLogin
      ? "Sign in to manage your events or check your organizer application."
      : "Your next campus experience is waiting. Sign in and pick up right where you left off."
  }
>
      <div className="auth-v2">
        <AuthPortalSwitch
  mode="login"
  active={
    organizerLogin
      ? "organizer"
      : "student"
  }
/>

        {/* SUCCESS MESSAGE */}

        {location.state?.message && (
          <div
            className="auth-v2-alert auth-v2-success"
            role="status"
          >
            <span
              className="auth-v2-alert-icon"
              aria-hidden="true"
            >
              ✓
            </span>

            <span>{location.state.message}</span>
          </div>
        )}

        {/* LOGIN FORM */}

        <form
          className="auth-form auth-v2-form"
          onSubmit={handleSubmit}
        >

          {/* ERROR MESSAGE */}

          {error && (
            <div
              className="auth-v2-alert auth-v2-error"
              role="alert"
            >
              <span
                className="auth-v2-alert-icon"
                aria-hidden="true"
              >
                !
              </span>

              <span>{error}</span>
            </div>
          )}

          {/* USERNAME */}

          <div className="form-field">
            <label htmlFor="login-username">
              Username
            </label>

            <div className="auth-v2-input-wrap">
              <span
                className="auth-v2-input-icon"
                aria-hidden="true"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <circle cx="12" cy="8" r="4" />

                  <path d="M4 21C4 16.5 7.2 14 12 14C16.8 14 20 16.5 20 21" />
                </svg>
              </span>

              <input
                id="login-username"
                type="text"
                value={username}
                onChange={(event) =>
                  setUsername(event.target.value)
                }
                placeholder="Enter your username"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                required
                disabled={loading}
              />
            </div>
          </div>

          {/* PASSWORD */}

          <div className="form-field">
            <label htmlFor="login-password">
              Password
            </label>

            <div className="password-field auth-v2-input-wrap">
              <span
                className="auth-v2-input-icon"
                aria-hidden="true"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <rect
                    x="5"
                    y="10"
                    width="14"
                    height="11"
                    rx="2"
                  />

                  <path d="M8 10V7A4 4 0 0 1 16 7V10" />
                </svg>
              </span>

              <input
                id="login-password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) =>
                  setPassword(event.target.value)
                }
                placeholder="Enter your password"
                autoComplete="current-password"
                required
                disabled={loading}
              />

              <button
                type="button"
                className="password-toggle auth-v2-password-toggle"
                onClick={() =>
                  setShowPassword((previous) => !previous)
                }
                aria-label={
                  showPassword
                    ? "Hide password"
                    : "Show password"
                }
                aria-pressed={showPassword}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
          </div>
          <Link
  to="/forgot-password"
  className="password-forgot-link"
>
  Forgot password?
</Link>

          {/* SUBMIT */}

          <button
            type="submit"
            className="auth-submit-button auth-v2-submit"
            disabled={loading}
          >
            {loading ? (
              <>
                <span className="auth-v2-spinner" />
                Signing in...
              </>
            ) : (
              <>
                <span>Sign in</span>

                <span
                  className="auth-v2-submit-arrow"
                  aria-hidden="true"
                >
                  ↗
                </span>
              </>
            )}
          </button>

        </form>

        {/* SWITCH TO REGISTER */}

        <div className="auth-v2-bottom">
          <p className="auth-switch">
            New to EventHub?{" "}
            <Link
  to={
    organizerLogin
      ? "/organizer/register"
      : "/register"
  }
>
            </Link>
          </p>
        </div>

      </div>
      <p className="auth-switch">
  Platform administrator?{" "}
  <Link to="/admin/login">
    Admin sign in
  </Link>
</p>
    </AuthLayout>
  );
}