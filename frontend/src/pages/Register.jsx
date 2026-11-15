import { useState } from "react";
import { Link, useNavigate } from "react-router";

import AuthLayout from "../components/AuthLayout";

import { registerStudent } from "../services/auth";

import "../styles/auth.css";


// ============================================================
// PASSWORD STRENGTH HELPER
// ============================================================

function getPasswordStrength(password) {
  if (!password) {
    return {
      score: 0,
      label: "",
    };
  }

  let score = 0;

  if (password.length >= 8) {
    score++;
  }

  if (password.length >= 12) {
    score++;
  }

  if (
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password)
  ) {
    score++;
  }

  if (
    /\d/.test(password) &&
    /[^A-Za-z0-9]/.test(password)
  ) {
    score++;
  }

  if (score <= 1) {
    return {
      score: 1,
      label: "Needs improvement",
    };
  }

  if (score === 2) {
    return {
      score: 2,
      label: "Fair",
    };
  }

  if (score === 3) {
    return {
      score: 3,
      label: "Good",
    };
  }

  return {
    score: 4,
    label: "Strong",
  };
}


// ============================================================
// REGISTER PAGE
// ============================================================

export default function Register() {
  const navigate = useNavigate();

  const [form, setForm] = useState({
    username: "",
    email: "",
    password: "",
  });

  const [showPassword, setShowPassword] =
    useState(false);

  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);

  const passwordStrength =
    getPasswordStrength(form.password);

  // ==========================================================
  // INPUT HANDLING
  // ==========================================================

  function handleChange(event) {
    const { name, value } = event.target;

    setForm((previous) => ({
      ...previous,
      [name]: value,
    }));

    setErrors((previous) => ({
      ...previous,
      [name]: undefined,
      message: undefined,
      non_field_errors: undefined,
    }));
  }

  // ==========================================================
  // ERROR HELPER
  // ==========================================================

  function getError(field) {
    const value = errors[field];

    if (Array.isArray(value)) {
      return value.join(" ");
    }

    return typeof value === "string" ? value : "";
  }

  const generalError =
    getError("message") ||
    getError("detail") ||
    getError("non_field_errors");

  // ==========================================================
  // REGISTRATION
  // ==========================================================

  async function handleSubmit(event) {
    event.preventDefault();

    if (loading) return;

    setErrors({});
    setLoading(true);

    try {
      await registerStudent({
        username: form.username.trim(),
        email: form.email.trim(),
        password: form.password,
      });

      navigate("/login", {
        replace: true,

        state: {
          message:
            "Your EventHub account is ready! Sign in to start exploring.",
        },
      });
    } catch (error) {
      if (
        error.details &&
        typeof error.details === "object" &&
        !Array.isArray(error.details)
      ) {
        setErrors(error.details);
      } else {
        setErrors({
          message:
            error.message ||
            "Unable to create your account.",
        });
      }
    } finally {
      setLoading(false);
    }
  }

  // ==========================================================
  // FORM
  // ==========================================================

  return (
    <AuthLayout
      title="Your campus journey starts here."
      description="Create your account and discover everything happening around campus."
    >
      <div className="auth-v2 auth-v2-register">

        <form
          className="auth-form auth-v2-form"
          onSubmit={handleSubmit}
        >

          {/* GENERAL ERROR */}

          {generalError && (
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

              <span>{generalError}</span>
            </div>
          )}

          {/* USERNAME */}

          <div className="form-field">

            <label htmlFor="register-username">
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
                id="register-username"
                name="username"
                type="text"
                value={form.username}
                onChange={handleChange}
                placeholder="Choose a username"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                aria-invalid={Boolean(
                  getError("username")
                )}
                aria-describedby={
                  getError("username")
                    ? "register-username-error"
                    : undefined
                }
                required
                disabled={loading}
              />

            </div>

            {getError("username") && (
              <p
                id="register-username-error"
                className="field-error"
                role="alert"
              >
                {getError("username")}
              </p>
            )}

          </div>

          {/* EMAIL */}

          <div className="form-field">

            <label htmlFor="register-email">
              College email
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
                  <rect
                    x="3"
                    y="5"
                    width="18"
                    height="14"
                    rx="2"
                  />

                  <path d="M4 7L12 13L20 7" />
                </svg>
              </span>

              <input
                id="register-email"
                name="email"
                type="email"
                value={form.email}
                onChange={handleChange}
                placeholder="Enter your college email"
                autoComplete="email"
                aria-invalid={Boolean(
                  getError("email")
                )}
                aria-describedby={
                  getError("email")
                    ? "register-email-error"
                    : undefined
                }
                required
                disabled={loading}
              />

            </div>

            {getError("email") && (
              <p
                id="register-email-error"
                className="field-error"
                role="alert"
              >
                {getError("email")}
              </p>
            )}

          </div>

          {/* PASSWORD */}

          <div className="form-field">

            <label htmlFor="register-password">
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
                id="register-password"
                name="password"
                type={
                  showPassword ? "text" : "password"
                }
                value={form.password}
                onChange={handleChange}
                placeholder="Create a strong password"
                autoComplete="new-password"
                minLength={8}
                aria-invalid={Boolean(
                  getError("password")
                )}
                aria-describedby={[
                  "register-password-hint",
                  getError("password")
                    ? "register-password-error"
                    : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                required
                disabled={loading}
              />

              <button
                type="button"
                className="password-toggle auth-v2-password-toggle"
                onClick={() =>
                  setShowPassword(
                    (previous) => !previous
                  )
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

            {/* PASSWORD ERROR */}

            {getError("password") && (
              <p
                id="register-password-error"
                className="field-error"
                role="alert"
              >
                {getError("password")}
              </p>
            )}

            {/* PASSWORD STRENGTH */}

            {form.password && (
              <div
                className={`auth-v2-strength auth-v2-strength-${passwordStrength.score}`}
              >
                <div
                  className="auth-v2-strength-bars"
                  aria-hidden="true"
                >
                  {[1, 2, 3, 4].map((level) => (
                    <span
                      key={level}
                      className={
                        level <= passwordStrength.score
                          ? "strength-active"
                          : ""
                      }
                    />
                  ))}
                </div>

                <div className="auth-v2-strength-label">
                  <span>Password strength</span>
                  <strong>
                    {passwordStrength.label}
                  </strong>
                </div>
              </div>
            )}

            <p
              id="register-password-hint"
              className="field-hint"
            >
              Use at least 8 characters. A longer,
              unique password is more secure.
            </p>

          </div>

          {/* SUBMIT */}

          <button
            type="submit"
            className="auth-submit-button auth-v2-submit"
            disabled={loading}
          >
            {loading ? (
              <>
                <span className="auth-v2-spinner" />
                Creating account...
              </>
            ) : (
              <>
                <span>Create my account</span>

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

        {/* SWITCH TO LOGIN */}

        <div className="auth-v2-bottom">
          <p className="auth-switch">
            Already part of EventHub?{" "}
            <Link to="/login">
              Sign in ↗
            </Link>
          </p>
        </div>

      </div>
    </AuthLayout>
  );
}