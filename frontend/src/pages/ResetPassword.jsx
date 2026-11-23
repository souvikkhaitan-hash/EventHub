import { useState } from "react";
import { Link, useParams } from "react-router";

import AuthLayout from "../components/AuthLayout";
import PasswordInput from "../components/PasswordInput";

import {
  confirmPasswordReset,
} from "../services/auth";

import "../styles/password-security.css";


function errorText(value) {
  return Array.isArray(value)
    ? value.join(" ")
    : typeof value === "string"
      ? value
      : "";
}


export default function ResetPassword() {
  const { uid, token } = useParams();

  const [form, setForm] = useState({
    new_password1: "",
    new_password2: "",
  });

  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");


  function handleChange(event) {
    const { name, value } = event.target;

    setForm((previous) => ({
      ...previous,
      [name]: value,
    }));

    setErrors({});
  }


  async function handleSubmit(event) {
    event.preventDefault();

    if (saving) {
      return;
    }

    setErrors({});

    if (
      form.new_password1 !== form.new_password2
    ) {
      setErrors({
        new_password2: [
          "The passwords do not match.",
        ],
      });

      return;
    }

    setSaving(true);

    try {
      const result = await confirmPasswordReset({
        uid,
        token,
        ...form,
      });

      setForm({
        new_password1: "",
        new_password2: "",
      });

      setMessage(result.message);
    } catch (error) {
      setErrors(
        error.details || {
          message:
            error.message ||
            "Unable to reset your password.",
        }
      );
    } finally {
      setSaving(false);
    }
  }


  const generalError =
    errorText(errors.message) ||
    errorText(errors.detail) ||
    errorText(errors.non_field_errors) ||
    errorText(errors.uid) ||
    errorText(errors.token);


  return (
    <AuthLayout
      title={
        message
          ? "Password updated."
          : "Choose a new password."
      }
      description={
        message
          ? "You can now sign in with your new password."
          : "Use a unique password that you have not used elsewhere."
      }
    >
      {message ? (
        <>
          <p
            className="password-security-alert password-security-success"
            role="status"
          >
            {message}
          </p>

          <div className="password-recovery-links">
            {/* Reload the app to refresh its login state. */}
            <a href="/login">
              Sign in →
            </a>
          </div>
        </>
      ) : (
        <>
          <form
            className="password-recovery-form"
            onSubmit={handleSubmit}
          >
            {generalError && (
              <p
                className="password-security-alert password-security-error"
                role="alert"
              >
                {generalError}
              </p>
            )}

            <PasswordInput
              id="reset-new-password"
              name="new_password1"
              label="New password"
              value={form.new_password1}
              onChange={handleChange}
              error={errors.new_password1}
              disabled={saving}
            />

            <PasswordInput
              id="reset-confirm-password"
              name="new_password2"
              label="Confirm new password"
              value={form.new_password2}
              onChange={handleChange}
              error={errors.new_password2}
              disabled={saving}
            />

            <p className="password-security-hint">
              Use at least 8 characters.
              Common passwords and passwords
              similar to your account details
              will be rejected.
            </p>

            <button
              type="submit"
              className="auth-submit-button auth-v2-submit"
              disabled={saving}
            >
              {saving
                ? "Resetting password…"
                : "Reset password"}
            </button>
          </form>

          <div className="password-recovery-links">
            <Link to="/forgot-password">
              Request a new reset link
            </Link>

            <Link to="/login">
              Back to sign in
            </Link>
          </div>
        </>
      )}
    </AuthLayout>
  );
}