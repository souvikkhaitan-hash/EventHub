import { useState } from "react";
import { Link, useNavigate } from "react-router";

import AuthLayout from "../components/AuthLayout";
import AuthPortalSwitch from "../components/AuthPortalSwitch";
import ProfileFields from "../components/ProfileFields";

import {
  emptyProfile,
  registerStudent,
} from "../services/auth";

import "../styles/auth.css";
import "../styles/account-profile.css";

function getPasswordStrength(password) {
  if (!password) {
    return { score: 0, label: "" };
  }

  let score = 0;

  if (password.length >= 8) score++;
  if (password.length >= 12) score++;

  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) {
    score++;
  }

  if (/\d/.test(password) && /[^A-Za-z0-9]/.test(password)) {
    score++;
  }

  if (score <= 1) {
    return { score: 1, label: "Needs improvement" };
  }

  if (score === 2) {
    return { score: 2, label: "Fair" };
  }

  if (score === 3) {
    return { score: 3, label: "Good" };
  }

  return { score: 4, label: "Strong" };
}

export default function Register({ accountType = "student" }) {
  const organizerRegistration = accountType === "organizer";
  const navigate = useNavigate();

  const loginPath = organizerRegistration
    ? "/organizer/login"
    : "/login";

  const [form, setForm] = useState({
    ...emptyProfile,
    username: "",
    email: "",
    password: "",
  });

  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);

  const passwordStrength = getPasswordStrength(form.password);

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
      detail: undefined,
      non_field_errors: undefined,
    }));
  }

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
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        roll_number: form.roll_number.trim(),
        department: form.department.trim(),
        academic_year: form.academic_year,
      });

      navigate(loginPath, {
        replace: true,
        state: {
          message: organizerRegistration
            ? "Your account is ready. Sign in to submit your organizer application."
            : "Your EventHub account is ready! Sign in to start exploring.",
        },
      });
    } catch (error) {
      const details = error?.details;

      if (
        details &&
        typeof details === "object" &&
        !Array.isArray(details)
      ) {
        setErrors(details);
      } else {
        setErrors({
          message:
            error?.message || "Unable to create your account.",
        });
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout
      title={
        organizerRegistration
          ? "Create your organizer account."
          : "Your campus journey starts here."
      }
      description={
        organizerRegistration
          ? "Create your account, then submit your organizer application for admin approval."
          : "Create your account and discover everything happening around campus."
      }
    >
      <div className="auth-v2 auth-v2-register">
        <AuthPortalSwitch
          mode="register"
          active={organizerRegistration ? "organizer" : "student"}
        />

        {organizerRegistration && (
          <p className="auth-organizer-note">
            Already have an EventHub account?{" "}
            <Link to="/organizer/login">
              Sign in with your existing account
            </Link>{" "}
            to apply. Organizer access is granted after admin approval.
          </p>
        )}

        <form
          className="auth-form auth-v2-form"
          onSubmit={handleSubmit}
          aria-busy={loading}
        >
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

          <ProfileFields
            value={form}
            onChange={handleChange}
            errors={errors}
            disabled={loading}
          />

          <div className="form-field">
            <label htmlFor="register-username">
              Username
            </label>

            <div className="auth-v2-input-wrap">
              <span
                className="auth-v2-input-icon"
                aria-hidden="true"
              >
                <svg viewBox="0 0 24 24" fill="none">
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
                aria-invalid={Boolean(getError("username"))}
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

          <div className="form-field">
            <label htmlFor="register-email">
              College email
            </label>

            <div className="auth-v2-input-wrap">
              <span
                className="auth-v2-input-icon"
                aria-hidden="true"
              >
                <svg viewBox="0 0 24 24" fill="none">
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
                autoCapitalize="none"
                spellCheck={false}
                aria-invalid={Boolean(getError("email"))}
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

          <div className="form-field">
            <label htmlFor="register-password">
              Password
            </label>

            <div className="password-field auth-v2-input-wrap">
              <span
                className="auth-v2-input-icon"
                aria-hidden="true"
              >
                <svg viewBox="0 0 24 24" fill="none">
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
                type={showPassword ? "text" : "password"}
                value={form.password}
                onChange={handleChange}
                placeholder="Create a strong password"
                autoComplete="new-password"
                minLength={8}
                aria-invalid={Boolean(getError("password"))}
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
                onClick={() => {
                  setShowPassword((previous) => !previous);
                }}
                aria-label={
                  showPassword ? "Hide password" : "Show password"
                }
                aria-pressed={showPassword}
                aria-controls="register-password"
                disabled={loading}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>

            {getError("password") && (
              <p
                id="register-password-error"
                className="field-error"
                role="alert"
              >
                {getError("password")}
              </p>
            )}

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
                  <strong>{passwordStrength.label}</strong>
                </div>
              </div>
            )}

            <p
              id="register-password-hint"
              className="field-hint"
            >
              Use at least 8 characters. A longer, unique password
              is more secure.
            </p>
          </div>

          <button
            type="submit"
            className="auth-submit-button auth-v2-submit"
            disabled={loading}
          >
            {loading ? (
              <>
                <span
                  className="auth-v2-spinner"
                  aria-hidden="true"
                />
                Creating account...
              </>
            ) : (
              <>
                <span>
                  {organizerRegistration
                    ? "Create account & continue"
                    : "Create my account"}
                </span>

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

        <div className="auth-v2-bottom">
          <p className="auth-switch">
            Already part of EventHub?{" "}
            <Link to={loginPath}>Sign in ↗</Link>
          </p>
        </div>
      </div>
    </AuthLayout>
  );
}