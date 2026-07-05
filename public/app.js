const loginPanel = document.querySelector("#login-panel");
const appPanel = document.querySelector("#app-panel");
const statusBox = document.querySelector("#status-box");
const loginMessage = document.querySelector("#login-message");
const passwordMessage = document.querySelector("#password-message");
const secretsMessage = document.querySelector("#secrets-message");
const actionMessage = document.querySelector("#action-message");
const metricPoints = document.querySelector("#metric-points");
const metricError = document.querySelector("#metric-error");
const intervalMsInput = document.querySelector("#intervalMs");
const intervalDaysInput = document.querySelector("#intervalDays");
const intervalHoursInput = document.querySelector("#intervalHours");
const intervalMinutesInput = document.querySelector("#intervalMinutes");
const intervalSecondsInput = document.querySelector("#intervalSeconds");

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

async function api(path, options = {}) {
  const headers = {
    ...(options.headers || {}),
  };
  if (options.body !== undefined) {
    headers["Content-Type"] = headers["Content-Type"] || "application/json";
  }

  const response = await fetch(path, {
    credentials: "same-origin",
    headers,
    ...options,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || `Request failed with ${response.status}`);
  }
  return data;
}

function renderState(payload) {
  const state = payload.state;
  metricPoints.textContent = state.runtime.lastPoints ?? "-";
  metricError.textContent = state.runtime.lastError ?? "none";
  statusBox.textContent = JSON.stringify(state, null, 2);

  document.querySelector("#pollingEnabled").checked = state.settings.pollingEnabled;
  setIntervalFieldsFromMilliseconds(state.settings.intervalMs);
  document.querySelector("#reservePoints").value = state.settings.reservePoints;
  document.querySelector("#autoBuyEnabled").checked = state.settings.autoBuyEnabled;
  document.querySelector("#buyAmountGb").value = state.settings.buyAmountGb;
  document.querySelector("#mamCookie").placeholder = state.hasMamCookie
    ? "MAM cookie is saved. Paste a new value here to replace it."
    : "Paste mam_id value";
}

function setIntervalFieldsFromMilliseconds(totalMilliseconds) {
  const sanitized = Math.max(Number(totalMilliseconds) || 0, 0);
  intervalMsInput.value = sanitized;

  let remainder = Math.floor(sanitized / 1000) * 1000 === sanitized
    ? sanitized
    : sanitized;

  const days = Math.floor(remainder / DAY_MS);
  remainder -= days * DAY_MS;
  const hours = Math.floor(remainder / HOUR_MS);
  remainder -= hours * HOUR_MS;
  const minutes = Math.floor(remainder / MINUTE_MS);
  remainder -= minutes * MINUTE_MS;
  const seconds = Math.floor(remainder / SECOND_MS);

  intervalDaysInput.value = days;
  intervalHoursInput.value = hours;
  intervalMinutesInput.value = minutes;
  intervalSecondsInput.value = seconds;
}

function setIntervalMillisecondsFromDurationFields() {
  const days = Math.max(Number(intervalDaysInput.value) || 0, 0);
  const hours = clamp(Number(intervalHoursInput.value) || 0, 0, 23);
  const minutes = clamp(Number(intervalMinutesInput.value) || 0, 0, 59);
  const seconds = clamp(Number(intervalSecondsInput.value) || 0, 0, 59);

  intervalDaysInput.value = days;
  intervalHoursInput.value = hours;
  intervalMinutesInput.value = minutes;
  intervalSecondsInput.value = seconds;

  const totalMilliseconds =
    (days * DAY_MS) +
    (hours * HOUR_MS) +
    (minutes * MINUTE_MS) +
    (seconds * SECOND_MS);

  intervalMsInput.value = Math.max(totalMilliseconds, 1000);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

async function refreshState() {
  const data = await api("/api/state");
  renderState(data);
  loginPanel.classList.add("hidden");
  appPanel.classList.remove("hidden");
}

document.querySelector("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  loginMessage.textContent = "";
  try {
    await api("/api/login", {
      method: "POST",
      body: JSON.stringify({
        password: document.querySelector("#password").value,
      }),
    });
    document.querySelector("#password").value = "";
    await refreshState();
  } catch (error) {
    loginMessage.textContent = error.message;
  }
});

document.querySelector("#logout-button").addEventListener("click", async () => {
  await api("/api/logout", { method: "POST" });
  appPanel.classList.add("hidden");
  loginPanel.classList.remove("hidden");
});

intervalMsInput.addEventListener("input", () => {
  setIntervalFieldsFromMilliseconds(Number(intervalMsInput.value) || 0);
});

[intervalDaysInput, intervalHoursInput, intervalMinutesInput, intervalSecondsInput].forEach((input) => {
  input.addEventListener("input", () => {
    setIntervalMillisecondsFromDurationFields();
  });
});

document.querySelector("#settings-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  actionMessage.textContent = "";
  const payload = {
    pollingEnabled: document.querySelector("#pollingEnabled").checked,
    intervalMs: Number(intervalMsInput.value),
    reservePoints: Number(document.querySelector("#reservePoints").value),
    autoBuyEnabled: document.querySelector("#autoBuyEnabled").checked,
    buyAmountGb: Number(document.querySelector("#buyAmountGb").value),
  };
  const data = await api("/api/settings", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
  renderState(data);
  actionMessage.textContent = "Settings saved.";
});

document.querySelector("#secrets-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  secretsMessage.textContent = "";
  try {
    const data = await api("/api/secrets", {
      method: "PUT",
      body: JSON.stringify({
        mamCookie: document.querySelector("#mamCookie").value || undefined,
        clearMamCookie: document.querySelector("#clearMamCookie").checked,
      }),
    });
    renderState(data);
    document.querySelector("#mamCookie").value = "";
    document.querySelector("#clearMamCookie").checked = false;
    secretsMessage.textContent = data.state.hasMamCookie
      ? "MAM cookie saved."
      : "MAM cookie cleared.";
  } catch (error) {
    secretsMessage.textContent = error.message;
  }
});

document.querySelector("#password-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  passwordMessage.textContent = "";
  const data = await api("/api/admin-password", {
    method: "PUT",
    body: JSON.stringify({
      newAdminPassword: document.querySelector("#newAdminPassword").value,
    }),
  });
  document.querySelector("#newAdminPassword").value = "";
  passwordMessage.textContent = "Password changed. Sign in again.";
  appPanel.classList.add("hidden");
  loginPanel.classList.remove("hidden");
});

document.querySelector("#run-now").addEventListener("click", async () => {
  actionMessage.textContent = "";
  try {
    const data = await api("/api/actions/run", { method: "POST" });
    renderState(data);
    actionMessage.textContent = "Points check completed.";
  } catch (error) {
    actionMessage.textContent = error.message;
  }
});

document.querySelector("#buy-now").addEventListener("click", async () => {
  actionMessage.textContent = "";
  try {
    const data = await api("/api/actions/buy", { method: "POST" });
    renderState(data);
    actionMessage.textContent = data.message || "Buy action completed.";
  } catch (error) {
    actionMessage.textContent = error.message;
  }
});

refreshState().catch(() => {
  loginPanel.classList.remove("hidden");
  appPanel.classList.add("hidden");
});
