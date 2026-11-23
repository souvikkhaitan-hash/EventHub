import {
  useEffect,
  useState,
} from "react";

import { Link } from "react-router";

import Navbar from "../components/Navbar";
import ProfileFields from "../components/ProfileFields";

import { useAuth } from "../context/AuthContext";

import {
  emptyProfile,
  getAccountProfile,
} from "../services/auth";

import "../styles/account-profile.css";
import ChangePasswordForm from "../components/ChangePasswordForm";


function formFromUser(user) {
  return {
    ...emptyProfile,
    ...user.profile,
    first_name: user.first_name || "",
    last_name: user.last_name || "",
  };
}


function errorText(value) {
  if (Array.isArray(value)) {
    return value.join(" ");
  }

  return typeof value === "string"
    ? value
    : "";
}


export default function AccountProfile() {
  const {
    user,
    loading,
    saveProfile,
  } = useAuth();

  const userId = user?.id;

  const [form, setForm] = useState(
    emptyProfile
  );

  const [fetching, setFetching] =
    useState(true);

  const [loadError, setLoadError] =
    useState("");

  const [sessionExpired, setSessionExpired] =
    useState(false);

  const [errors, setErrors] =
    useState({});

  const [saving, setSaving] =
    useState(false);

  const [message, setMessage] =
    useState("");

  const [reload, setReload] =
    useState(0);


  useEffect(() => {
    if (!userId) {
      return;
    }

    let active = true;

    async function loadProfile() {
      try {
        const data = await getAccountProfile();

        if (active) {
          setForm(formFromUser(data));
        }
      } catch (error) {
        if (active) {
          setLoadError(
            error.message ||
            "Unable to load your profile."
          );

          setSessionExpired(
            error.status === 401 ||
            error.status === 403
          );
        }
      } finally {
        if (active) {
          setFetching(false);
        }
      }
    }

    loadProfile();

    return () => {
      active = false;
    };
  }, [userId, reload]);


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

    setMessage("");
  }


  function retryLoading() {
    setLoadError("");
    setSessionExpired(false);
    setFetching(true);

    setReload((previous) => previous + 1);
  }


  async function handleSubmit(event) {
    event.preventDefault();

    if (saving) {
      return;
    }

    setSaving(true);
    setErrors({});
    setMessage("");

    const details = Object.fromEntries(
      Object.entries(form).map(
        ([key, value]) => [
          key,
          typeof value === "string"
            ? value.trim()
            : value,
        ]
      )
    );

    try {
      const updatedUser = await saveProfile(
        details
      );

      setForm(
        formFromUser(updatedUser)
      );

      setMessage(
        "Your profile has been saved."
      );
    } catch (error) {
      setErrors(
        error.details || {
          message:
            error.message ||
            "Unable to save your profile.",
        }
      );

      if (
        error.status === 401 ||
        error.status === 403
      ) {
        setSessionExpired(true);
      }
    } finally {
      setSaving(false);
    }
  }


  const generalError =
    errorText(errors.message) ||
    errorText(errors.detail) ||
    errorText(errors.non_field_errors);


  return (
    <>
      <Navbar />

      <main className="account-profile-page">
        <Link
          to="/"
          className="account-profile-back"
        >
          ← Back to EventHub
        </Link>

        <header className="account-profile-heading">
          <p className="account-profile-eyebrow">
            YOUR ACCOUNT
          </p>

          <h1>Make it yours.</h1>

          <p>
            Keep your participant details ready
            for your next campus event.
          </p>
        </header>

        {loading ? (
          <p role="status">
            Checking your account…
          </p>
        ) : !user ? (
          <section className="account-profile-card">
            <h2>Sign in to continue</h2>

            <p>
              Please{" "}
              <Link to="/login">
                sign in
              </Link>{" "}
              to manage your profile.
            </p>
          </section>
        ) : (
          <section className="account-profile-card">
            <div className="account-profile-identity">
              <span>
                Signed in as{" "}
                <strong>
                  {user.username}
                </strong>
              </span>

              <span>{user.email}</span>
            </div>

            {fetching ? (
              <p role="status">
                Loading your details…
              </p>
            ) : loadError ? (
              <>
                <p
                  className="account-profile-error"
                  role="alert"
                >
                  {loadError}
                </p>

                {sessionExpired ? (
                  <Link to="/login">
                    Sign in again
                  </Link>
                ) : (
                  <button
                    type="button"
                    className="account-profile-retry"
                    onClick={retryLoading}
                  >
                    Try again
                  </button>
                )}
              </>
            ) : (
              <form onSubmit={handleSubmit}>
                {generalError && (
                  <div
                    className="account-profile-error"
                    role="alert"
                  >
                    {generalError}
                  </div>
                )}

                {sessionExpired && (
                  <p>
                    <Link to="/login">
                      Sign in again
                    </Link>{" "}
                    before saving.
                  </p>
                )}

                <ProfileFields
                  value={form}
                  onChange={handleChange}
                  errors={errors}
                  disabled={saving}
                />

                <p className="account-profile-note">
                  Updating your profile does not
                  change previously issued
                  certificates. Contact the event
                  organizer if an issued
                  certificate needs correction.
                </p>

                {message && (
                  <p
                    className="account-profile-success"
                    role="status"
                  >
                    {message}
                  </p>
                )}

                <button
                  type="submit"
                  className="auth-submit-button"
                  disabled={
                    saving || sessionExpired
                  }
                >
                  {saving
                    ? "Saving…"
                    : "Save profile"}
                </button>
              </form>
            )}
          </section>
        )}
        {!loading && user && (
         <ChangePasswordForm />
       )}
      </main>
    </>
  );
}