import {
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";
import { Link, useOutletContext, useParams } from "react-router";

import { getMyEventAccess } from "../services/events";

const EventAccessContext = createContext(null);

export function useEventAccess() {
  return useContext(EventAccessContext);
}

export function OrganizerOnly({ children }) {
  const { user } = useOutletContext();

  if (!user.is_organizer) {
    return (
      <section className="staff-panel">
        <h2>Organizer access required</h2>
        <p>This page requires an approved organizer account.</p>
        <Link to="/organizer/workspace">Back to my events</Link>
      </section>
    );
  }

  return children;
}

export default function EventAccessGate({
  capability,
  ownerOnly = false,
  children,
}) {
  const { id } = useParams();
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState({
    id: null,
    status: "loading",
    access: null,
    error: "",
  });

  useEffect(() => {
    let active = true;

    setState({
      id,
      status: "loading",
      access: null,
      error: "",
    });

    getMyEventAccess(id)
      .then((access) => {
        if (!Array.isArray(access.capabilities)) {
          throw new Error("Unexpected event access response.");
        }

        if (active) {
          setState({
            id,
            status: "ready",
            access,
            error: "",
          });
        }
      })
      .catch((error) => {
        if (active) {
          setState({
            id,
            status: "error",
            access: null,
            error: [401, 403, 404].includes(error.status)
              ? "This event is unavailable or your access has changed."
              : error.message || "Unable to check event access.",
          });
        }
      });

    return () => {
      active = false;
    };
  }, [id, retry]);

  if (state.id !== id || state.status === "loading") {
    return <p role="status">Checking event access...</p>;
  }

  if (state.status === "error") {
    return (
      <section className="staff-panel">
        <h2>Unable to open event</h2>
        <p role="alert">{state.error}</p>
        <button
          type="button"
          onClick={() => setRetry((value) => value + 1)}
        >
          Try again
        </button>
        <p>
          <Link to="/organizer/workspace">Back to my events</Link>
        </p>
      </section>
    );
  }

  const allowed =
    (!ownerOnly || state.access.role === "owner") &&
    (!capability ||
      state.access.capabilities.includes(capability));

  if (!allowed) {
    return (
      <section className="staff-panel">
        <h2>Action unavailable</h2>
        <p>Your event role does not include this action.</p>
        <Link to={`/organizer/events/${id}/workspace`}>
          Back to event workspace
        </Link>
      </section>
    );
  }

  return (
    <EventAccessContext.Provider value={state.access}>
      <div key={id}>{children}</div>
    </EventAccessContext.Provider>
  );
}