import { useState } from "react";
import { Link, useNavigate } from "react-router";

import AuthLayout from "../components/AuthLayout";
import PasswordInput from "../components/PasswordInput";

import { useAuth } from "../context/AuthContext";

import "../styles/password-security.css";


export default function AdminLogin() {
  const navigate = useNavigate();
  const { login } = useAuth();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");


  async function handleSubmit(event) {
    event.preventDefault();

    if (busy) {
      return;
    }

    setBusy(true);
    setError("");

    try {
      const result = await login({
        username: username.trim(),
        password,
        portal: "admin"
      });

      setPassword("");

      if (!result.user.can_review_organizers) {
        setError(
          "You are signed in, but this account does not have administrator review access."
        );

        return;
      }

      navigate("/admin/applications", {
        replace: true,
      });
    } catch (requestError) {
      setPassword("");

      setError(
        requestError.message ||
        "Unable to sign in."
      );
    } finally {
      setBusy(false);
    }
  }


  return (
    <AuthLayout
      title="Admin workspace."
      description="Sign in with your authorized EventHub administrator account."
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

        <div className="form-field">
          <label htmlFor="admin-username">
            Admin username
          </label>

          <div className="auth-v2-input-wrap">
            <input
              id="admin-username"
              type="text"
              value={username}
              onChange={(event) => {
                setUsername(event.target.value);
                setError("");
              }}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
              disabled={busy}
            />
          </div>
        </div>

        <PasswordInput
          id="admin-password"
          name="password"
          label="Password"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            setError("");
          }}
          autoComplete="current-password"
          maxLength={1024}
          disabled={busy}
        />

        <Link to="/forgot-password">
          Forgot password?
        </Link>

        <button
          type="submit"
          className="auth-submit-button auth-v2-submit"
          disabled={busy}
        >
          {busy
            ? "Signing in…"
            : "Open admin workspace"}
        </button>
      </form>

      <div className="password-recovery-links">
        <Link to="/login">
          Student / organizer sign in
        </Link>
      </div>
    </AuthLayout>
  );
}