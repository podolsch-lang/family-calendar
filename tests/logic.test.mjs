import assert from "node:assert/strict";
import fs from "node:fs";
import { addDays, daysBetween, todayISO, weekday } from "../js/dates.js";
import { holidayName } from "../js/holidays.js";
import { createDefaultState, eventOccursOn, hydrate } from "../js/store.js";
import { resolveShift } from "../js/shifts.js";
import {
  applyRemoteEventList,
  decideConfigAction,
  decodeConfig,
  encodeConfig,
  eventsToPush,
  fromGoogleEvent,
  isAfter,
  isGoogleConfigured,
  nearestColorId,
  toGoogleBody,
} from "../js/google.js";

const state = createDefaultState();
state.patterns = [
  {
    id: "a",
    memberId: "dad",
    name: "주야비비",
    startDate: "2026-11-01",
    cycle: ["shift-day", "shift-night", "shift-off", "shift-off"],
  },
  {
    id: "b",
    memberId: "dad",
    name: "3교대",
    startDate: "2026-11-20",
    cycle: ["shift-day", "shift-eve", "shift-night", "shift-rest"],
  },
];
state.overrides = [
  {
    id: "o1",
    date: "2026-11-12",
    memberId: "dad",
    shiftTypeId: "",
    name: "연차",
    shortLabel: "연",
    color: "#d50000",
    off: true,
  },
];

assert.equal(weekday("2026-11-01"), 0);
assert.equal(weekday("2026-11-10"), 2);
assert.equal(daysBetween("2026-11-01", "2026-11-21"), 20);
assert.equal(addDays("2026-11-30", 1), "2026-12-01");
assert.match(todayISO(), /^\d{4}-\d{2}-\d{2}$/);

assert.equal(resolveShift(state, "2026-10-31", "dad"), null);
assert.equal(resolveShift(state, "2026-11-01", "dad").shortLabel, "주");
assert.equal(resolveShift(state, "2026-11-02", "dad").shortLabel, "야");
assert.equal(resolveShift(state, "2026-11-03", "dad").shortLabel, "비");
assert.equal(resolveShift(state, "2026-11-04", "dad").shortLabel, "비");
assert.equal(resolveShift(state, "2026-11-12", "dad").shortLabel, "연");
assert.equal(resolveShift(state, "2026-11-12", "dad").override, true);
assert.equal(resolveShift(state, "2026-11-19", "dad").shortLabel, "비");
assert.equal(resolveShift(state, "2026-11-20", "dad").shortLabel, "주");
assert.equal(resolveShift(state, "2026-11-21", "dad").shortLabel, "오");
assert.equal(resolveShift(state, "2026-11-21", "dad").name, "오후");

assert.equal(holidayName("2026-02-17"), "설날");
assert.equal(holidayName("2026-10-05"), "개천절 대체공휴일");
assert.equal(holidayName("2026-11-10"), "");
assert.equal(holidayName("2027-09-15"), "추석");

const once = { date: "2026-11-10", endDate: "2026-11-12", repeat: "none" };
assert.equal(eventOccursOn(once, "2026-11-09"), false);
assert.equal(eventOccursOn(once, "2026-11-11"), true);
assert.equal(eventOccursOn(once, "2026-11-13"), false);
const weekly = { date: "2026-11-10", repeat: "weekly", repeatUntil: "2026-11-24" };
assert.equal(eventOccursOn(weekly, "2026-11-17"), true);
assert.equal(eventOccursOn(weekly, "2026-11-18"), false);
assert.equal(eventOccursOn(weekly, "2026-12-01"), false);
const monthly = { date: "2026-01-31", repeat: "monthly" };
assert.equal(eventOccursOn(monthly, "2026-02-28"), true);
assert.equal(eventOccursOn(monthly, "2026-03-31"), true);
assert.equal(eventOccursOn(monthly, "2026-03-30"), false);

const members = state.members;
const googleBody = toGoogleBody({
  id: "event-1",
  title: "하윤 발표",
  memberId: "child",
  date: "2026-11-15",
  allDay: false,
  startTime: "19:00",
  endTime: "07:00",
  memo: "간식",
  repeat: "weekly",
  repeatUntil: "2026-12-31",
}, members);
assert.equal(googleBody.start.dateTime, "2026-11-15T19:00:00");
assert.equal(googleBody.end.dateTime, "2026-11-16T07:00:00");
assert.equal(googleBody.colorId, "5");
assert.equal(googleBody.extendedProperties.shared.memberId, "child");
assert.match(googleBody.recurrence[0], /FREQ=WEEKLY/);

const roundTrip = fromGoogleEvent({
  id: "g1",
  status: "confirmed",
  updated: "2026-11-10T01:02:03.000Z",
  summary: "하윤 발표",
  description: "간식",
  start: googleBody.start,
  end: googleBody.end,
  recurrence: googleBody.recurrence,
  extendedProperties: googleBody.extendedProperties,
});
assert.equal(roundTrip.date, "2026-11-15");
assert.equal(roundTrip.startTime, "19:00");
assert.equal(roundTrip.endTime, "07:00");
assert.equal(roundTrip.endDate, "");
assert.equal(roundTrip.repeat, "weekly");
assert.equal(roundTrip.repeatUntil, "2026-12-31");
assert.equal(roundTrip.memberId, "child");

assert.equal(nearestColorId("#039be5"), "7");
assert.equal(nearestColorId("#e67c73"), "4");
assert.equal(nearestColorId("#0b8043"), "10");
assert.equal(isAfter("2026-11-10T00:00:00.000Z", "2026-11-09T00:00:00Z"), true);
assert.equal(isAfter("2026-11-10T00:00:00Z", "2026-11-10T00:00:00.000Z"), false);

const packed = encodeConfig({
  app: "family-calendar",
  configUpdatedAt: "2026-11-10T00:00:00.000Z",
  members,
  shiftTypes: state.shiftTypes,
  patterns: state.patterns,
  overrides: state.overrides,
});
const decoded = decodeConfig(packed);
assert.equal(decoded.patterns.length, 2);
assert.equal(decoded.overrides[0].name, "연차");
assert.equal(decideConfigAction(null, "2026-11-01T00:00:00.000Z"), "pull");
assert.equal(decideConfigAction("2026-11-02T00:00:00.000Z", "2026-11-01T00:00:00.000Z"), "push");
assert.equal(decideConfigAction("2026-11-01T00:00:00.000Z", "2026-11-01T00:00:00.000Z"), "keep");

const local = hydrate({
  events: [
    { id: "keep", title: "로컬이 최신", date: "2026-11-10", updatedAt: "2026-11-10T02:00:00.000Z", googleEventId: "g-keep", googleUpdated: "2026-11-10T01:00:00.000Z", memberId: "mom" },
    { id: "old", title: "예전", date: "2026-11-11", updatedAt: "2026-11-01T00:00:00.000Z", googleEventId: "g-old", googleUpdated: "2026-11-01T00:00:00.000Z", memberId: "dad" },
  ],
  tombstones: [],
});
applyRemoteEventList(local, [
  {
    id: "g-old",
    status: "confirmed",
    updated: "2026-11-12T00:00:00.000Z",
    summary: "원격이 최신",
    start: { date: "2026-11-11" },
    end: { date: "2026-11-12" },
    extendedProperties: { shared: { app: "family-calendar", kind: "event", localId: "old", memberId: "dad" } },
  },
  {
    id: "g-new",
    status: "confirmed",
    updated: "2026-11-12T00:00:00.000Z",
    summary: "엄마가 넣은 일정",
    start: { date: "2026-11-13" },
    end: { date: "2026-11-14" },
    extendedProperties: { shared: { kind: "event", localId: "from-mom", memberId: "mom" } },
  },
  {
    id: "shift-1",
    status: "confirmed",
    updated: "2026-11-12T00:00:00.000Z",
    summary: "아빠 주간",
    start: { date: "2026-11-01" },
    end: { date: "2026-11-02" },
    extendedProperties: { shared: { kind: "shift" } },
  },
  { id: "g-keep", status: "cancelled" },
]);
assert.equal(local.events.find((event) => event.id === "keep"), undefined);
assert.equal(local.events.find((event) => event.id === "old").title, "원격이 최신");
assert.equal(local.events.find((event) => event.id === "from-mom").title, "엄마가 넣은 일정");
assert.equal(local.events.some((event) => event.title === "아빠 주간"), false);
assert.equal(eventsToPush(local).length, 0);

const versionJs = fs.readFileSync("version.js", "utf8");
const sw = fs.readFileSync("sw.js", "utf8");
const version = versionJs.match(/APP_VERSION = "([^"]+)"/)[1];
assert.match(sw, new RegExp(`VERSION = "${version}"`));
assert.match(sw, new RegExp(`family-calendar-v\\$\\{VERSION\\}`));

const html = fs.readFileSync("index.html", "utf8");
for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  const path = match[1].split("?")[0];
  if (path.startsWith("http") || path.startsWith("#")) continue;
  assert.equal(fs.existsSync(path), true, path);
}

globalThis.window = { APP_CONFIG: { GOOGLE_CLIENT_ID: "" } };
assert.equal(isGoogleConfigured(), false);
globalThis.window = { APP_CONFIG: { GOOGLE_CLIENT_ID: "abc.apps.googleusercontent.com" } };
assert.equal(isGoogleConfigured(), true);
globalThis.window = { APP_CONFIG: { GOOGLE_CLIENT_ID: "YOUR_CLIENT_ID" } };
assert.equal(isGoogleConfigured(), false);
delete globalThis.window;

console.log("logic tests ok");
