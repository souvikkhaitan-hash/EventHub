import { useState } from "react";
import { Link } from "react-router";

import AuthLayout from "../components/AuthLayout";

import {
  requestPasswordReset,
} from "../services/auth";

import "../styles/password-security.css";


export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");


  async function handleSubmit(event) {
    event.preventDefault();

    if (sending) {
      return;
    }

    setError("");
    setMessage("");
    setSending(true);

    try {
      const result = await requestPasswordReset(
        email.trim()
      );

      setMessage(result.message);
    } catch (requestError) {
      const emailError =
        requestError.details?.email;

      setError(
        Array.isArray(emailError)
          ? emailError.join(" ")
          : requestError.message ||
            "Unable to request a reset link."
      );
    } finally {
      setSending(false);
    }
  }


  return (
    <AuthLayout
      title="Forgot your password?"
      description="Enter the email address associated with your EventHub account."
    >
      <form
        className="password-recovery-form"
        onSubmit={handleSubmit}
      >
        {error && (
          <p
            className="password-security-alert password-security-error"
            role="alert"
          >
            {error}
          </p>
        )}

        {message && (
          <p
            className="password-security-alert password-security-success"
            role="status"
          >
            {message}
          </p>
        )}

        <div className="form-field">
          <label htmlFor="reset-email">
            Account email
          </label>

          <input
            id="reset-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              setError("");
              setMessage("");
            }}
            maxLength={254}
            required
            disabled={sending}
          />
        </div>

        <button
          type="submit"
          className="auth-submit-button auth-v2-submit"
          disabled={sending}
        >
          {sending
            ? "Requesting link…"
            : message
              ? "Request another link"
              : "Send reset link"}
        </button>

        <p className="password-security-hint">
          Reset links expire after 30 minutes.
          If an email does not arrive, check
          spam or contact support.
        </p>
      </form>

      <div className="password-recovery-links">
        <Link to="/login">
          ← Back to sign in
        </Link>
      </div>
    </AuthLayout>
  );
}