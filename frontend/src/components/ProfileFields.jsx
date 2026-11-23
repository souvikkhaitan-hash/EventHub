export default function ProfileFields({
  value,
  onChange,
  errors = {},
  disabled = false,
}) {
  const fields = [
    {
      name: "first_name",
      label: "First / given name",
      autoComplete: "given-name",
      maxLength: 150,
      required: true,
    },
    {
      name: "last_name",
      label: "Last / family name (optional)",
      autoComplete: "family-name",
      maxLength: 150,
      required: false,
    },
    {
      name: "roll_number",
      label: "Roll / register number",
      autoComplete: "off",
      maxLength: 50,
      required: true,
    },
    {
      name: "department",
      label: "Department / programme",
      autoComplete: "off",
      maxLength: 120,
      required: true,
    },
  ];


  function getError(name) {
    const error = errors[name];

    return Array.isArray(error)
      ? error.join(" ")
      : typeof error === "string"
        ? error
        : "";
  }


  return (
    <fieldset
      className="profile-fields"
      disabled={disabled}
    >
      <legend>Participant details</legend>

      <p className="field-hint">
        Enter your official name and academic
        details for attendance lists and
        certificates.
      </p>

      <div className="profile-field-grid">
        {fields.map((field) => {
          const error = getError(field.name);
          const inputId = `profile-${field.name}`;
          const errorId = `${inputId}-error`;

          return (
            <div
              className="form-field"
              key={field.name}
            >
              <label htmlFor={inputId}>
                {field.label}
              </label>

              <input
                id={inputId}
                name={field.name}
                type="text"
                value={value[field.name] ?? ""}
                onChange={onChange}
                autoComplete={field.autoComplete}
                maxLength={field.maxLength}
                required={field.required}
                aria-invalid={Boolean(error)}
                aria-describedby={
                  error ? errorId : undefined
                }
              />

              {error && (
                <p
                  id={errorId}
                  className="field-error"
                  role="alert"
                >
                  {error}
                </p>
              )}
            </div>
          );
        })}

        <div className="form-field">
          <label htmlFor="profile-academic_year">
            Academic year
          </label>

          <select
            id="profile-academic_year"
            name="academic_year"
            value={value.academic_year ?? ""}
            onChange={onChange}
            required
            aria-invalid={Boolean(
              getError("academic_year")
            )}
            aria-describedby={
              getError("academic_year")
                ? "profile-academic_year-error"
                : undefined
            }
          >
            <option value="">
              Select your year
            </option>

            {[1, 2, 3, 4, 5, 6].map((year) => (
              <option
                key={year}
                value={String(year)}
              >
                Year {year}
              </option>
            ))}

            <option value="postgraduate">
              Postgraduate
            </option>

            <option value="other">
              Other
            </option>
          </select>

          {getError("academic_year") && (
            <p
              id="profile-academic_year-error"
              className="field-error"
              role="alert"
            >
              {getError("academic_year")}
            </p>
          )}
        </div>
      </div>
    </fieldset>
  );
}