import { holidayName, holidayShort } from "./holidays.js";
import {
  PRESETS,
  cycleFromPreset,
  patternWindows,
  previewCycle,
  resolveShift,
  shiftsOn,
  typeById,
} from "./shifts.js";
import {
  eventOccursOn,
  loadState,
  saveState,
  touchConfig,
  uid,
} from "./store.js";
import {
  WEEKDAYS,
  addDays,
  addMonths,
  daysInMonth,
  formatFull,
  formatMonthDay,
  formatWeekRange,
  formatYearMonth,
  todayISO,
  weekday,
  weekdayLabel,
} from "./dates.js";
import {
  QUICK_CUSTOM,
  createFamilyCalendar,
  currentToken,
  fetchProfile,
  friendlyGoogleError,
  isGoogleConfigured,
  isSignedIn,
  listCalendars,
  loadGis,
  shareCalendar,
  signIn,
  signOut,
  syncAll,
  textOn,
} from "./google.js";

const SWATCHES = ["#039be5", "#e67c73", "#f6bf26", "#0b8043", "#8e24aa", "#f4511e", "#3949ab", "#00897b", "#d81b60", "#6d4c41", "#fb8c00", "#78909c"];
const REPEAT_LABEL = { none: "반복 없음", daily: "매일", weekly: "매주", monthly: "매월" };

const nav = { tab: "calendar", month: "", selected: "" };
let state = null;
let sheet = null;
let calendars = [];
let syncing = false;
let deferredInstall = null;
let toastTimer = 0;

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  if (tag === "button" && !props.type) node.type = "button";
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = String(value);
    else if (key === "dataset" && typeof value === "object") {
      for (const [dataKey, dataValue] of Object.entries(value)) {
        if (dataValue != null) node.dataset[dataKey] = String(dataValue);
      }
    } else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === "value") node.value = value;
    else if (key === "checked" || key === "disabled" || key === "readOnly") node[key] = Boolean(value);
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

const ICONS = {
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3.5 9.5h17M8 3.5v4M16 3.5v4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  shift: '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 8v5l3 2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  settings: '<circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 3.5v2.2M12 18.3V20.5M3.5 12h2.2M18.3 12h2.2M5.8 5.8l1.6 1.6M16.6 16.6l1.6 1.6M18.2 5.8l-1.6 1.6M7.4 16.6l-1.6 1.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  plus: '<path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
};

function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("icon");
  svg.innerHTML = ICONS[name] || "";
  return svg;
}

function showToast(message) {
  const host = document.getElementById("toasts");
  if (!host) return;
  host.replaceChildren(el("div", { class: "toast", text: message }));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => host.replaceChildren(), 3200);
}

function vibrate() {
  try {
    navigator.vibrate?.(12);
  } catch {
    // 진동을 지원하지 않는 브라우저입니다.
  }
}

function commit(mutator) {
  mutator(state);
  try {
    saveState(state);
  } catch {
    showToast("이 휴대폰에 저장하지 못했어요. 저장 공간을 확인해 주세요.");
  }
  renderMain();
}

function memberById(id) {
  return state.members.find((member) => member.id === id) || { id, name: "기타", color: "#9ca3af" };
}

function memberVisible(id) {
  return !(state.ui.hiddenMemberIds || []).includes(id);
}

function personMembers() {
  const people = state.members.filter((member) => !member.everyone);
  return people.length ? people : state.members;
}

function visibleEvents(iso) {
  return state.events.filter((event) => eventOccursOn(event, iso) && memberVisible(event.memberId));
}

function visibleShifts(iso) {
  return shiftsOn(state, iso).filter((shift) => memberVisible(shift.memberId));
}

function boot() {
  state = loadState();
  const today = todayISO();
  nav.selected = today;
  nav.month = today.slice(0, 7);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeSheet();
  });
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstall = event;
    if (nav.tab === "settings") renderMain();
  });
  renderMain();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
  if (isGoogleConfigured()) loadGis();
}

function renderMain() {
  const root = document.getElementById("app");
  const previous = root.querySelector(".main");
  const scrollTop = previous ? previous.scrollTop : 0;
  const nodes = [renderHeader()];
  const banner = renderBanner();
  if (banner) nodes.push(banner);
  nodes.push(renderBody(), renderNav());
  if (nav.tab === "calendar") nodes.push(renderFab());
  root.replaceChildren(...nodes);
  const main = root.querySelector(".main");
  if (main) main.scrollTop = scrollTop;
}

function renderHeader() {
  if (nav.tab !== "calendar") {
    const title = nav.tab === "shifts" ? "근무" : "설정";
    const sub = nav.tab === "shifts"
      ? "패턴은 시작일부터 앞으로만 바뀌어요. 지난 근무는 그대로 둡니다."
      : "구성원, Google 연동, 앱 정보";
    return el("header", { class: "top" },
      el("h1", { class: "page-title", text: title }),
      el("p", { class: "sub", text: sub }));
  }
  const view = state.ui.view || "month";
  const label = view === "week" ? formatWeekRange(nav.selected) : view === "day" ? formatFull(nav.selected) : formatYearMonth(nav.month);
  return el("header", { class: "top" },
    el("div", { class: "top-row" },
      el("p", { class: "brand", text: "우리 가족 캘린더" }),
      el("div", { class: "top-row" },
        state.google.calendarId && isGoogleConfigured()
          ? el("button", {
              class: "sync-btn",
              dataset: { action: "sync" },
              disabled: syncing,
              onclick: () => runSync(),
              text: syncing ? "동기화 중" : "동기화",
            })
          : null,
        el("button", { class: "today-btn", dataset: { action: "today" }, onclick: goToday, text: "오늘" }))),
    el("div", { class: "period-row" },
      el("button", { class: "icon-btn", dataset: { action: "prev" }, "aria-label": "이전", onclick: () => movePeriod(-1), text: "‹" }),
      el("h1", { class: "period-label", text: label }),
      el("button", { class: "icon-btn", dataset: { action: "next" }, "aria-label": "다음", onclick: () => movePeriod(1), text: "›" })),
    el("div", { class: "seg", role: "tablist", "aria-label": "달력 보기" },
      ...["month", "week", "day"].map((id) => el("button", {
        dataset: { view: id },
        class: view === id ? "on" : "",
        "aria-pressed": view === id ? "true" : "false",
        onclick: () => setView(id),
        text: id === "month" ? "월" : id === "week" ? "주" : "일",
      }))),
    el("div", { class: "chips" }, ...state.members.map((member) => {
      const off = !memberVisible(member.id);
      return el("button", {
        class: `chip${off ? " off" : ""}`,
        dataset: { filter: member.id },
        "aria-pressed": off ? "false" : "true",
        onclick: () => toggleMember(member.id),
      }, el("span", { class: "dot", style: `background:${member.color}` }), member.name);
    })));
}

function renderBanner() {
  if (nav.tab === "settings") return null;
  if (!isGoogleConfigured()) {
    return el("div", { class: "banner" },
      el("p", { text: "지금은 이 휴대폰에만 저장돼요. Google 캘린더와 연결하면 두 사람이 같은 일정을 볼 수 있어요." }),
      el("button", {
        class: "btn btn-small",
        onclick: () => { nav.tab = "settings"; renderMain(); },
        text: "연결 안내",
      }));
  }
  if (!state.google.calendarId) {
    return el("div", { class: "banner" },
      el("p", { text: "Google 연결 준비가 끝났어요. 설정에서 가족 캘린더를 고르면 함께 쓸 수 있어요." }),
      el("button", {
        class: "btn btn-small",
        onclick: () => { nav.tab = "settings"; renderMain(); },
        text: "설정으로",
      }));
  }
  return null;
}

function renderBody() {
  const body = nav.tab === "shifts" ? renderShifts() : nav.tab === "settings" ? renderSettings() : renderCalendar();
  return el("main", { class: "main" }, body);
}

function renderNav() {
  const items = [
    ["calendar", "달력", "calendar"],
    ["shifts", "근무", "shift"],
    ["settings", "설정", "settings"],
  ];
  return el("nav", { class: "nav" }, ...items.map(([id, label, glyph]) => el("button", {
    dataset: { tab: id },
    class: nav.tab === id ? "on" : "",
    "aria-current": nav.tab === id ? "page" : null,
    onclick: () => { nav.tab = id; closeSheet(); renderMain(); },
  }, icon(glyph), label)));
}

function renderFab() {
  return el("button", {
    class: "fab",
    dataset: { action: "add-event" },
    "aria-label": "일정 추가",
    onclick: () => openEvent(),
  }, icon("plus"));
}

function renderCalendar() {
  const view = state.ui.view || "month";
  if (view === "week") return renderWeek();
  if (view === "day") return renderDay();
  return renderMonth();
}

function renderMonth() {
  const today = todayISO();
  const cells = [];
  const grid = monthDates(nav.month);
  for (const iso of grid) {
    const shifts = visibleShifts(iso);
    const events = visibleEvents(iso);
    const holiday = holidayName(iso);
    const dow = weekday(iso);
    const classes = ["cell"];
    if (iso === nav.selected) classes.push("selected");
    if (iso === today) classes.push("today");
    if (iso.slice(0, 7) !== nav.month) classes.push("out");
    const numberClass = ["num"];
    if (holiday || dow === 0) numberClass.push("sun");
    else if (dow === 6) numberClass.push("sat");
    const labelBits = [formatFull(iso)];
    if (holiday) labelBits.push(holiday);
    if (shifts.length) labelBits.push(shifts.map((shift) => shift.name).join(", "));
    cells.push(el("button", {
      class: classes.join(" "),
      dataset: { date: iso, shiftLabel: shifts.map((shift) => shift.shortLabel).join(",") },
      "aria-label": labelBits.join(" "),
      "aria-pressed": iso === nav.selected ? "true" : "false",
      onclick: () => selectDate(iso),
    },
    el("span", { class: numberClass.join(" "), text: String(Number(iso.slice(8))) }),
    ...shifts.slice(0, 2).map(badge),
    holiday && !shifts.length ? el("span", { class: "holiday", text: holidayShort(iso) }) : null,
    eventDots(events)));
  }
  return el("div", {},
    el("div", { class: "dow-row" }, ...WEEKDAYS.map((label, index) => el("span", {
      class: index === 0 ? "dow sun" : index === 6 ? "dow sat" : "dow",
      text: label,
    }))),
    el("div", { class: "grid" }, ...cells),
    renderAgenda(nav.selected, { heading: true, showAdd: false }));
}

function eventDots(events) {
  const shown = events.slice(0, 3);
  return el("span", { class: "dots" },
    ...shown.map((event) => el("i", { class: "event-dot", style: `background:${memberById(event.memberId).color}` })),
    events.length > 3 ? el("span", { class: "more", text: `+${events.length - 3}` }) : null);
}

function renderWeek() {
  const days = weekDatesOf(nav.selected);
  return el("div", {},
    el("div", { class: "week-strip" }, ...days.map((iso) => {
      const shifts = visibleShifts(iso);
      const dow = weekday(iso);
      const holiday = holidayName(iso);
      const numClass = ["num"];
      if (holiday || dow === 0) numClass.push("sun");
      else if (dow === 6) numClass.push("sat");
      if (iso === todayISO()) numClass.push("today");
      return el("button", {
        class: `mini-day${iso === nav.selected ? " on" : ""}`,
        dataset: { date: iso, shiftLabel: shifts.map((shift) => shift.shortLabel).join(",") },
        onclick: () => selectDate(iso),
      },
      el("span", { class: "small", text: WEEKDAYS[dow] }),
      el("span", { class: numClass.join(" "), text: String(Number(iso.slice(8))) }),
      ...shifts.slice(0, 1).map(badge));
    })),
    ...days.map((iso) => renderAgenda(iso, { heading: true, hideEmpty: true })));
}

function renderDay() {
  return renderAgenda(nav.selected, { heading: true, large: true });
}

function renderAgenda(iso, { heading = false, hideEmpty = false, large = false, showAdd = true } = {}) {
  const items = agendaItems(iso);
  if (hideEmpty && !items.length && !holidayName(iso)) return null;
  const holiday = holidayName(iso);
  const head = heading ? el("div", { class: "agenda-head" },
    el("h2", {},
      formatFull(iso),
      holiday ? el("span", { class: "sun-text", text: ` · ${holiday}` }) : null),
    showAdd ? el("button", { class: "btn btn-small", onclick: () => openEvent(null, iso), text: "일정 추가" }) : null) : null;
  const body = items.length
    ? el("div", { class: "stack" }, ...items.map((item) => item.kind === "shift" ? shiftRow(iso, item.shift) : eventRow(item.event)))
    : el("div", { class: "empty", text: large ? "이 날은 아직 일정이 없어요." : "일정 없음" });
  return el("section", { class: "day-block", dataset: { agenda: iso } }, head, body);
}

function agendaItems(iso) {
  const items = [];
  for (const shift of visibleShifts(iso)) {
    items.push({ kind: "shift", shift, sort: `${shift.off ? "0" : "1"}${shift.startTime || "99:99"}` });
  }
  for (const event of state.events) {
    if (!eventOccursOn(event, iso) || !memberVisible(event.memberId)) continue;
    items.push({ kind: "event", event, sort: `${event.allDay ? "0" : "1"}${event.startTime || "99:99"}` });
  }
  items.sort((a, b) => a.sort.localeCompare(b.sort));
  return items;
}

function shiftRow(iso, shift) {
  const member = memberById(shift.memberId);
  return el("button", { class: "shift-card", onclick: () => openOverride(iso, shift.memberId) },
    el("span", { class: "bar", style: `background:${shift.color}` }),
    el("span", { class: "shift-body" },
      el("div", { class: "shift-title", text: `${member.name} · ${shift.name}${shift.override ? " · 변경" : ""}` }),
      el("div", { class: "meta", text: shiftTimeLabel(shift) }),
      shift.memo ? el("p", { class: "memo", text: shift.memo }) : null));
}

function eventRow(event) {
  const member = memberById(event.memberId);
  const bits = [eventTimeLabel(event), member.name];
  if (event.repeat && event.repeat !== "none") bits.push(REPEAT_LABEL[event.repeat] || "");
  return el("button", { class: "event", onclick: () => openEvent(event) },
    el("span", { class: "bar", style: `background:${member.color}` }),
    el("span", { class: "event-body" },
      el("div", { class: "event-title", text: event.title }),
      el("div", { class: "meta", text: bits.filter(Boolean).join(" · ") }),
      event.memo ? el("p", { class: "memo", text: event.memo }) : null));
}

function renderShifts() {
  const memberId = preferredShiftMember();
  const today = todayISO();
  const todayShift = resolveShift(state, today, memberId);
  const upcoming = Array.from({ length: 14 }, (_, index) => addDays(today, index));
  const windows = patternWindows(state, memberId);
  return el("div", {},
    el("section", { class: "card" },
      el("h2", { text: "오늘 근무" }),
      personMembers().length > 1 ? field("누구", selectEl(memberId, personMembers().map((member) => ({ value: member.id, label: member.name })), (value) => {
        nav.shiftMember = value;
        renderMain();
      })) : null,
      todayShift
        ? el("div", { class: "stack" }, shiftRow(today, todayShift))
        : el("p", { class: "muted", text: "오늘 적용되는 패턴이 없어요." }),
      el("div", { class: "preview-row", style: "margin-top:10px" }, ...upcoming.map((iso) => {
        const shift = resolveShift(state, iso, memberId);
        return el("div", { class: "preview-day" },
          el("span", { text: `${Number(iso.slice(8))} ${weekdayLabel(iso)}` }),
          shift ? badge(shift) : el("span", { text: "·" }));
      }))),
    el("section", { class: "card" },
      el("h2", { text: "바로 만들기" }),
      el("p", { class: "muted small", text: "고른 뒤 시작일을 맞추고 저장하세요. 시작일의 근무가 순환의 첫날입니다." }),
      el("div", { class: "preset-row" }, ...PRESETS.map((preset) => el("button", {
        class: "preset",
        dataset: { openPreset: preset.id },
        onclick: () => openPattern(null, preset.id),
      }, el("div", { text: preset.name }), el("div", { class: "small muted", text: preset.blurb }))))),
    el("section", { class: "card" },
      el("div", { class: "sheet-head" },
        el("h2", { text: "패턴 기간" }),
        el("button", { class: "btn btn-small", dataset: { action: "new-pattern" }, onclick: () => openPattern(null), text: "새 패턴" })),
      windows.length
        ? windows.map((pattern) => patternCard(pattern))
        : el("p", { class: "muted", text: "아직 패턴이 없어요. 위 프리셋으로 시작해 보세요." })),
    el("section", { class: "card" },
      el("div", { class: "sheet-head" },
        el("h2", { text: "하루만 바꾸기" }),
        el("button", { class: "btn btn-small", dataset: { action: "add-override" }, onclick: () => openOverride(nav.selected || today, memberId), text: "추가" })),
      el("p", { class: "muted small", text: "연차, 교육, 근무 변경처럼 그날만 다르게 둡니다. 다른 날은 패턴 그대로예요." }),
      overrideList(memberId)),
    el("section", { class: "card" },
      el("div", { class: "sheet-head" },
        el("h2", { text: "근무 종류" }),
        el("button", { class: "btn btn-small", onclick: () => openShiftType(null), text: "추가" })),
      ...state.shiftTypes.map((type) => el("div", { class: "list-row" },
        badge(type),
        el("div", { class: "grow" },
          el("strong", { text: type.name }),
          el("div", { class: "small muted", text: type.off || !type.startTime ? "시간 없음" : `${type.startTime}–${type.endTime}` })),
        el("button", { class: "btn btn-small", onclick: () => openShiftType(type), text: "수정" })))));
}

function patternCard(pattern) {
  const range = pattern.endDate ? `${dotDate(pattern.startDate)} – ${dotDate(pattern.endDate)}` : `${dotDate(pattern.startDate)}부터 계속`;
  return el("div", { class: "list-row", dataset: { patternStart: pattern.startDate } },
    el("div", { class: "grow" },
      el("strong", { text: pattern.name || "이름 없는 패턴" }),
      el("div", { class: "small muted", text: `${memberById(pattern.memberId).name} · ${range}` }),
      el("div", { class: "preview-row", style: "margin-top:6px" }, ...(pattern.cycle || []).map((id) => {
        const type = typeById(state, id);
        return type ? badge(type) : el("span", { class: "badge", text: "?" });
      }))),
    el("button", {
      class: "btn btn-small",
      dataset: { editPattern: pattern.id },
      onclick: () => openPattern(pattern),
      text: "수정",
    }));
}

function overrideList(memberId) {
  const items = state.overrides
    .filter((item) => item.memberId === memberId)
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 20);
  if (!items.length) return el("p", { class: "muted", text: "바꿔 둔 날이 없어요." });
  return el("div", {}, ...items.map((item) => {
    const shift = resolveShift(state, item.date, item.memberId);
    return el("div", { class: "list-row" },
      shift ? badge(shift) : null,
      el("div", { class: "grow", text: `${formatMonthDay(item.date)} ${weekdayLabel(item.date)} · ${shift?.name || "변경"}` }),
      el("button", { class: "btn btn-small", onclick: () => openOverride(item.date, item.memberId), text: "수정" }),
      el("button", { class: "btn btn-small btn-danger", onclick: () => removeOverride(item.id), text: "삭제" }));
  }));
}

function renderSettings() {
  return el("div", {},
    el("section", { class: "card" },
      el("div", { class: "sheet-head" },
        el("h2", { text: "가족" }),
        el("button", { class: "btn btn-small", onclick: () => openMember(), text: "추가" })),
      el("p", { class: "muted small", text: "이름과 색은 두 휴대폰을 연결하면 함께 맞춰져요." }),
      ...state.members.map((member) => memberRow(member))),
    googleCard(),
    installCard(),
    el("p", { class: "version", text: `버전 ${window.APP_VERSION || "1.0"}` }));
}

function memberRow(member) {
  return el("div", { class: "member-row" },
    el("input", {
      type: "color",
      value: member.color,
      "aria-label": `${member.name} 색`,
      onchange: (event) => updateMember(member.id, { color: normalizeColor(event.target.value, member.color) }),
    }),
    el("input", {
      type: "text",
      value: member.name,
      "aria-label": "이름",
      maxlength: "20",
      onchange: (event) => {
        const name = event.target.value.trim();
        if (name) updateMember(member.id, { name });
      },
    }),
    member.everyone ? null : el("button", { class: "btn btn-small btn-danger", onclick: () => deleteMember(member.id), text: "삭제" }));
}

function googleCard() {
  if (!isGoogleConfigured()) {
    return el("section", { class: "card" },
      el("h2", { text: "Google 캘린더" }),
      el("p", { class: "muted", text: "아직 연결 설정 전이에요. 일정과 근무는 이 휴대폰에만 남고, 앱은 그대로 쓸 수 있어요." }),
      el("ol", { class: "steps" },
        el("li", { text: "Google Cloud에서 캘린더 API를 켜고, 테스트 사용자에 두 사람 Gmail을 넣어요." }),
        el("li", { text: "웹 클라이언트 ID를 만들고, 자바스크립트 원본에 https://podolsch-lang.github.io 를 적어요. 뒤에 폴더 이름은 붙이지 않아요." }),
        el("li", { text: "그 ID를 config.js 의 GOOGLE_CLIENT_ID 에 붙여 넣고 저장한 뒤, 사이트를 새로고침해요." })),
      el("p", { class: "small muted", text: "차근차근 설명은 저장소의 docs/GOOGLE_SETUP.md 에 있습니다." }),
      el("p", { class: "small muted", text: `지금 주소: ${location.origin}` }));
  }
  const signed = isSignedIn();
  return el("section", { class: "card" },
    el("h2", { text: "Google 캘린더" }),
    el("p", { class: "muted small", text: "가족 공유 캘린더 하나에 일정을 넣고, 근무표는 표시를 달아 두었다가 패턴이 바뀌면 그 구간만 다시 씁니다. 일반 일정은 건드리지 않아요." }),
    state.google.accountEmail ? el("p", { text: state.google.accountEmail }) : null,
    signed
      ? el("div", { class: "row-actions" },
        el("button", { class: "btn", onclick: () => refreshCalendars(), text: "캘린더 목록" }),
        el("button", { class: "btn", onclick: () => makeCalendar(), text: "가족 공유 캘린더 만들기" }),
        el("button", { class: "btn btn-ghost", onclick: () => disconnect(), text: "연결 끊기" }))
      : el("button", { class: "btn btn-primary", onclick: () => connectGoogle(), text: "Google로 연결" }),
    signed && calendars.length
      ? field("함께 쓸 캘린더", selectEl(state.google.calendarId, [
          { value: "", label: "캘린더를 골라 주세요" },
          ...calendars.map((item) => ({ value: item.id, label: `${item.summary}${item.primary ? " (기본)" : ""}` })),
        ], (value) => chooseCalendar(value)))
      : null,
    state.google.calendarSummary ? el("p", { class: "small", text: `선택됨: ${state.google.calendarSummary}` }) : null,
    state.google.calendarId
      ? el("div", {},
        el("button", {
          class: "btn btn-primary",
          disabled: syncing,
          dataset: { action: "sync" },
          onclick: () => runSync(),
          text: syncing ? "동기화 중…" : "동기화",
        }),
        el("p", { class: "small muted", text: "근무 일정은 오늘 기준 한 달 전부터 앞으로 약 4개월까지 넣어요." }),
        field("엄마 Gmail 초대", el("input", {
          type: "email",
          placeholder: "mom@gmail.com",
          dataset: { field: "invite-email" },
          oninput: (event) => { nav.inviteEmail = event.target.value; },
          value: nav.inviteEmail || "",
        })),
        el("button", { class: "btn", onclick: () => invite(nav.inviteEmail || ""), text: "수정 권한으로 초대" }))
      : null,
    state.google.lastSyncMessage ? el("p", { class: "small", text: state.google.lastSyncMessage }) : null,
    state.google.lastSyncAt ? el("p", { class: "small muted", text: `마지막 동기화 ${state.google.lastSyncAt.slice(0, 16).replace("T", " ")}` }) : null);
}

function installCard() {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent || "");
  const standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
  return el("section", { class: "card" },
    el("h2", { text: "홈 화면에 추가" }),
    standalone
      ? el("p", { class: "muted", text: "이미 홈 화면 앱으로 열고 있어요." })
      : ios
        ? el("p", { class: "muted", text: "Safari에서 공유 버튼을 누른 다음 ‘홈 화면에 추가’를 누르세요." })
        : el("div", {},
          el("p", { class: "muted", text: "Android Chrome에서는 아래 버튼이나 브라우저 메뉴의 ‘홈 화면에 추가’를 쓰면 돼요." }),
          deferredInstall
            ? el("button", { class: "btn btn-primary", onclick: () => installApp(), text: "홈 화면에 추가" })
            : el("p", { class: "small muted", text: "설치 버튼이 안 보이면 Chrome 메뉴(⋮)에서 추가할 수 있어요." })));
}

function renderOverlay({ focus = false } = {}) {
  const host = document.getElementById("overlay");
  if (!host) return;
  if (!sheet) {
    host.replaceChildren();
    document.body.classList.remove("sheet-open");
    return;
  }
  document.body.classList.add("sheet-open");
  const builder = {
    event: sheetEvent,
    pattern: sheetPattern,
    "shift-type": sheetShiftType,
    override: sheetOverride,
    member: sheetMember,
  }[sheet.kind];
  const card = builder ? builder(sheet.draft) : el("div", { text: "" });
  const backdrop = el("div", {
    class: "backdrop",
    onclick: (event) => { if (event.target === backdrop) closeSheet(); },
  }, card);
  host.replaceChildren(backdrop);
  if (focus) host.querySelector("[data-autofocus]")?.focus();
}

function sheetFrame(title, body, actions) {
  return el("div", { class: "sheet", role: "dialog", "aria-modal": "true", "aria-label": title },
    el("div", { class: "handle" }),
    el("div", { class: "sheet-head" },
      el("h2", { text: title }),
      el("button", { class: "btn btn-small", onclick: closeSheet, text: "닫기" })),
    ...body,
    actions ? el("div", { class: "sheet-actions" }, ...actions) : null);
}

function sheetEvent(draft) {
  const overnight = !draft.allDay && draft.startTime && draft.endTime && draft.endTime <= draft.startTime;
  return sheetFrame(draft.id ? "일정 수정" : "일정 추가", [
    draft.confirming ? confirmBox("이 일정을 지울까요? 반복 중이면 반복 전체가 지워져요.", () => deleteEvent(draft.id), () => {
      draft.confirming = false;
      renderOverlay();
    }) : null,
    field("제목", el("input", {
      type: "text",
      value: draft.title,
      maxlength: "80",
      dataset: { field: "title", autofocus: "true" },
      oninput: (event) => { draft.title = event.target.value; },
    })),
    field("누구", el("div", { class: "choice-row" }, ...state.members.map((member) => el("button", {
      class: `choice${draft.memberId === member.id ? " on" : ""}`,
      dataset: { member: member.id },
      onclick: () => { draft.memberId = member.id; renderOverlay(); },
    }, el("span", { class: "dot", style: `background:${member.color}` }), member.name)))),
    field("날짜", el("input", {
      type: "date",
      value: draft.date,
      dataset: { field: "event-date" },
      oninput: (event) => { draft.date = event.target.value; },
      onchange: (event) => { draft.date = event.target.value; renderOverlay(); },
    })),
    el("div", { class: "switch-row" },
      el("span", { text: "종일" }),
      el("button", {
        class: `switch${draft.allDay ? " on" : ""}`,
        role: "switch",
        "aria-checked": draft.allDay ? "true" : "false",
        onclick: () => { draft.allDay = !draft.allDay; renderOverlay(); },
      }, el("span", { class: "knob" }))),
    draft.allDay ? null : el("div", {},
      field("시작", el("input", {
        type: "time",
        value: draft.startTime,
        dataset: { field: "start-time" },
        oninput: (event) => { draft.startTime = event.target.value; },
        onchange: (event) => { draft.startTime = event.target.value; renderOverlay(); },
      })),
      field("끝", el("input", {
        type: "time",
        value: draft.endTime,
        dataset: { field: "end-time" },
        oninput: (event) => { draft.endTime = event.target.value; },
        onchange: (event) => { draft.endTime = event.target.value; renderOverlay(); },
      })),
      overnight ? el("p", { class: "small muted", text: "끝나는 시간이 시작보다 이르면 다음 날로 저장해요." }) : null),
    field("반복", selectEl(draft.repeat, [
      { value: "none", label: "반복 없음" },
      { value: "daily", label: "매일" },
      { value: "weekly", label: "매주" },
      { value: "monthly", label: "매월" },
    ], (value) => { draft.repeat = value; renderOverlay(); })),
    draft.repeat !== "none" ? field("반복 끝 (선택)", el("input", {
      type: "date",
      value: draft.repeatUntil,
      oninput: (event) => { draft.repeatUntil = event.target.value; },
    })) : null,
    draft.repeat !== "none" ? el("p", { class: "small muted", text: "반복 일정은 고치면 앞으로의 같은 반복이 함께 바뀌어요." }) : null,
    field("메모", el("textarea", {
      value: draft.memo,
      maxlength: "1000",
      oninput: (event) => { draft.memo = event.target.value; },
    })),
  ], [
    draft.id ? el("button", { class: "btn btn-danger", onclick: () => { draft.confirming = true; renderOverlay(); }, text: "삭제" }) : null,
    el("button", { class: "btn btn-primary", dataset: { action: "save-event" }, onclick: () => saveEvent(draft), text: "저장" }),
  ]);
}

function sheetPattern(draft) {
  const later = state.patterns.find((pattern) => pattern.memberId === draft.memberId && pattern.id !== draft.id && pattern.startDate > draft.startDate);
  return sheetFrame(draft.id ? "패턴 수정" : "새 근무 패턴", [
    draft.confirming ? confirmBox("이 패턴을 지울까요? 그 기간은 이전 패턴을 따라가요.", () => deletePattern(draft.id), () => {
      draft.confirming = false;
      renderOverlay();
    }) : null,
    el("p", { class: "note", text: "시작일에 순환의 첫 근무가 들어가요. 오늘이 야간이면 야간을 맨 앞에 두고 시작일을 오늘로 맞추세요. 새 패턴은 그 날짜 이후만 바꾸고, 그전 기록은 그대로입니다." }),
    el("div", { class: "preset-row" }, ...PRESETS.map((preset) => el("button", {
      class: `preset${draft.presetId === preset.id ? " on" : ""}`,
      dataset: { preset: preset.id },
      onclick: () => applyPreset(draft, preset),
      text: preset.name,
    }))),
    field("이름", el("input", {
      type: "text",
      value: draft.name,
      maxlength: "30",
      dataset: { field: "pattern-name", autofocus: draft.id ? null : "true" },
      oninput: (event) => { draft.name = event.target.value; },
    })),
    field("누구", selectEl(draft.memberId, personMembers().map((member) => ({ value: member.id, label: member.name })), (value) => {
      draft.memberId = value;
      renderOverlay();
    })),
    field("시작일", el("input", {
      type: "date",
      value: draft.startDate,
      dataset: { field: "start-date" },
      oninput: (event) => { draft.startDate = event.target.value; },
      onchange: (event) => { draft.startDate = event.target.value; renderOverlay(); },
    })),
    el("div", { class: "field-label", text: "순환 순서" }),
    draft.cycle.length
      ? el("div", {}, ...draft.cycle.map((id, index) => {
          const type = typeById(state, id);
          return el("div", { class: "cycle-row" },
            el("span", { class: "small", text: String(index + 1) }),
            type ? badge(type) : el("span", { class: "badge", text: "?" }),
            el("span", { class: "grow", text: type ? type.name : "없는 근무" }),
            el("button", { class: "btn btn-small", onclick: () => moveCycle(draft, index, -1), text: "위" }),
            el("button", { class: "btn btn-small", onclick: () => moveCycle(draft, index, 1), text: "아래" }),
            el("button", { class: "btn btn-small", onclick: () => { draft.cycle.splice(index, 1); renderOverlay(); }, text: "빼기" }));
        }))
      : el("p", { class: "muted small", text: "아래 근무를 눌러 순환에 넣으세요. 같은 근무를 여러 번 넣을 수 있어요." }),
    el("div", { class: "add-row", style: "margin:8px 0 12px" }, ...state.shiftTypes.map((type) => el("button", {
      class: "text-chip",
      onclick: () => appendCycle(draft, type.id),
    }, `＋ ${type.name}`))),
    el("div", { class: "field-label", text: "미리보기" }),
    draft.cycle.length && draft.startDate
      ? el("div", { class: "preview-row" }, ...previewCycle(draft.cycle, state.shiftTypes, draft.startDate, 14).map((day) => {
          const handed = later && day.date >= later.startDate;
          return el("div", { class: "preview-day" },
            el("span", { text: `${Number(day.date.slice(8))} ${weekdayLabel(day.date)}` }),
            handed ? el("span", { text: "다른 패턴" }) : day.type ? badge(day.type) : el("span", { text: "?" }));
        }))
      : el("p", { class: "muted small", text: "순환과 시작일을 정하면 여기 보여요." }),
  ], [
    draft.id ? el("button", { class: "btn btn-danger", onclick: () => { draft.confirming = true; renderOverlay(); }, text: "삭제" }) : null,
    el("button", { class: "btn btn-primary", dataset: { action: "save-pattern" }, onclick: () => savePattern(draft), text: "저장" }),
  ]);
}

function sheetShiftType(draft) {
  return sheetFrame(draft.id ? "근무 종류 수정" : "근무 종류", [
    draft.confirming ? confirmBox("이 근무 종류를 지울까요?", () => deleteShiftType(draft.id), () => {
      draft.confirming = false;
      renderOverlay();
    }) : null,
    field("이름", el("input", {
      type: "text",
      value: draft.name,
      maxlength: "20",
      dataset: { autofocus: "true" },
      oninput: (event) => { draft.name = event.target.value; },
    })),
    field("달력에 보일 짧은 글자", el("input", {
      type: "text",
      value: draft.shortLabel,
      maxlength: "3",
      oninput: (event) => { draft.shortLabel = event.target.value; },
    })),
    field("색", colorPicker(draft.color, (color) => { draft.color = color; renderOverlay(); })),
    el("div", { class: "switch-row" },
      el("span", { text: "쉬는 날 (시간 없음)" }),
      el("button", {
        class: `switch${draft.off ? " on" : ""}`,
        role: "switch",
        "aria-checked": draft.off ? "true" : "false",
        onclick: () => { draft.off = !draft.off; renderOverlay(); },
      }, el("span", { class: "knob" }))),
    draft.off ? null : el("div", {},
      field("시작", el("input", { type: "time", value: draft.startTime, oninput: (event) => { draft.startTime = event.target.value; } })),
      field("끝", el("input", { type: "time", value: draft.endTime, oninput: (event) => { draft.endTime = event.target.value; } })),
      el("p", { class: "small muted", text: "야간처럼 끝이 시작보다 이르면 다음 날 아침으로 봐요." })),
  ], [
    draft.id ? el("button", { class: "btn btn-danger", onclick: () => { draft.confirming = true; renderOverlay(); }, text: "삭제" }) : null,
    el("button", { class: "btn btn-primary", onclick: () => saveShiftType(draft), text: "저장" }),
  ]);
}

function sheetOverride(draft) {
  return sheetFrame("이 날만 바꾸기", [
    field("날짜", el("input", {
      type: "date",
      value: draft.date,
      dataset: { field: "override-date" },
      oninput: (event) => { draft.date = event.target.value; },
      onchange: (event) => { draft.date = event.target.value; renderOverlay(); },
    })),
    field("누구", selectEl(draft.memberId, personMembers().map((member) => ({ value: member.id, label: member.name })), (value) => {
      draft.memberId = value;
      renderOverlay();
    })),
    el("div", { class: "field-label", text: "그 날의 근무" }),
    el("div", { class: "choice-row" },
      ...state.shiftTypes.map((type) => el("button", {
        class: `choice${draft.shiftTypeId === type.id && !draft.customKey ? " on" : ""}`,
        onclick: () => {
          draft.shiftTypeId = type.id;
          draft.customKey = "";
          renderOverlay();
        },
      }, badge(type), type.name)),
      ...Object.entries(QUICK_CUSTOM).map(([key, quick]) => el("button", {
        class: `choice${draft.customKey === key ? " on" : ""}`,
        dataset: { quick: key },
        onclick: () => {
          draft.shiftTypeId = "";
          draft.customKey = key;
          draft.name = quick.name;
          draft.shortLabel = quick.shortLabel;
          draft.color = quick.color;
          draft.off = quick.off;
          draft.startTime = quick.startTime;
          draft.endTime = quick.endTime;
          renderOverlay();
        },
        text: quick.name,
      }))),
    draft.customKey ? el("div", {},
      field("표시 이름", el("input", { type: "text", value: draft.name, maxlength: "20", oninput: (event) => { draft.name = event.target.value; } })),
      field("짧은 글자", el("input", { type: "text", value: draft.shortLabel, maxlength: "3", oninput: (event) => { draft.shortLabel = event.target.value; } })),
      field("색", colorPicker(draft.color, (color) => { draft.color = color; renderOverlay(); }))) : null,
    field("메모", el("textarea", { value: draft.memo, maxlength: "300", oninput: (event) => { draft.memo = event.target.value; } })),
  ], [
    draft.existingId ? el("button", { class: "btn btn-danger", onclick: () => removeOverride(draft.existingId, true), text: "패턴으로 되돌리기" }) : null,
    el("button", { class: "btn btn-primary", dataset: { action: "save-override" }, onclick: () => saveOverride(draft), text: "저장" }),
  ]);
}

function sheetMember(draft) {
  return sheetFrame("구성원 추가", [
    field("이름", el("input", {
      type: "text",
      value: draft.name,
      maxlength: "20",
      dataset: { autofocus: "true" },
      oninput: (event) => { draft.name = event.target.value; },
    })),
    field("색", colorPicker(draft.color, (color) => { draft.color = color; renderOverlay(); })),
  ], [
    el("button", { class: "btn btn-primary", onclick: () => saveMember(draft), text: "추가" }),
  ]);
}

function confirmBox(message, onYes, onNo) {
  return el("div", { class: "confirm" },
    el("p", { text: message }),
    el("div", { class: "row-actions" },
      el("button", { class: "btn btn-danger btn-small", dataset: { action: "confirm-delete" }, onclick: onYes, text: "지우기" }),
      el("button", { class: "btn btn-small", onclick: onNo, text: "취소" })));
}

function field(label, control) {
  return el("label", { class: "field" }, el("span", { class: "field-label", text: label }), control);
}

function selectEl(value, options, onChange) {
  const node = el("select", { onchange: (event) => onChange(event.target.value) });
  for (const option of options) node.append(el("option", { value: option.value, text: option.label }));
  node.value = value || "";
  return node;
}

function colorPicker(value, onChange) {
  return el("div", { class: "swatches" },
    ...SWATCHES.map((color) => el("button", {
      class: `swatch${value === color ? " on" : ""}`,
      style: `background:${color}`,
      "aria-label": color,
      onclick: () => onChange(color),
    })),
    el("input", { type: "color", value, onchange: (event) => onChange(event.target.value) }));
}

function badge(shift) {
  return el("span", {
    class: `badge${shift.override ? " override" : ""}`,
    style: `background:${shift.color};color:${textOn(shift.color)}`,
    text: shift.shortLabel || "·",
  });
}

function openSheet(next) {
  sheet = next;
  renderOverlay({ focus: true });
}

function closeSheet() {
  sheet = null;
  renderOverlay();
}

function openEvent(event, date) {
  if (event) {
    openSheet({
      kind: "event",
      draft: {
        id: event.id,
        title: event.title || "",
        memberId: event.memberId || "family",
        date: event.date,
        allDay: Boolean(event.allDay),
        startTime: event.startTime || "09:00",
        endTime: event.endTime || "10:00",
        memo: event.memo || "",
        repeat: event.repeat || "none",
        repeatUntil: event.repeatUntil || "",
        confirming: false,
      },
    });
    return;
  }
  openSheet({
    kind: "event",
    draft: {
      id: null,
      title: "",
      memberId: state.ui.lastMemberId || "family",
      date: date || nav.selected || todayISO(),
      allDay: false,
      startTime: "09:00",
      endTime: "10:00",
      memo: "",
      repeat: "none",
      repeatUntil: "",
      confirming: false,
    },
  });
}

function saveEvent(draft) {
  const title = draft.title.trim();
  if (!title) {
    showToast("제목을 입력해 주세요.");
    return;
  }
  if (!draft.date) {
    showToast("날짜를 골라 주세요.");
    return;
  }
  if (!draft.allDay && (!draft.startTime || !draft.endTime)) {
    showToast("시작과 끝나는 시간을 입력해 주세요.");
    return;
  }
  if (draft.repeat !== "none" && draft.repeatUntil && draft.repeatUntil < draft.date) {
    showToast("반복이 끝나는 날은 시작보다 뒤여야 해요.");
    return;
  }
  const now = new Date().toISOString();
  closeSheet();
  commit((current) => {
    current.ui.lastMemberId = draft.memberId;
    if (draft.id) {
      const index = current.events.findIndex((event) => event.id === draft.id);
      if (index >= 0) {
        current.events[index] = { ...current.events[index], ...draft, title, updatedAt: now };
      }
    } else {
      current.events.push({
        ...draft,
        id: uid("event"),
        title,
        endDate: "",
        updatedAt: now,
        googleEventId: "",
        googleUpdated: "",
      });
    }
  });
  showToast("일정을 저장했어요.");
  vibrate();
}

function deleteEvent(id) {
  closeSheet();
  commit((current) => {
    const event = current.events.find((item) => item.id === id);
    current.events = current.events.filter((item) => item.id !== id);
    if (event?.googleEventId) {
      current.tombstones.push({
        googleEventId: event.googleEventId,
        localId: event.id,
        deletedAt: new Date().toISOString(),
      });
      current.tombstones = current.tombstones.slice(-200);
    }
  });
  showToast("일정을 지웠어요.");
}

function openPattern(existing, presetId) {
  const draft = existing
    ? {
        id: existing.id,
        name: existing.name || "",
        memberId: existing.memberId,
        startDate: existing.startDate,
        cycle: (existing.cycle || []).slice(),
        presetId: "",
        confirming: false,
      }
    : {
        id: null,
        name: "",
        memberId: preferredShiftMember(),
        startDate: todayISO(),
        cycle: [],
        presetId: "",
        confirming: false,
      };
  if (presetId) {
    const preset = PRESETS.find((item) => item.id === presetId);
    if (preset) applyPreset(draft, preset, false);
  }
  openSheet({ kind: "pattern", draft });
}

function applyPreset(draft, preset, rerender = true) {
  const cycle = cycleFromPreset(state, preset);
  if (cycle.length !== preset.cycleNames.length) showToast("빠진 근무 종류가 있어 프리셋을 다 채우지 못했어요.");
  draft.cycle = cycle;
  draft.name = preset.name;
  draft.presetId = preset.id;
  if (rerender) renderOverlay();
}

function appendCycle(draft, typeId) {
  if (draft.cycle.length >= 60) {
    showToast("순환은 60일을 넘기지 않아요.");
    return;
  }
  draft.cycle.push(typeId);
  draft.presetId = "";
  renderOverlay();
}

function moveCycle(draft, index, direction) {
  const next = index + direction;
  if (next < 0 || next >= draft.cycle.length) return;
  const [item] = draft.cycle.splice(index, 1);
  draft.cycle.splice(next, 0, item);
  draft.presetId = "";
  renderOverlay();
}

function savePattern(draft) {
  if (!draft.cycle.length) {
    showToast("순환을 한 칸 이상 넣어 주세요.");
    return;
  }
  if (!draft.startDate) {
    showToast("시작일을 골라 주세요.");
    return;
  }
  const name = draft.name.trim() || draft.cycle.map((id) => typeById(state, id)?.shortLabel || "").join("");
  closeSheet();
  commit((current) => {
    const next = {
      id: draft.id || uid("pattern"),
      name,
      memberId: draft.memberId,
      startDate: draft.startDate,
      cycle: draft.cycle.slice(),
    };
    const index = current.patterns.findIndex((pattern) => pattern.id === next.id);
    if (index >= 0) current.patterns[index] = next;
    else current.patterns.push(next);
    current.patterns = current.patterns.filter((pattern) => pattern.id === next.id || pattern.memberId !== next.memberId || pattern.startDate !== next.startDate);
    touchConfig(current);
  });
  showToast("근무 패턴을 저장했어요.");
  vibrate();
}

function deletePattern(id) {
  closeSheet();
  commit((current) => {
    current.patterns = current.patterns.filter((pattern) => pattern.id !== id);
    touchConfig(current);
  });
  showToast("패턴을 지웠어요. 그 기간은 이전 패턴을 따라요.");
}

function openShiftType(type) {
  openSheet({
    kind: "shift-type",
    draft: type
      ? { ...type, confirming: false }
      : { id: null, name: "", shortLabel: "", color: "#fb8c00", startTime: "07:00", endTime: "19:00", off: false, confirming: false },
  });
}

function saveShiftType(draft) {
  const name = draft.name.trim();
  if (!name) {
    showToast("이름을 입력해 주세요.");
    return;
  }
  const shortLabel = (draft.shortLabel || name).trim().slice(0, 3);
  closeSheet();
  commit((current) => {
    const next = {
      id: draft.id || uid("shift"),
      name,
      shortLabel,
      color: normalizeColor(draft.color, "#fb8c00"),
      startTime: draft.off ? "" : (draft.startTime || ""),
      endTime: draft.off ? "" : (draft.endTime || ""),
      off: Boolean(draft.off),
    };
    const index = current.shiftTypes.findIndex((type) => type.id === next.id);
    if (index >= 0) current.shiftTypes[index] = next;
    else current.shiftTypes.push(next);
    touchConfig(current);
  });
  showToast("근무 종류를 저장했어요.");
}

function deleteShiftType(id) {
  const used = state.patterns.some((pattern) => (pattern.cycle || []).includes(id)) || state.overrides.some((item) => item.shiftTypeId === id);
  if (used) {
    showToast("이 근무를 쓰는 패턴이나 변경이 있어요. 뺀 다음 지워 주세요.");
    return;
  }
  if (state.shiftTypes.length <= 1) {
    showToast("근무 종류는 하나는 남겨 두어야 해요.");
    return;
  }
  closeSheet();
  commit((current) => {
    current.shiftTypes = current.shiftTypes.filter((type) => type.id !== id);
    touchConfig(current);
  });
  showToast("근무 종류를 지웠어요.");
}

function openOverride(date, memberId) {
  const existing = state.overrides.find((item) => item.date === date && item.memberId === memberId);
  const quickKey = existing && !existing.shiftTypeId
    ? Object.keys(QUICK_CUSTOM).find((key) => QUICK_CUSTOM[key].name === existing.name) || "custom"
    : "";
  openSheet({
    kind: "override",
    draft: {
      existingId: existing?.id || "",
      date,
      memberId: memberId || preferredShiftMember(),
      shiftTypeId: existing?.shiftTypeId || "",
      customKey: quickKey,
      name: existing?.name || "",
      shortLabel: existing?.shortLabel || "",
      color: existing?.color || "#d50000",
      off: existing ? existing.off !== false : true,
      startTime: existing?.startTime || "",
      endTime: existing?.endTime || "",
      memo: existing?.memo || "",
    },
  });
}

function saveOverride(draft) {
  if (!draft.date) {
    showToast("날짜를 골라 주세요.");
    return;
  }
  if (!draft.shiftTypeId && !draft.name.trim()) {
    showToast("근무나 연차 같은 표시를 골라 주세요.");
    return;
  }
  closeSheet();
  commit((current) => {
    const next = {
      id: draft.existingId || uid("override"),
      date: draft.date,
      memberId: draft.memberId,
      shiftTypeId: draft.shiftTypeId || "",
      name: draft.shiftTypeId ? "" : draft.name.trim(),
      shortLabel: draft.shiftTypeId ? "" : (draft.shortLabel || draft.name).trim().slice(0, 3),
      color: normalizeColor(draft.color, "#d50000"),
      off: Boolean(draft.off),
      startTime: draft.shiftTypeId ? "" : (draft.startTime || ""),
      endTime: draft.shiftTypeId ? "" : (draft.endTime || ""),
      memo: (draft.memo || "").trim(),
    };
    current.overrides = current.overrides.filter((item) => !(item.date === next.date && item.memberId === next.memberId));
    current.overrides.push(next);
    touchConfig(current);
  });
  showToast("그 날만 바꿔 두었어요.");
  vibrate();
}

function removeOverride(id, close = false) {
  if (close) closeSheet();
  commit((current) => {
    current.overrides = current.overrides.filter((item) => item.id !== id);
    touchConfig(current);
  });
  showToast("그 날은 다시 패턴대로 보여요.");
}

function openMember() {
  openSheet({ kind: "member", draft: { name: "", color: "#8e24aa" } });
}

function saveMember(draft) {
  const name = draft.name.trim();
  if (!name) {
    showToast("이름을 입력해 주세요.");
    return;
  }
  closeSheet();
  commit((current) => {
    current.members.push({ id: uid("member"), name, color: normalizeColor(draft.color, "#8e24aa") });
    touchConfig(current);
  });
  showToast("구성원을 추가했어요.");
}

function updateMember(id, patch) {
  commit((current) => {
    const member = current.members.find((item) => item.id === id);
    if (!member) return;
    Object.assign(member, patch);
    if (patch.color) member.color = normalizeColor(patch.color, member.color);
    touchConfig(current);
  });
}

function deleteMember(id) {
  const member = memberById(id);
  if (member.everyone) return;
  const busy = state.events.some((event) => event.memberId === id)
    || state.patterns.some((pattern) => pattern.memberId === id)
    || state.overrides.some((item) => item.memberId === id);
  if (busy) {
    showToast("이 구성원의 일정이나 근무가 있어요. 다른 사람으로 옮긴 다음 지워 주세요.");
    return;
  }
  commit((current) => {
    current.members = current.members.filter((item) => item.id !== id);
    touchConfig(current);
  });
}

function toggleMember(id) {
  commit((current) => {
    const hidden = new Set(current.ui.hiddenMemberIds || []);
    if (hidden.has(id)) hidden.delete(id);
    else hidden.add(id);
    current.ui.hiddenMemberIds = [...hidden];
  });
}

function setView(view) {
  commit((current) => { current.ui.view = view; });
}

function selectDate(iso) {
  nav.selected = iso;
  nav.month = iso.slice(0, 7);
  renderMain();
}

function goToday() {
  nav.selected = todayISO();
  nav.month = nav.selected.slice(0, 7);
  renderMain();
}

function movePeriod(delta) {
  const view = state.ui.view || "month";
  if (view === "month") {
    nav.month = addMonths(nav.month, delta);
    const dim = daysInMonth(`${nav.month}-01`);
    const day = Math.min(Number(nav.selected.slice(8, 10)), dim);
    nav.selected = `${nav.month}-${String(day).padStart(2, "0")}`;
  } else if (view === "week") {
    nav.selected = addDays(nav.selected, delta * 7);
    nav.month = nav.selected.slice(0, 7);
  } else {
    nav.selected = addDays(nav.selected, delta);
    nav.month = nav.selected.slice(0, 7);
  }
  renderMain();
}

function preferredShiftMember() {
  if (nav.shiftMember && personMembers().some((member) => member.id === nav.shiftMember)) return nav.shiftMember;
  const withPattern = state.patterns[0]?.memberId;
  if (withPattern && personMembers().some((member) => member.id === withPattern)) return withPattern;
  return personMembers()[0]?.id || "dad";
}

async function connectGoogle() {
  try {
    await signIn();
    const profile = await fetchProfile().catch(() => ({ email: "" }));
    commit((current) => { current.google.accountEmail = profile.email || current.google.accountEmail; });
    await refreshCalendars();
    showToast(profile.email ? `${profile.email}으로 연결했어요.` : "Google에 연결했어요.");
  } catch (error) {
    showToast(error.message || "연결하지 못했어요.");
  }
}

async function refreshCalendars() {
  try {
    calendars = await listCalendars();
    renderMain();
  } catch (error) {
    showToast(friendlyGoogleError(error));
  }
}

async function makeCalendar() {
  try {
    const created = await createFamilyCalendar();
    calendars = await listCalendars();
    commit((current) => {
      current.google.calendarId = created.id;
      current.google.calendarSummary = created.summary || "가족 공유 캘린더";
      current.google.syncToken = "";
    });
    showToast("가족 공유 캘린더를 만들었어요. 아래에서 엄마를 초대하세요.");
  } catch (error) {
    showToast(friendlyGoogleError(error));
  }
}

function chooseCalendar(id) {
  const found = calendars.find((item) => item.id === id);
  commit((current) => {
    current.google.calendarId = id;
    current.google.calendarSummary = found?.summary || "";
    current.google.syncToken = "";
  });
  if (found?.primary) showToast("기본 캘린더에는 개인 일정도 섞여 있어요. 가족만 쓰는 캘린더를 따로 만드는 편이 좋아요.");
}

function disconnect() {
  signOut();
  calendars = [];
  renderMain();
  showToast("이 휴대폰의 Google 연결을 끊었어요. 캘린더의 일정은 그대로예요.");
}

async function invite(email) {
  if (!state.google.calendarId) {
    showToast("먼저 캘린더를 골라 주세요.");
    return;
  }
  if (!email || !email.includes("@")) {
    showToast("메일 주소를 확인해 주세요.");
    return;
  }
  try {
    await shareCalendar(state.google.calendarId, email);
    showToast("초대를 보냈어요. 엄마 메일에서 수락하면 같이 고칠 수 있어요.");
  } catch (error) {
    showToast(friendlyGoogleError(error));
  }
}

async function runSync() {
  if (syncing) return;
  if (!state.google.calendarId) {
    nav.tab = "settings";
    renderMain();
    showToast("설정에서 가족 캘린더를 먼저 골라 주세요.");
    return;
  }
  syncing = true;
  renderMain();
  try {
    if (!currentToken()) await signIn();
    const result = await syncAll(state, { onProgress: (text) => showToast(text) });
    saveState(state);
    showToast(result.summary);
  } catch (error) {
    showToast(friendlyGoogleError(error));
  } finally {
    try { saveState(state); } catch { /* 이미 안내함 */ }
    syncing = false;
    renderMain();
  }
}

async function installApp() {
  if (!deferredInstall) return;
  deferredInstall.prompt();
  await deferredInstall.userChoice.catch(() => {});
  deferredInstall = null;
  renderMain();
}

function monthDates(ym) {
  const first = `${ym}-01`;
  const start = addDays(first, -weekday(first));
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}

function weekDatesOf(iso) {
  const start = addDays(iso, -weekday(iso));
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

function eventTimeLabel(event) {
  if (event.allDay) return event.endDate && event.endDate !== event.date ? `${formatMonthDay(event.date)}–${formatMonthDay(event.endDate)}` : "종일";
  const overnight = event.endTime && event.startTime && event.endTime <= event.startTime;
  return `${event.startTime}–${event.endTime}${overnight ? " 다음 날" : ""}`;
}

function shiftTimeLabel(shift) {
  if (shift.off || !shift.startTime || !shift.endTime) return "시간 없는 날";
  const overnight = shift.endTime <= shift.startTime;
  return `${shift.startTime}–${shift.endTime}${overnight ? " 다음 날" : ""}`;
}

function dotDate(iso) {
  return `${iso.slice(0, 4)}.${iso.slice(5, 7)}.${iso.slice(8, 10)}`;
}

function normalizeColor(value, fallback) {
  return /^#[0-9a-fA-F]{6}$/.test(value || "") ? value.toLowerCase() : fallback;
}

boot();
