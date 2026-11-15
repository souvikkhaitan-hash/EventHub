const API_URL = "http://localhost:8000/api/auth";

async function getCsrfToken() {
  const response = await fetch(`${API_URL}/csrf/`, {
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error("Unable to initialize a secure connection.");
  }

  const data = await response.json();

  return data.csrfToken;
}

async function sendRequest(endpoint, data) {
  const csrfToken = await getCsrfToken();

  const response = await fetch(`${API_URL}/${endpoint}/`, {
    method: "POST",
    credentials: "include",

    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": csrfToken,
    },

    body: JSON.stringify(data),
  });

  const result = await response.json();

  if (!response.ok) {
    const error = new Error(
      result.message || "The request could not be completed."
    );

    error.details = result;

    throw error;
  }

  return result;
}

export function registerStudent(data) {
  return sendRequest("register", data);
}

export function loginStudent(data) {
  return sendRequest("login", data);
}

export function logoutStudent() {
  return sendRequest("logout", {});
}

export async function getCurrentUser() {
  const response = await fetch(`${API_URL}/me/`, {
    credentials: "include",
  });

  if (response.status === 401 || response.status === 403) {
    return null;
  }

  if (!response.ok) {
    throw new Error("Unable to check your login status.");
  }

  return response.json();
}