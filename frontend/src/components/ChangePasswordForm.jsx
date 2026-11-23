import { useState } from "react";
import { Link } from "react-router";

import PasswordInput from "./PasswordInput";

import {
  changeAccountPassword,
} from "../services/auth";

import "../styles/password-security.css";


const initialForm = {
  old_password: "",
  new_password1: "",
  new_password2: "",
};


function errorText(value) {
  return Array.isArray(value)
    ? value.join(" ")
    : typeof value === "string"
      ? value
      : "";
}


export default function ChangePasswordForm() {
  const [form, setForm] = useState(initialForm);
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
    setMessage("");
  }


  async function handleSubmit(event) {
    event.preventDefault();

    if (saving) {
      return;
    }

    setErrors({});
    setMessage("");

    if (
      form.new_password1 !== form.new_password2
    ) {
      setErrors({
        new_password2: [
          "The new passwords do not match.",
        ],
      });

      return;
    }

    setSaving(true);

    try {
      const result = await changeAccountPassword(
        form
      );

      setForm(initialForm);
      setMessage(result.message);
    } catch (error) {
      setErrors(
        error.details || {
          message:
            error.message ||
            "Unable to change your password.",
        }
      );

      // Do not leave the current password in the form.
      setForm((previous) => ({
        ...previous,
        old_password: "",
      }));
    } finally {
      setSaving(false);
    }
  }


  const generalError =
    errorText(errors.message) ||
    errorText(errors.detail) ||
    errorText(errors.non_field_errors);


  return (
    <section className="account-profile-card password-security-card">
      <h2>Password and security</h2>

      <p className="password-security-description">
        Choose a strong, unique password.
        Changing it keeps this browser signed in.
        Other sessions will need to sign in again.
      </p>

      <form
        className="password-security-form"
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
          id="change-old-password"
          name="old_password"
          label="Current password"
          value={form.old_password}
          onChange={handleChange}
          error={errors.old_password}
          autoComplete="current-password"
          maxLength={1024}
          disabled={saving}
        />

        <PasswordInput
          id="change-new-password"
          name="new_password1"
          label="New password"
          value={form.new_password1}
          onChange={handleChange}
          error={errors.new_password1}
          disabled={saving}
        />

        <PasswordInput
          id="change-confirm-password"
          name="new_password2"
          label="Confirm new password"
          value={form.new_password2}
          onChange={handleChange}
          error={errors.new_password2}
          disabled={saving}
        />

        <p className="password-security-hint">
          Use at least 8 characters and avoid
          common passwords or passwords similar
          to your personal details.
        </p>

        {message && (
          <p
            className="password-security-alert password-security-success"
            role="status"
          >
            {message}
          </p>
        )}

        <button
          type="submit"
          className="auth-submit-button"
          disabled={saving}
        >
          {saving
            ? "Updating password…"
            : "Update password"}
        </button>

        <Link to="/forgot-password">
          Forgot your current password?
        </Link>
      </form>
    </section>
  );
}