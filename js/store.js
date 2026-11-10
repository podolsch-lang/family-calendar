import { weekday, daysInMonth } from "./dates.js";
import { DEFAULT_SHIFT_TYPES } from "./shifts.js";

export const STORAGE_KEY = "family-calendar.v1";

export const DEFAULT_MEMBERS = [
  { id: "dad", name: "아빠", color: "#039be5" },
  { id: "mom", name: "엄마", color: "#e67c73" },
  { id: "child", name: "하윤", color: "#f6bf26" },
  { id: "family", name: "가족 전체", color: "#0b8043", everyone: true },
];

export function createDefaultState() {
  return {
    schema: 1,
    members: DEFAULT_MEMBERS.map((member) => ({ ...member })),
    shiftTypes: DEFAULT_SHIFT_TYPES.map((type) => ({ ...type })),
    patterns: [],
    overrides: [],
    events: [],
    tombstones: [],
    configUpdatedAt: null,
    google: {
      calendarId: "",
      calendarSummary: "",
      syncToken: "",
      lastSyncAt: "",
      lastSyncMessage: "",
      accountEmail: "",
    },
    ui: {
      hiddenMemberIds: [],
      view: "month",
      lastMemberId: "family",
    },
  };
}

export function hydrate(raw) {
  const base = createDefaultState();
  if (!raw || typeof raw !== "object") return base;
  return {
    ...base,
    ...raw,
    members: Array.isArray(raw.members) && raw.members.length ? raw.members : base.members,
    shiftTypes: Array.isArray(raw.shiftTypes) && raw.shiftTypes.length ? raw.shiftTypes : base.shiftTypes,
    patterns: Array.isArray(raw.patterns) ? raw.patterns : [],
    overrides: Array.isArray(raw.overrides) ? raw.overrides : [],
    events: Array.isArray(raw.events) ? raw.events : [],
    tombstones: Array.isArray(raw.tombstones) ? raw.tombstones : [],
    configUpdatedAt: raw.configUpdatedAt || null,
    google: { ...base.google, ...(raw.google || {}) },
    ui: { ...base.ui, ...(raw.ui || {}) },
  };
}

export function loadState() {
  const store = browserStorage();
  if (!store) return createDefaultState();
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return createDefaultState();
    return hydrate(JSON.parse(raw));
  } catch {
    return createDefaultState();
  }
}

export function saveState(state) {
  const store = browserStorage();
  if (!store) return;
  store.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function touchConfig(state, when = new Date().toISOString()) {
  state.configUpdatedAt = when;
  return state;
}

export function configSlice(state) {
  return {
    app: "family-calendar",
    configUpdatedAt: state.configUpdatedAt,
    members: state.members,
    shiftTypes: state.shiftTypes,
    patterns: state.patterns,
    overrides: state.overrides,
  };
}

export function applyRemoteConfig(state, config) {
  state.members = config.members;
  state.shiftTypes = config.shiftTypes;
  state.patterns = config.patterns;
  state.overrides = config.overrides;
  state.configUpdatedAt = config.configUpdatedAt || state.configUpdatedAt;
  return state;
}

export function eventOccursOn(event, iso) {
  if (!event?.date || !iso || iso < event.date) return false;
  if (event.repeatUntil && iso > event.repeatUntil) return false;
  const repeat = event.repeat || "none";
  if (repeat === "none") {
    const end = event.endDate && event.endDate >= event.date ? event.endDate : event.date;
    return iso <= end;
  }
  if (repeat === "daily") return true;
  if (repeat === "weekly") return weekday(iso) === weekday(event.date);
  if (repeat === "monthly") {
    const startDay = Number(event.date.slice(8, 10));
    const target = Math.min(startDay, daysInMonth(iso));
    return Number(iso.slice(8, 10)) === target;
  }
  return false;
}

export function uid(prefix = "id") {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function browserStorage() {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}
