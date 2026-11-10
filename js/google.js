import { addDays, seoulDateTime, todayISO } from "./dates.js";
import { eachShift } from "./shifts.js";
import { applyRemoteConfig, configSlice } from "./store.js";

export const APP_TAG = "family-calendar";
export const CALENDAR_API = "https://www.googleapis.com/calendar/v3";
export const SHIFT_PAST_DAYS = 31;
export const SHIFT_FUTURE_DAYS = 122;
const TOKEN_KEY = "family-calendar.googleToken";
const CHUNK = 900;
const TZ = "Asia/Seoul";

export const GOOGLE_COLOR_IDS = {
  1: "#7986cb",
  2: "#33b679",
  3: "#8e24aa",
  4: "#e67c73",
  5: "#f6bf26",
  6: "#f4511e",
  7: "#039be5",
  8: "#616161",
  9: "#3f51b5",
  10: "#0b8043",
  11: "#d50000",
};

const QUICK_CUSTOM = {
  연차: { name: "연차", shortLabel: "연", color: "#d50000", off: true, startTime: "", endTime: "" },
  반차: { name: "반차", shortLabel: "반", color: "#f4511e", off: false, startTime: "09:00", endTime: "13:00" },
  교육: { name: "교육", shortLabel: "교", color: "#00897b", off: false, startTime: "09:00", endTime: "18:00" },
};

export { QUICK_CUSTOM };

let memoryToken = null;

export class GoogleApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "GoogleApiError";
    this.status = status;
  }
}

export function isGoogleConfigured() {
  const id = (typeof window !== "undefined" && window.APP_CONFIG?.GOOGLE_CLIENT_ID) || "";
  const trimmed = String(id).trim();
  if (!trimmed) return false;
  if (trimmed.includes("YOUR_")) return false;
  return trimmed.endsWith(".apps.googleusercontent.com");
}

export function clientId() {
  return String(window.APP_CONFIG?.GOOGLE_CLIENT_ID || "").trim();
}

export function isAfter(a, b) {
  const ta = Date.parse(a || "") || 0;
  const tb = Date.parse(b || "") || 0;
  return ta > tb;
}

export function nearestColorId(hex) {
  const rgb = hexToRgb(hex) || [120, 120, 120];
  let best = "7";
  let bestDistance = Infinity;
  for (const [id, color] of Object.entries(GOOGLE_COLOR_IDS)) {
    const other = hexToRgb(color);
    const distance = (rgb[0] - other[0]) ** 2 + (rgb[1] - other[1]) ** 2 + (rgb[2] - other[2]) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = id;
    }
  }
  return best;
}

export function chunkString(value, size = CHUNK) {
  const parts = [];
  for (let index = 0; index < value.length; index += size) parts.push(value.slice(index, index + size));
  return parts.length ? parts : [""];
}

export function encodeConfig(config) {
  const json = JSON.stringify(config);
  if (json.length > 28000) {
    throw new GoogleApiError(0, "근무 설정이 너무 길어요. 오래된 ‘하루만 바꾸기’를 지운 다음 다시 동기화해 주세요.");
  }
  const parts = chunkString(json, CHUNK);
  const shared = {
    app: APP_TAG,
    kind: "config",
    parts: String(parts.length),
  };
  parts.forEach((part, index) => {
    shared[`p${index}`] = part;
  });
  return shared;
}

export function decodeConfig(shared) {
  if (!shared || shared.kind !== "config") return null;
  const count = Number(shared.parts || 0);
  if (!count) return null;
  let json = "";
  for (let index = 0; index < count; index += 1) json += shared[`p${index}`] || "";
  try {
    const data = JSON.parse(json);
    return sanitizeConfig(data);
  } catch {
    return null;
  }
}

export function sanitizeConfig(data) {
  if (!data || data.app !== APP_TAG) return null;
  if (!Array.isArray(data.members) || !data.members.length) return null;
  return {
    configUpdatedAt: data.configUpdatedAt || "",
    members: data.members,
    shiftTypes: Array.isArray(data.shiftTypes) ? data.shiftTypes : [],
    patterns: Array.isArray(data.patterns) ? data.patterns : [],
    overrides: Array.isArray(data.overrides) ? data.overrides : [],
  };
}

export function decideConfigAction(localAt, remoteAt) {
  if (remoteAt && isAfter(remoteAt, localAt)) return "pull";
  if (localAt && isAfter(localAt, remoteAt)) return "push";
  return "keep";
}

export function configToGoogleBody(state) {
  return {
    summary: "가족캘린더 설정 (지우지 마세요)",
    description: "우리 가족 캘린더 앱이 근무 패턴과 구성원을 맞춰 두는 일정입니다. 지우면 휴대폰끼리 근무표가 어긋날 수 있어요.",
    start: { date: "1999-01-01" },
    end: { date: "1999-01-02" },
    transparency: "transparent",
    extendedProperties: { shared: encodeConfig(configSlice(state)) },
  };
}

export function toGoogleBody(event, members) {
  const member = (members || []).find((item) => item.id === event.memberId);
  const body = {
    summary: event.title || "(제목 없음)",
    description: event.memo || "",
    colorId: nearestColorId(member?.color || "#0b8043"),
    extendedProperties: {
      shared: {
        app: APP_TAG,
        kind: "event",
        localId: event.id,
        memberId: event.memberId || "family",
      },
    },
  };
  if (event.allDay) {
    const inclusiveEnd = event.endDate && event.endDate >= event.date ? event.endDate : event.date;
    body.start = { date: event.date };
    body.end = { date: addDays(inclusiveEnd, 1) };
  } else {
    const startTime = event.startTime || "09:00";
    const endTime = event.endTime || "10:00";
    let endDate = event.date;
    if (event.endDate && event.endDate > event.date) endDate = event.endDate;
    else if (endTime <= startTime) endDate = addDays(event.date, 1);
    body.start = { dateTime: `${event.date}T${startTime}:00`, timeZone: TZ };
    body.end = { dateTime: `${endDate}T${endTime}:00`, timeZone: TZ };
  }
  const freq = { daily: "DAILY", weekly: "WEEKLY", monthly: "MONTHLY" }[event.repeat];
  if (freq) {
    let rule = `RRULE:FREQ=${freq}`;
    if (event.repeatUntil) rule += `;UNTIL=${event.repeatUntil.replace(/-/g, "")}T145959Z`;
    body.recurrence = [rule];
  }
  return body;
}

export function shiftToGoogleBody(date, shift, members) {
  const member = (members || []).find((item) => item.id === shift.memberId);
  const who = member?.name || "근무";
  const lines = ["가족캘린더가 만든 근무 일정입니다."];
  if (shift.override) lines.push("이 날은 패턴과 다르게 바뀐 근무입니다.");
  lines.push("패턴을 바꾸면 동기화할 때 이 기간의 근무 일정이 다시 맞춰집니다. 하루만 바꾸려면 앱에서 ‘이 날만 바꾸기’를 쓰세요.");
  if (shift.memo) lines.push(shift.memo);
  const shared = {
    app: APP_TAG,
    kind: "shift",
    shiftDate: date,
    memberId: shift.memberId,
    override: shift.override ? "1" : "0",
    shiftName: shift.name,
  };
  if (shift.patternId) shared.patternId = shift.patternId;
  const body = {
    summary: `${who} ${shift.name}`,
    description: lines.join("\n"),
    colorId: nearestColorId(shift.color),
    transparency: shift.off ? "transparent" : "opaque",
    extendedProperties: { shared },
  };
  const timed = !shift.off && shift.startTime && shift.endTime;
  if (!timed) {
    body.start = { date };
    body.end = { date: addDays(date, 1) };
  } else {
    const endDate = shift.endTime <= shift.startTime ? addDays(date, 1) : date;
    body.start = { dateTime: `${date}T${shift.startTime}:00`, timeZone: TZ };
    body.end = { dateTime: `${endDate}T${shift.endTime}:00`, timeZone: TZ };
  }
  return body;
}

export function fromGoogleEvent(item) {
  if (!item || item.status === "cancelled" || !item.start) return null;
  const shared = item.extendedProperties?.shared || {};
  if (shared.kind === "shift" || shared.kind === "config" || shared.kind === "overrides") return null;
  if (item.recurringEventId) return null;

  const allDay = Boolean(item.start.date);
  let date = "";
  let endDate = "";
  let startTime = "";
  let endTime = "";
  if (allDay) {
    date = item.start.date;
    const exclusive = item.end?.date || addDays(date, 1);
    const inclusive = addDays(exclusive, -1);
    if (inclusive > date) endDate = inclusive;
  } else {
    const start = googleWallTime(item.start);
    const end = googleWallTime(item.end || item.start);
    date = start.date;
    startTime = start.time;
    endTime = end.time;
    if (end.date && end.date !== start.date) {
      if (!(end.date === addDays(start.date, 1) && end.time <= start.time)) endDate = end.date;
    }
  }
  if (!date) return null;

  let repeat = "none";
  let repeatUntil = "";
  const rule = (item.recurrence || []).find((line) => line.startsWith("RRULE:"));
  if (rule) {
    const freq = /FREQ=([A-Z]+)/.exec(rule)?.[1];
    repeat = { DAILY: "daily", WEEKLY: "weekly", MONTHLY: "monthly" }[freq] || "none";
    const until = /UNTIL=(\d{8})/.exec(rule)?.[1];
    if (until) repeatUntil = `${until.slice(0, 4)}-${until.slice(4, 6)}-${until.slice(6, 8)}`;
  }

  return {
    id: shared.localId || item.id,
    title: item.summary || "(제목 없음)",
    memberId: shared.memberId || "family",
    date,
    endDate,
    allDay,
    startTime,
    endTime,
    memo: item.description || "",
    repeat,
    repeatUntil,
    googleEventId: item.id,
    googleUpdated: item.updated || "",
    updatedAt: item.updated || new Date().toISOString(),
  };
}

export function eventsToPush(state) {
  return (state.events || []).filter((event) => {
    if (!event.googleEventId) return true;
    return isAfter(event.updatedAt, event.googleUpdated);
  });
}

export function applyRemoteEventList(state, items) {
  if (!Array.isArray(state.tombstones)) state.tombstones = [];
  const tombByGoogle = new Map(state.tombstones.filter((item) => item.googleEventId).map((item) => [item.googleEventId, item]));
  const cancelled = new Set();
  const remotes = [];

  for (const item of items || []) {
    const kind = item.extendedProperties?.shared?.kind || "";
    if (kind === "shift" || kind === "config" || kind === "overrides") continue;
    if (item.status === "cancelled") {
      if (item.id) cancelled.add(item.id);
      continue;
    }
    const parsed = fromGoogleEvent(item);
    if (!parsed) continue;
    const tomb = tombByGoogle.get(parsed.googleEventId);
    if (tomb && !isAfter(parsed.googleUpdated, tomb.deletedAt)) continue;
    if (tomb && isAfter(parsed.googleUpdated, tomb.deletedAt)) {
      state.tombstones = state.tombstones.filter((item) => item !== tomb);
    }
    remotes.push(parsed);
  }

  state.events = (state.events || []).filter((event) => !(event.googleEventId && cancelled.has(event.googleEventId)));

  for (const remote of remotes) {
    const index = state.events.findIndex((event) =>
      (remote.googleEventId && event.googleEventId === remote.googleEventId) ||
      (remote.id && event.id === remote.id));
    if (index === -1) {
      state.events.push(remote);
      continue;
    }
    const local = state.events[index];
    if (isAfter(remote.googleUpdated, local.updatedAt)) {
      state.events[index] = { ...remote, id: local.id || remote.id };
    } else if (!local.googleEventId && remote.googleEventId) {
      local.googleEventId = remote.googleEventId;
      local.googleUpdated = remote.googleUpdated;
    }
  }
  return state;
}

export function shiftWindow(today = todayISO()) {
  return {
    start: addDays(today, -SHIFT_PAST_DAYS),
    end: addDays(today, SHIFT_FUTURE_DAYS),
  };
}

export function currentToken() {
  if (memoryToken && Date.now() < memoryToken.expiresAt - 60000) return memoryToken.accessToken;
  const stored = readStoredToken();
  if (stored) {
    memoryToken = stored;
    return stored.accessToken;
  }
  memoryToken = null;
  return "";
}

export function isSignedIn() {
  return Boolean(currentToken());
}

export function friendlyGoogleError(error) {
  const status = error?.status;
  if (status === 401) return "로그인이 만료됐어요. 다시 Google로 연결해 주세요.";
  if (status === 403) return "캘린더를 수정할 권한이 없어요. 공유 권한을 ‘일정 변경’으로 했는지 확인해 주세요.";
  if (status === 404) return "캘린더나 일정을 찾지 못했어요. 설정에서 캘린더를 다시 골라 주세요.";
  if (status === 410) return "동기화 정보가 오래됐어요. 한 번 더 눌러 주세요.";
  return error?.message || "Google 캘린더와 연결하지 못했어요.";
}

export function loadGis() {
  if (!isGoogleConfigured()) return Promise.resolve(false);
  if (typeof window === "undefined") return Promise.resolve(false);
  if (window.google?.accounts?.oauth2) return Promise.resolve(true);
  return new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
}

export function signIn() {
  return new Promise((resolve, reject) => {
    if (!isGoogleConfigured()) {
      reject(new Error("Google 클라이언트 ID가 아직 없어요."));
      return;
    }
    loadGis().then((loaded) => {
      if (!loaded || !window.google?.accounts?.oauth2) {
        reject(new Error("Google 로그인 창을 불러오지 못했어요. 인터넷 연결을 확인해 주세요."));
        return;
      }
      try {
        const client = window.google.accounts.oauth2.initTokenClient({
          client_id: clientId(),
          scope: "https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/userinfo.email",
          callback: (response) => {
            if (!response || response.error) {
              reject(new Error(response?.error || "로그인이 취소되었어요."));
              return;
            }
            const token = {
              accessToken: response.access_token,
              expiresAt: Date.now() + Number(response.expires_in || 3600) * 1000,
            };
            memoryToken = token;
            writeStoredToken(token);
            resolve(token);
          },
          error_callback: (error) => {
            reject(new Error(error?.message || "로그인이 취소되었어요."));
          },
        });
        client.requestAccessToken({ prompt: "select_account" });
      } catch (error) {
        reject(error);
      }
    }).catch(reject);
  });
}

export function signOut() {
  const token = currentToken();
  memoryToken = null;
  const store = session();
  if (store) store.removeItem(TOKEN_KEY);
  if (token && typeof window !== "undefined" && window.google?.accounts?.oauth2?.revoke) {
    try {
      window.google.accounts.oauth2.revoke(token, () => {});
    } catch {
      // 토큰을 이미 지웠으므로 무시합니다.
    }
  }
}

export async function fetchProfile() {
  const data = await apiAbsolute("https://www.googleapis.com/oauth2/v3/userinfo");
  return { email: data.email || "", name: data.name || "" };
}

export async function listCalendars() {
  const data = await api("/users/me/calendarList?maxResults=250");
  return (data.items || [])
    .filter((item) => item.accessRole === "owner" || item.accessRole === "writer")
    .map((item) => ({
      id: item.id,
      summary: item.summary || "(이름 없음)",
      primary: Boolean(item.primary),
      accessRole: item.accessRole,
    }));
}

export async function createFamilyCalendar() {
  return api("/calendars", {
    method: "POST",
    body: {
      summary: "가족 공유 캘린더",
      timeZone: TZ,
      description: "우리 가족 캘린더 앱에서 함께 쓰는 달력입니다.",
    },
  });
}

export async function shareCalendar(calendarId, email) {
  return api(`/calendars/${encodeURIComponent(calendarId)}/acl`, {
    method: "POST",
    body: {
      role: "writer",
      scope: { type: "user", value: email.trim() },
    },
  });
}

export async function syncAll(state, { onProgress } = {}) {
  if (!state.google?.calendarId) {
    throw new GoogleApiError(0, "먼저 함께 쓸 캘린더를 골라 주세요.");
  }
  const calendarId = state.google.calendarId;
  const note = (text) => onProgress?.(text);

  note("설정을 맞추는 중이에요…");
  const configResult = await syncConfig(state, calendarId);

  note("일정을 가져오는 중이에요…");
  let listed;
  try {
    listed = await listChangedEvents(calendarId, state.google.syncToken);
  } catch (error) {
    if (error.status === 410) {
      state.google.syncToken = "";
      listed = await listChangedEvents(calendarId, "");
    } else {
      throw error;
    }
  }
  applyRemoteEventList(state, listed.items);

  note("일정을 보내는 중이에요…");
  const pushed = await pushEvents(state, calendarId);
  const removed = await pushTombstones(state, calendarId);

  note("근무표를 다시 쓰는 중이에요…");
  const shifts = await regenerateShifts(state, calendarId, note);

  state.google.syncToken = listed.nextSyncToken || state.google.syncToken;
  state.google.lastSyncAt = new Date().toISOString();
  const summary = syncSummary({ configResult, pushed, removed, shifts, imported: listed.items.length });
  state.google.lastSyncMessage = summary;
  return { summary, configResult, pushed, removed, shifts };
}

export async function syncConfig(state, calendarId) {
  const existing = await findConfigEvent(calendarId);
  const remote = existing ? decodeConfig(existing.extendedProperties?.shared) : null;
  const action = decideConfigAction(state.configUpdatedAt, remote?.configUpdatedAt);
  if (action === "pull" && remote) {
    applyRemoteConfig(state, remote);
    return "pull";
  }
  if (action === "push") {
    const body = configToGoogleBody(state);
    if (existing?.id) {
      await api(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(existing.id)}`, {
        method: "PUT",
        body: { ...body, id: existing.id },
      });
    } else {
      await api(`/calendars/${encodeURIComponent(calendarId)}/events`, { method: "POST", body });
    }
    return "push";
  }
  return "keep";
}

async function findConfigEvent(calendarId) {
  const params = new URLSearchParams();
  params.set("maxResults", "10");
  params.set("sharedExtendedProperty", "kind=config");
  params.set("showDeleted", "false");
  const data = await api(`/calendars/${encodeURIComponent(calendarId)}/events?${params}`);
  const items = (data.items || []).filter((item) => item.extendedProperties?.shared?.app === APP_TAG);
  items.sort((a, b) => String(b.updated || "").localeCompare(String(a.updated || "")));
  return items[0] || null;
}

async function listChangedEvents(calendarId, syncToken) {
  const items = [];
  let pageToken = "";
  let nextSyncToken = "";
  do {
    const params = new URLSearchParams();
    params.set("maxResults", "250");
    params.set("showDeleted", "true");
    params.set("singleEvents", "false");
    if (pageToken) params.set("pageToken", pageToken);
    else if (syncToken) params.set("syncToken", syncToken);
    else {
      params.set("timeMin", "2024-01-01T00:00:00+09:00");
      params.set("timeMax", "2030-12-31T23:59:59+09:00");
    }
    const data = await api(`/calendars/${encodeURIComponent(calendarId)}/events?${params}`);
    items.push(...(data.items || []));
    pageToken = data.nextPageToken || "";
    if (data.nextSyncToken) nextSyncToken = data.nextSyncToken;
  } while (pageToken);
  return { items, nextSyncToken };
}

async function pushEvents(state, calendarId) {
  const pending = eventsToPush(state);
  let count = 0;
  for (const event of pending) {
    const body = toGoogleBody(event, state.members);
    const saved = event.googleEventId
      ? await api(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(event.googleEventId)}`, {
          method: "PATCH",
          body,
        })
      : await api(`/calendars/${encodeURIComponent(calendarId)}/events`, { method: "POST", body });
    event.googleEventId = saved.id;
    event.googleUpdated = saved.updated;
    event.updatedAt = saved.updated;
    count += 1;
  }
  return count;
}

async function pushTombstones(state, calendarId) {
  const left = [];
  let count = 0;
  for (const tomb of state.tombstones || []) {
    if (!tomb.googleEventId) continue;
    try {
      await api(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(tomb.googleEventId)}`, {
        method: "DELETE",
      });
      count += 1;
    } catch (error) {
      if (error.status === 404 || error.status === 410) count += 1;
      else left.push(tomb);
    }
  }
  state.tombstones = left;
  return count;
}

async function regenerateShifts(state, calendarId, note) {
  const window = shiftWindow();
  const existing = await listShiftEvents(calendarId, window.start, window.end);
  await pool(existing, 6, async (item) => {
    try {
      await api(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(item.id)}`, { method: "DELETE" });
    } catch (error) {
      if (error.status !== 404 && error.status !== 410) throw error;
    }
  });
  const generated = eachShift(state, window.start, window.end);
  let done = 0;
  await pool(generated, 6, async (entry) => {
    await api(`/calendars/${encodeURIComponent(calendarId)}/events`, {
      method: "POST",
      body: shiftToGoogleBody(entry.date, entry.shift, state.members),
    });
    done += 1;
    if (done % 20 === 0) note?.(`근무표 ${done}/${generated.length}건을 넣고 있어요…`);
  });
  return generated.length;
}

async function listShiftEvents(calendarId, start, end) {
  const items = [];
  let pageToken = "";
  do {
    const params = new URLSearchParams();
    params.set("maxResults", "250");
    params.set("singleEvents", "true");
    params.set("timeMin", `${start}T00:00:00+09:00`);
    params.set("timeMax", `${end}T23:59:59+09:00`);
    params.set("sharedExtendedProperty", "kind=shift");
    if (pageToken) params.set("pageToken", pageToken);
    const data = await api(`/calendars/${encodeURIComponent(calendarId)}/events?${params}`);
    items.push(...(data.items || []).filter((item) => item.status !== "cancelled"));
    pageToken = data.nextPageToken || "";
  } while (pageToken);
  return items;
}

function syncSummary({ configResult, pushed, removed, shifts }) {
  const configText = configResult === "pull" ? "근무 설정을 가져왔어요. " : configResult === "push" ? "근무 설정을 올렸어요. " : "";
  return `${configText}일정 ${pushed}건을 보내고 ${removed}건을 지웠어요. 근무 ${shifts}건을 다시 맞췄어요.`;
}

async function pool(items, size, worker) {
  const queue = [...items];
  const runners = Array.from({ length: Math.min(size, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      await worker(item);
    }
  });
  await Promise.all(runners);
}

async function api(path, options) {
  return apiAbsolute(`${CALENDAR_API}${path}`, options);
}

async function apiAbsolute(url, { method = "GET", body } = {}) {
  const token = currentToken();
  if (!token) throw new GoogleApiError(401, "로그인이 필요해요.");
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (response.status === 204) return null;
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }
  if (!response.ok) {
    const message = data?.error?.message || `요청이 실패했어요. (${response.status})`;
    throw new GoogleApiError(response.status, message);
  }
  return data;
}

function readStoredToken() {
  const store = session();
  if (!store) return null;
  try {
    const raw = store.getItem(TOKEN_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data?.accessToken || !data.expiresAt || Date.now() > data.expiresAt - 60000) return null;
    return data;
  } catch {
    return null;
  }
}

function writeStoredToken(token) {
  const store = session();
  if (!store) return;
  store.setItem(TOKEN_KEY, JSON.stringify(token));
}

function googleWallTime(point) {
  const raw = point?.dateTime || "";
  if (!raw) return { date: point?.date || "", time: "" };
  // 시간대 표시가 없으면 timeZone(기본 서울)의 벽시계 시간으로 봅니다.
  if (!/([zZ]|[+-]\d{2}:\d{2})$/.test(raw)) {
    const [date, clock = ""] = raw.split("T");
    return { date, time: clock.slice(0, 5) };
  }
  return seoulDateTime(raw);
}

function session() {
  try {
    if (typeof sessionStorage === "undefined") return null;
    return sessionStorage;
  } catch {
    return null;
  }
}

export function hexToRgb(hex) {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(String(hex || "").trim());
  if (!match) return null;
  const value = match[1];
  return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)];
}

export function textOn(hex) {
  const rgb = hexToRgb(hex) || [20, 20, 20];
  const luma = (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000;
  return luma > 150 ? "#1d1a16" : "#ffffff";
}
