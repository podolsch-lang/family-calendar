import { addDays, daysBetween } from "./dates.js";

export const DEFAULT_SHIFT_TYPES = [
  { id: "shift-day", name: "주간", shortLabel: "주", color: "#fb8c00", startTime: "07:00", endTime: "19:00", off: false },
  { id: "shift-eve", name: "오후", shortLabel: "오", color: "#8e24aa", startTime: "15:00", endTime: "23:00", off: false },
  { id: "shift-night", name: "야간", shortLabel: "야", color: "#3949ab", startTime: "19:00", endTime: "07:00", off: false },
  { id: "shift-off", name: "비번", shortLabel: "비", color: "#78909c", startTime: "", endTime: "", off: true },
  { id: "shift-rest", name: "휴무", shortLabel: "휴", color: "#00897b", startTime: "", endTime: "", off: true },
];

export const PRESETS = [
  {
    id: "juya-bibi",
    name: "4조2교대 주야비비",
    blurb: "주간 → 야간 → 비번 → 비번",
    cycleNames: ["주간", "야간", "비번", "비번"],
  },
  {
    id: "three-shift",
    name: "3교대",
    blurb: "주간 → 오후 → 야간 → 휴무",
    cycleNames: ["주간", "오후", "야간", "휴무"],
  },
  {
    id: "two-shift",
    name: "2교대",
    blurb: "주간 → 야간 → 휴무 → 휴무",
    cycleNames: ["주간", "야간", "휴무", "휴무"],
  },
];

const PRESET_FALLBACK_IDS = {
  주간: "shift-day",
  오후: "shift-eve",
  야간: "shift-night",
  비번: "shift-off",
  휴무: "shift-rest",
};

export function typeById(state, id) {
  return (state.shiftTypes || []).find((type) => type.id === id) || null;
}

export function resolveTypeId(state, name) {
  const found = (state.shiftTypes || []).find((type) => type.name === name);
  if (found) return found.id;
  const fallback = PRESET_FALLBACK_IDS[name];
  if (fallback && typeById(state, fallback)) return fallback;
  return "";
}

export function cycleFromPreset(state, preset) {
  return preset.cycleNames.map((name) => resolveTypeId(state, name)).filter(Boolean);
}

export function patternsForMember(state, memberId) {
  return (state.patterns || [])
    .filter((pattern) => pattern.memberId === memberId)
    .slice()
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.id.localeCompare(b.id));
}

export function patternWindows(state, memberId) {
  const list = patternsForMember(state, memberId);
  return list.map((pattern, index) => ({
    ...pattern,
    endDate: list[index + 1] ? addDays(list[index + 1].startDate, -1) : "",
  }));
}

export function activePattern(state, iso, memberId) {
  const list = patternsForMember(state, memberId).filter((pattern) => pattern.startDate <= iso);
  return list.length ? list[list.length - 1] : null;
}

export function overrideOn(state, iso, memberId) {
  return (state.overrides || []).find((item) => item.date === iso && item.memberId === memberId) || null;
}

export function resolveShift(state, iso, memberId) {
  const override = overrideOn(state, iso, memberId);
  if (override) return shiftFromOverride(state, override);

  const pattern = activePattern(state, iso, memberId);
  if (!pattern || !pattern.cycle || !pattern.cycle.length) return null;
  const diff = daysBetween(pattern.startDate, iso);
  if (diff < 0) return null;
  const typeId = pattern.cycle[diff % pattern.cycle.length];
  const type = typeById(state, typeId);
  if (!type) {
    return baseShift(memberId, {
      typeId: null,
      name: "삭제된 근무",
      shortLabel: "?",
      color: "#9ca3af",
      startTime: "",
      endTime: "",
      off: true,
      override: false,
      patternId: pattern.id,
      patternName: pattern.name,
      missing: true,
    });
  }
  return baseShift(memberId, {
    typeId: type.id,
    name: type.name,
    shortLabel: type.shortLabel || type.name.slice(0, 1),
    color: type.color,
    startTime: type.startTime || "",
    endTime: type.endTime || "",
    off: !!type.off,
    override: false,
    patternId: pattern.id,
    patternName: pattern.name,
  });
}

export function shiftsOn(state, iso) {
  const memberIds = new Set();
  for (const pattern of state.patterns || []) memberIds.add(pattern.memberId);
  for (const override of state.overrides || []) {
    if (override.date === iso) memberIds.add(override.memberId);
  }
  const result = [];
  for (const memberId of memberIds) {
    const shift = resolveShift(state, iso, memberId);
    if (shift) result.push(shift);
  }
  return result;
}

export function eachShift(state, startIso, endIso) {
  const out = [];
  if (!startIso || !endIso || startIso > endIso) return out;
  for (let iso = startIso; iso <= endIso; iso = addDays(iso, 1)) {
    for (const shift of shiftsOn(state, iso)) out.push({ date: iso, shift });
  }
  return out;
}

export function previewCycle(cycle, types, startDate, days = 14) {
  if (!cycle.length || !startDate) return [];
  const out = [];
  for (let i = 0; i < days; i += 1) {
    const typeId = cycle[i % cycle.length];
    const type = types.find((item) => item.id === typeId) || null;
    out.push({ date: addDays(startDate, i), type });
  }
  return out;
}

function shiftFromOverride(state, override) {
  if (override.shiftTypeId) {
    const type = typeById(state, override.shiftTypeId);
    if (type) {
      return baseShift(override.memberId, {
        typeId: type.id,
        name: type.name,
        shortLabel: type.shortLabel || type.name.slice(0, 1),
        color: type.color,
        startTime: type.startTime || "",
        endTime: type.endTime || "",
        off: !!type.off,
        override: true,
        memo: override.memo || "",
        patternId: "",
        patternName: "",
      });
    }
  }
  return baseShift(override.memberId, {
    typeId: null,
    name: override.name || "변경",
    shortLabel: override.shortLabel || "변",
    color: override.color || "#d50000",
    startTime: override.startTime || "",
    endTime: override.endTime || "",
    off: override.off !== false,
    override: true,
    memo: override.memo || "",
    patternId: "",
    patternName: "",
  });
}

function baseShift(memberId, fields) {
  return {
    memberId,
    memo: "",
    missing: false,
    ...fields,
  };
}
