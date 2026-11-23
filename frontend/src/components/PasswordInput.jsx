import { useState } from "react";


export default function PasswordInput({
  id,
  name,
  label,
  value,
  onChange,
  error,
  disabled = false,
  autoComplete = "new-password",
  maxLength = 128,
}) {
  const [visible, setVisible] = useState(false);

  const errorMessage = Array.isArray(error)
    ? error.join(" ")
    : typeof error === "string"
      ? error
      : "";


  return (
    <div className="form-field password-account-field">
      <label htmlFor={id}>
        {label}
      </label>

      <div className="password-account-input">
        <input
          id={id}
          name={name}
          type={visible ? "text" : "password"}
          value={value}
          onChange={onChange}
          autoComplete={autoComplete}
          maxLength={maxLength}
          required
          disabled={disabled}
          aria-invalid={Boolean(errorMessage)}
          aria-describedby={
            errorMessage
              ? `${id}-error`
              : undefined
          }
        />

        <button
          type="button"
          onClick={() => {
            setVisible((previous) => !previous);
          }}
          disabled={disabled}
          aria-label={
            visible
              ? `Hide ${label.toLowerCase()}`
              : `Show ${label.toLowerCase()}`
          }
          aria-pressed={visible}
        >
          {visible ? "Hide" : "Show"}
        </button>
      </div>

      {errorMessage && (
        <p
          id={`${id}-error`}
          className="field-error"
          role="alert"
        >
          {errorMessage}
        </p>
      )}
    </div>
  );
}