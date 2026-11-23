const API_BASE = import.meta.env.PROD
  ? window.location.origin
  : (
      import.meta.env.VITE_API_BASE_URL ||
      "http://localhost:8000"
    );

const API_URL = `${API_BASE}/api/auth`;

export const emptyProfile = {
  first_name: "",
  last_name: "",
  roll_number: "",
  department: "",
  academic_year: "",
};


// Read JSON without exposing an HTML parsing error to users.
async function readJson(response) {
  const contentType =
    response.headers.get("content-type") || "";

  if (!contentType.includes("application/json")) {
    throw new Error(
      "The account service is temporarily unavailable. Please try again."
    );
  }

  try {
    return await response.json();
  } catch {
    throw new Error(
      "The account service returned an invalid response. Please try again."
    );
  }
}


async function getCsrfToken() {
  const response = await fetch(
    `${API_URL}/csrf/`,
    {
      credentials: "include",
    }
  );

  if (!response.ok) {
    throw new Error(
      "Unable to initialize a secure connection."
    );
  }

  const data = await readJson(response);

  if (!data.csrfToken) {
    throw new Error(
      "Unable to initialize a secure connection."
    );
  }

  return data.csrfToken;
}


async function sendRequest(
  endpoint,
  data,
  method = "POST"
) {
  const csrfToken = await getCsrfToken();

  const response = await fetch(
    `${API_URL}/${endpoint}/`,
    {
      method,
      credentials: "include",

      headers: {
        "Content-Type": "application/json",
        "X-CSRFToken": csrfToken,
      },

      body: JSON.stringify(data),
    }
  );

  const result = await readJson(response);

  if (!response.ok) {
    const error = new Error(
      result.message ||
      result.detail ||
      "The request could not be completed."
    );

    error.details = result;
    error.status = response.status;

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
  const response = await fetch(
    `${API_URL}/me/`,
    {
      credentials: "include",
    }
  );

  if (
    response.status === 401 ||
    response.status === 403
  ) {
    return null;
  }

  if (!response.ok) {
    throw new Error(
      "Unable to check your login status."
    );
  }

  return readJson(response);
}


export async function getAccountProfile() {
  const response = await fetch(
    `${API_URL}/profile/`,
    {
      credentials: "include",
    }
  );

  if (
    response.status === 401 ||
    response.status === 403
  ) {
    const error = new Error(
      "Your session has expired. Please sign in again."
    );

    error.status = response.status;

    throw error;
  }

  if (!response.ok) {
    throw new Error(
      "Unable to load your profile. Please try again."
    );
  }

  return readJson(response);
}


export function saveAccountProfile(data) {
  return sendRequest(
    "profile",
    data,
    "PUT"
  );
}

export function changeAccountPassword(data) {
  return sendRequest(
    "password/change",
    data
  );
}


export function requestPasswordReset(email) {
  return sendRequest(
    "password/reset",
    { email }
  );
}


export function confirmPasswordReset(data) {
  return sendRequest(
    "password/reset/confirm",
    data
  );
}
export async function getMyOrganizerApplication() {
  const response = await fetch(
    `${API_URL}/organizer-application/`,
    {
      credentials: "include",
    }
  );

  const result = await readJson(response);

  if (!response.ok) {
    const error = new Error(
      result.message ||
      result.detail ||
      "Unable to load your organizer application."
    );

    error.details = result;
    error.status = response.status;

    throw error;
  }

  return result;
}


export function submitOrganizerApplication(data) {
  return sendRequest(
    "organizer-application",
    data
  );
}

async function getAdminAccountData(
  endpoint,
  parameters = {}
) {
  const query = new URLSearchParams(
    parameters
  ).toString();

  const response = await fetch(
    `${API_URL}/${endpoint}/${query ? `?${query}` : ""}`,
    {
      credentials: "include",
    }
  );

  const result = await readJson(response);

  if (!response.ok) {
    const error = new Error(
      result.message ||
      result.detail ||
      "Unable to load the requested information."
    );

    error.details = result;
    error.status = response.status;

    throw error;
  }

  return result;
}


export function getOrganizerApplications({
  status = "pending",
  search = "",
  page = 1,
} = {}) {
  return getAdminAccountData(
    "admin/organizer-applications",
    {
      status,
      search,
      page: String(page),
    }
  );
}


export function getOrganizerApplication(
  applicationId
) {
  return getAdminAccountData(
    `admin/organizer-applications/${applicationId}`
  );
}


export function reviewOrganizerApplication(
  applicationId,
  data
) {
  return sendRequest(
    `admin/organizer-applications/${applicationId}`,
    data
  );
}