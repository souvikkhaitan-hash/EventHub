import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  getCurrentUser,
  loginStudent,
  logoutStudent,
  saveAccountProfile,
} from "../services/auth";

const AuthContext = createContext(null);

let sessionRequest = null;

// Share a request only while it is pending.
// Completed account data is not cached here.
function checkSession() {
  if (!sessionRequest) {
    const request = Promise.resolve().then(
      () => getCurrentUser()
    );

    sessionRequest = request;

    function clearRequest() {
      if (sessionRequest === request) {
        sessionRequest = null;
      }
    }

    request.then(clearRequest, clearRequest);
  }

  return sessionRequest;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const revision = useRef(0);

  useEffect(() => {
    let active = true;
    const startedAt = revision.current;

    checkSession()
      .then((currentUser) => {
        if (
          active &&
          revision.current === startedAt
        ) {
          setUser(currentUser);
        }
      })
      .catch(() => {
        if (
          active &&
          revision.current === startedAt
        ) {
          setUser(null);
        }
      })
      .finally(() => {
        if (
          active &&
          revision.current === startedAt
        ) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const login = useCallback(async (credentials) => {
    const startedAt = ++revision.current;
    sessionRequest = null;

    try {
      const result = await loginStudent(credentials);

      if (revision.current === startedAt) {
        setUser(result.user);
      }

      return result;
    } finally {
      sessionRequest = null;

      if (revision.current === startedAt) {
        setLoading(false);
      }
    }
  }, []);

  const logout = useCallback(async () => {
    const startedAt = ++revision.current;
    sessionRequest = null;

    try {
      await logoutStudent();

      if (revision.current === startedAt) {
        setUser(null);
      }
    } finally {
      sessionRequest = null;

      if (revision.current === startedAt) {
        setLoading(false);
      }
    }
  }, []);

  const saveProfile = useCallback(async (details) => {
    const startedAt = ++revision.current;

    try {
      const updatedUser = await saveAccountProfile(
        details
      );

      if (revision.current === startedAt) {
        setUser(updatedUser);
      }

      return updatedUser;
    } finally {
      sessionRequest = null;

      if (revision.current === startedAt) {
        setLoading(false);
      }
    }
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      login,
      logout,
      saveProfile,
    }),
    [
      user,
      loading,
      login,
      logout,
      saveProfile,
    ]
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error(
      "useAuth must be used inside AuthProvider"
    );
  }

  return context;
}