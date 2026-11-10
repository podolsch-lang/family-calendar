import puppeteer from "puppeteer-core";

const base = process.env.APP_URL || "http://127.0.0.1:8765/";
const chrome = process.env.CHROME_PATH || "/usr/local/bin/google-chrome";
const outDir = process.env.ARTIFACT_DIR || "/opt/cursor/artifacts";

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none", "--lang=ko-KR"],
});

const page = await browser.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

try {
  await page.goto(base, { waitUntil: "networkidle0" });
  await page.evaluate(async () => {
    localStorage.clear();
    const regs = await navigator.serviceWorker?.getRegistrations?.() || [];
    await Promise.all(regs.map((reg) => reg.unregister()));
    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
  });
  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForSelector("[data-tab='shifts']");

  const banner = await page.$eval(".banner", (node) => node.textContent);
  if (!banner.includes("이 휴대폰에만")) throw new Error(`banner missing: ${banner}`);

  await page.click("[data-tab='shifts']");
  await page.waitForSelector("[data-open-preset='juya-bibi']");
  await page.click("[data-open-preset='juya-bibi']");
  await page.waitForSelector("#overlay [data-field='start-date']");
  await setValue(page, "#overlay [data-field='start-date']", "2026-11-01");
  await page.click("#overlay [data-action='save-pattern']");
  await page.waitForSelector("[data-pattern-start='2026-11-01']");

  await page.click("[data-open-preset='three-shift']");
  await page.waitForSelector("#overlay [data-field='start-date']");
  await setValue(page, "#overlay [data-field='start-date']", "2026-11-20");
  await page.click("#overlay [data-action='save-pattern']");
  await page.waitForSelector("[data-pattern-start='2026-11-20']");

  await page.click("[data-action='add-override']");
  await page.waitForSelector("#overlay [data-field='override-date']");
  await setValue(page, "#overlay [data-field='override-date']", "2026-11-12");
  await page.click("#overlay [data-quick='연차']");
  await page.click("#overlay [data-action='save-override']");
  await page.waitForFunction(() => !document.querySelector("#overlay .sheet"));

  await page.click("[data-edit-pattern]");
  await page.waitForSelector("#overlay [data-action='save-pattern']");
  await page.$eval("#overlay .sheet", (node) => { node.scrollTop = 0; });
  await pause(250);
  await clearToasts(page);
  await page.screenshot({ path: `${outDir}/screenshot_shift_pattern_editor.png` });
  await page.click("#overlay .sheet-head .btn");
  await page.waitForFunction(() => !document.querySelector("#overlay .sheet"));

  await page.click("[data-tab='calendar']");
  await page.waitForSelector("[data-view='month']");
  if (!(await page.$eval("[data-view='month']", (node) => node.classList.contains("on")))) {
    await page.click("[data-view='month']");
  }
  await goToMonth(page, "2026-11");

  const before = await shiftMap(page);
  assertLabel(before, "2026-10-31", null);
  assertLabel(before, "2026-11-01", "주");
  assertLabel(before, "2026-11-02", "야");
  assertLabel(before, "2026-11-12", "연");
  assertLabel(before, "2026-11-19", "비");
  assertLabel(before, "2026-11-20", "주");
  assertLabel(before, "2026-11-21", "오");

  await page.click("[data-action='prev']");
  const october = await shiftMap(page);
  assertLabel(october, "2026-10-31", "");
  await page.click("[data-action='next']");

  await page.click("[data-action='add-event']");
  await page.waitForSelector("#overlay [data-field='title']");
  await setValue(page, "#overlay [data-field='title']", "하윤 어린이집 발표");
  await page.click("#overlay [data-member='child']");
  await setValue(page, "#overlay [data-field='event-date']", "2026-11-10");
  await setValue(page, "#overlay [data-field='start-time']", "10:00");
  await setValue(page, "#overlay [data-field='end-time']", "11:00");
  await page.$eval("#overlay .sheet", (node) => { node.scrollTop = 0; });
  await pause(250);
  await clearToasts(page);
  await page.screenshot({ path: `${outDir}/screenshot_event_form.png` });
  await page.click("#overlay [data-action='save-event']");
  await page.waitForFunction(() => document.body.textContent.includes("하윤 어린이집 발표"));

  await page.click("[data-date='2026-11-10']");
  await page.evaluate(() => {
    const main = document.querySelector(".main");
    if (main) main.scrollTop = 0;
  });
  await clearToasts(page);
  await page.screenshot({ path: `${outDir}/screenshot_month_shift_badges.png` });

  await page.click("[data-view='week']");
  await page.waitForFunction(() => document.body.textContent.includes("어린이집"));
  await page.click("[data-view='day']");
  await page.waitForSelector("[data-agenda='2026-11-10']");
  await page.click("[data-view='month']");

  await page.setViewport({ width: 360, height: 800, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const narrow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (narrow > 1) throw new Error(`horizontal overflow ${narrow}px`);
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

  await page.click("[data-tab='settings']");
  await page.waitForFunction(() => document.body.textContent.includes("버전 1.0"));
  await page.click("[data-tab='calendar']");
  await page.reload({ waitUntil: "networkidle0" });
  await goToMonth(page, "2026-11");
  const afterReload = await shiftMap(page);
  assertLabel(afterReload, "2026-11-12", "연");
  assertLabel(afterReload, "2026-11-21", "오");
  if (!await page.evaluate(() => document.body.textContent.includes("하윤 어린이집 발표"))) {
    await page.click("[data-date='2026-11-10']");
  }
  await page.waitForFunction(() => document.body.textContent.includes("하윤 어린이집 발표"));

  const serious = errors.filter((error) => !/favicon|manifest/i.test(error));
  if (serious.length) throw new Error(serious.join("\n"));
  console.log("smoke ok");
} catch (error) {
  await page.screenshot({ path: `${outDir}/screenshot_failure.png` }).catch(() => {});
  throw error;
} finally {
  await browser.close();
}

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function setValue(page, selector, value) {
  await page.$eval(selector, (element, next) => {
    element.value = next;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

async function clearToasts(page) {
  await page.evaluate(() => document.getElementById("toasts")?.replaceChildren());
}

async function shiftMap(page) {
  return page.$$eval("[data-date]", (nodes) => {
    const map = {};
    for (const node of nodes) map[node.dataset.date] = node.dataset.shiftLabel || "";
    return map;
  });
}

function assertLabel(map, date, expected) {
  if (expected == null) {
    if (date in map) throw new Error(`${date} should not be on this grid, got ${map[date]}`);
    return;
  }
  if (map[date] !== expected) {
    throw new Error(`${date}: expected "${expected}" got "${map[date]}"`);
  }
}

async function goToMonth(page, ym) {
  for (let i = 0; i < 36; i += 1) {
    const text = await page.$eval("h1.period-label", (node) => node.textContent.trim());
    const match = /(\d{4})년\s*(\d{1,2})월/.exec(text);
    if (!match) throw new Error(`unexpected title ${text}`);
    const current = `${match[1]}-${match[2].padStart(2, "0")}`;
    if (current === ym) return;
    await page.click(current < ym ? "[data-action='next']" : "[data-action='prev']");
  }
  throw new Error(`could not open ${ym}`);
}
