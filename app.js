import * as core from "./core.js";

const APP_NAME = "Dime";
const STORE_KEY = "ledger.v1";
const $ = id => document.getElementById(id);
const esc = text => String(text).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const LOCALE = navigator.language || "en-US";
const DECIMAL = (1.1).toLocaleString(LOCALE).replace(/\d/g, "") || ".";
const WEEK_START = (() => {
  try { const loc = new Intl.Locale(LOCALE); return ((loc.getWeekInfo?.() ?? loc.weekInfo)?.firstDay ?? 7) % 7; } catch { return 0; }
})();
const RANGE_LABEL = { today: "Today", week: "Week", month: "Month", year: "Year", all: "All time" };
const ERROR_TEXT = {
  amountNotPositive: "Enter an amount above zero.", unknownCategory: "Pick a category.", emptyName: "Give the category a name.",
  duplicateName: "You already have a category with that name.", lastCategory: "Keep at least one category.",
  notABackup: "That file is not a backup from this app.", newerVersion: "That backup was made by a newer version of the app.",
};

// ---------- state ----------

const state = {
  ledger: null, notice: null,
  tab: new URLSearchParams(location.search).get("tab") || "add",
  historyRange: "month", insightsRange: "month", insightsBar: null, insightsBack: 0, historyBack: 0,
  entry: "", note: "", categoryID: localStorage.getItem("lastCategoryID"), addDate: null, lastSaved: null, addError: null,
};

function load() {
  const raw = localStorage.getItem(STORE_KEY);
  if (raw === null) return core.newLedger();
  try { return core.decodeBackup(raw); } catch {
    // Never overwrite data we could not read. Park it under another key.
    const parked = `ledger.unreadable.${Date.now()}`;
    try { localStorage.setItem(parked, raw); } catch { /* storage full: the original key is left alone below */ }
    state.notice = `Your saved expenses could not be read, so the app started empty. The old data was kept on this device as "${parked}".`;
    return core.newLedger();
  }
}

/** Saves first, then swaps it in. If saving fails, nothing changes on screen either. */
function commit(next) {
  try { localStorage.setItem(STORE_KEY, core.encodeBackup(next)); } catch {
    toast("Could not save. This device's storage for the app is full.");
    return false;
  }
  state.ledger = next;
  return true;
}

const code = () => state.ledger.preferences.currencyCode;
const money = minor => core.formatMoney(minor, code(), LOCALE);
const digits = () => core.fractionDigits(code());
const interval = range => core.intervalFor(range, new Date(), state.ledger.preferences.monthStartDay, WEEK_START);
function symbol() {
  try { return new Intl.NumberFormat(LOCALE, { style: "currency", currency: code() }).formatToParts(0).find(p => p.type === "currency").value; }
  catch { return code(); }
}
function chosenCategory() {
  const active = core.activeCategories(state.ledger);
  return active.find(c => c.id === state.categoryID) || active[0];
}

let toastTimer;
function toast(message) {
  const el = $("toast");
  el.textContent = message; el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3500);
}

/** Inline style attributes are blocked by the page's security policy, so colours and bar sizes are set here. */
function paint(root) {
  root.querySelectorAll("[data-c]").forEach(el => el.style.setProperty("--c", el.dataset.c));
  root.querySelectorAll("[data-f]").forEach(el => el.style.setProperty("--f", el.dataset.f));
}

// ---------- views ----------

function chips(ranges, selected, action) {
  return `<div class="chips" role="group" aria-label="Time range">${ranges.map(r =>
    `<button class="chip" data-action="${action}" data-range="${r}" aria-pressed="${r === selected}">${RANGE_LABEL[r]}</button>`).join("")}</div>`;
}

function budgetStrip() {
  const status = core.budgetStatus(state.ledger);
  if (!status) return "";
  return `<div class="card"><div class="row small muted"><span class="grow">${status.isOver ? "Over budget" : "Left this month"}</span>
    <span class="num">${esc(money(status.spent))} of ${esc(money(status.budget))}</span></div>
    <div class="meter" data-f="${status.fractionUsed}" data-c="${status.isOver ? "var(--danger)" : "var(--accent)"}"><i></i></div></div>`;
}

function viewAdd() {
  const active = core.activeCategories(state.ledger);
  const chosen = chosenCategory();
  const value = core.entryValue(state.entry);
  const saved = state.lastSaved && core.categoryById(state.ledger, state.lastSaved.categoryID);
  const dateLabel = state.addDate ? new Date(state.addDate + "T12:00").toLocaleDateString(LOCALE, { weekday: "short", day: "numeric", month: "short" }) : "Today";
  const today = localDate(new Date());
  return `
    ${state.notice ? `<p class="small warning">${esc(state.notice)}</p>` : ""}
    <div class="amount" aria-live="polite"><div class="label">Amount</div>
      <div class="value ${state.entry ? "" : "empty"}"><span class="sym">${esc(symbol())}</span><span class="digits num">${esc((state.entry || "0").replace(".", DECIMAL))}</span></div></div>
    <div class="chips" role="group" aria-label="Category">${active.map(c =>
      `<button class="chip cat" data-action="pick-category" data-id="${esc(c.id)}" data-c="${esc(c.colorHex)}" aria-pressed="${c.id === chosen.id}"><span aria-hidden="true">${esc(c.emoji)}</span>${esc(c.name)}</button>`).join("")}</div>
    <div class="row">
      <input class="field grow" id="note" type="text" placeholder="Add a note (optional)" aria-label="Note" maxlength="120" value="${esc(state.note)}" enterkeyhint="done" autocomplete="off">
      <label class="chip" for="add-date">${esc(dateLabel)}<input id="add-date" class="vh" type="date" max="${today}" value="${esc(state.addDate || today)}" aria-label="Date of the expense"></label>
    </div>
    ${state.addError ? `<p class="small danger" role="alert">${esc(state.addError)}</p>` : ""}
    ${saved ? `<div class="saved"><span>Saved ${esc(money(core.toMinor(state.lastSaved.amount)))} to ${esc(saved.name)}</span><button class="link" data-action="undo">Undo</button></div>` : ""}
    <div class="pad" role="group" aria-label="Number pad">
      ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(d => `<button data-action="digit" data-digit="${d}">${d}</button>`).join("")}
      ${digits() > 0 ? `<button data-action="separator" aria-label="Decimal point">${esc(DECIMAL)}</button>` : "<span></span>"}
      <button data-action="digit" data-digit="0">0</button>
      <button data-action="backspace" aria-label="Delete last digit">⌫</button>
    </div>
    <button class="btn" data-action="save-expense" ${value ? "" : "disabled"}>Save</button>`;
}

function expenseItem(e) {
  const c = core.categoryById(state.ledger, e.categoryID);
  const time = new Date(e.date).toLocaleTimeString(LOCALE, { hour: "numeric", minute: "2-digit" });
  return `<button class="item" data-action="edit-expense" data-id="${esc(e.id)}">
    <span class="badge" data-c="${esc(c?.colorHex ?? "#A0A7B4")}" aria-hidden="true">${esc(c?.emoji ?? "❔")}</span>
    <span class="main"><span class="title">${esc(c?.name ?? "Unknown")}</span>${e.note ? `<div class="sub">${esc(e.note)}</div>` : ""}</span>
    <span class="end"><span class="title num">${esc(money(core.toMinor(e.amount)))}</span><div class="sub">${esc(time)}</div></span></button>`;
}

function viewHistory() {
  const span = spanBack(state.historyRange, state.historyBack);
  const days = core.byDay(core.expensesIn(state.ledger, span));
  const body = days.length ? days.map(day => `
      <div class="dayhead"><span>${esc(new Date(day.day).toLocaleDateString(LOCALE, { weekday: "long", day: "numeric", month: "short" }))}</span><span class="num">${esc(money(day.total))}</span></div>
      <div class="list">${day.expenses.map(expenseItem).join("")}</div>`).join("")
    : `<div class="empty"><div class="glyph" aria-hidden="true">🗂️</div><strong>Nothing here yet</strong>${state.historyRange === "all" ? "Expenses you add will show up here." : "No expenses in this range. Try a longer one, or step back with the arrow."}</div>`;
  return `<h1>History</h1>${chips(["today", "week", "month", "all"], state.historyRange, "history-range")}
    ${span ? stepper("history-step", state.historyRange, span, state.historyBack) : ""}<div>${body}</div>${budgetStrip()}`;
}

/** A range's current period, or an earlier one after stepping back that many periods. null for all time. */
function spanBack(range, back) {
  let span = interval(range);
  for (let i = 0; span && i < back; i++) {
    span = core.intervalFor(range, new Date(span.start - 1), state.ledger.preferences.monthStartDay, WEEK_START);
  }
  return span;
}
/** All time on Insights: from the day of the first expense to the end of the latest month with anything in it. */
function allSpan() {
  const times = state.ledger.expenses.map(e => Date.parse(e.date));
  const first = new Date(times.length ? Math.min(...times) : Date.now());
  const last = new Date(Math.max(Date.now(), ...times));
  return { start: new Date(first.getFullYear(), first.getMonth(), first.getDate()).getTime(),
           end: new Date(last.getFullYear(), last.getMonth() + 1, 1).getTime() };
}
const insightsSpan = () => (state.insightsRange === "all" ? allSpan() : spanBack(state.insightsRange, state.insightsBack));

/** Earlier and later buttons around the name of the period on screen. */
function stepper(action, range, span, back) {
  const unit = range === "today" ? "day" : RANGE_LABEL[range].toLowerCase();
  const hasEarlier = state.ledger.expenses.some(e => Date.parse(e.date) < span.start);
  return `<div class="stepper">
      <button data-action="${action}" data-dir="1" aria-label="Earlier ${unit}" ${hasEarlier ? "" : "disabled"}>‹</button>
      <strong aria-live="polite">${esc(spanLabel(range, span))}</strong>
      <button data-action="${action}" data-dir="-1" aria-label="Later ${unit}" ${back > 0 ? "" : "disabled"}>›</button></div>`;
}

/** "November 2026", "2026", or the first and last day when the period is not a calendar month. */
function spanLabel(range, span) {
  const first = new Date(span.start), last = new Date(span.end - 1);
  if (range === "all") return "all time";
  if (range === "year") return String(first.getFullYear());
  if (range === "today") return first.toLocaleDateString(LOCALE, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  if (range === "month" && first.getDate() === 1) return first.toLocaleDateString(LOCALE, { month: "long", year: "numeric" });
  const short = d => d.toLocaleDateString(LOCALE, { day: "numeric", month: "short" });
  return `${short(first)} to ${short(last)}${last.getFullYear() === new Date().getFullYear() ? "" : ` ${last.getFullYear()}`}`;
}

function viewInsights() {
  const range = state.insightsRange, span = insightsSpan();
  const all = range === "all";
  const past = !all && state.insightsBack > 0;
  const expenses = core.expensesIn(state.ledger, span);
  const sum = core.total(expenses);
  // the budget is monthly, so an earlier week or year has no budget figure of its own
  const status = all ? null : past ? (range === "month" ? core.budgetStatus(state.ledger, new Date(span.start)) : null) : core.budgetStatus(state.ledger);
  const daysSoFar = Math.max(1, Math.floor((Math.min(Date.now(), span.end - 1) - span.start) / 86400000) + 1);
  const now = Date.now();
  const unit = RANGE_LABEL[range].toLowerCase();
  const label = spanLabel(range, span);
  const here = all ? "everything you have logged" : past ? label : `this ${unit}`;
  const head = `<h1>Insights</h1>${chips(["week", "month", "year", "all"], range, "insights-range")}${all ? "" : stepper("insights-step", range, span, state.insightsBack)}`;
  const top = expenses.reduce((best, e) => (!best || core.toMinor(e.amount) > core.toMinor(best.amount) ? e : best), null);
  const biggest = top ? core.toMinor(top.amount) : 0;
  const nameOf = e => e.note || core.categoryById(state.ledger, e.categoryID)?.name || "Unknown";
  const tiles = `<div class="tiles">
      <div class="card tile"><div class="k">${all ? "Spent in total" : past ? "Spent" : `Spent this ${unit}`}</div><div class="v num">${esc(money(sum))}</div></div>
      ${all || (past && range !== "month") ? `<div class="card tile"><div class="k">Expenses</div><div class="v num">${expenses.length}</div></div>`
      : `<button class="card tile" data-action="tab" data-tab="settings" aria-label="Budget. Opens Settings to change it."><div class="k">${status ? (status.isOver ? "Over budget by" : "Budget left") : "Budget"}</div>
        <div class="v num ${status?.isOver ? "danger" : status ? "" : "muted"}">${status ? esc(money(Math.abs(status.remaining))) : "Not set"}</div>
        <div class="k">${status ? "Tap to change" : "Tap to set one"}</div></button>`}
      <div class="card tile"><div class="k">Average per day</div><div class="v num">${esc(money(Math.round(sum / daysSoFar)))}</div></div>
      <div class="card tile"><div class="k">Biggest expense</div><div class="v num">${biggest ? esc(money(biggest)) : "None"}</div>${top ? `<div class="k clip">${esc(nameOf(top))}</div>` : ""}</div></div>`;
  if (!expenses.length) {
    return `${head}${tiles}
      <div class="empty"><div class="glyph" aria-hidden="true">📊</div><strong>No spending to show</strong>${past ? "Nothing was logged in this period." : "Add an expense and this page fills in on its own."}</div>`;
  }
  // one bar per day, or per month for the year view
  const buckets = [];
  if (all) {                                             // one bar per month, from the first month with an expense
    const first = new Date(span.start);
    for (let t = new Date(first.getFullYear(), first.getMonth(), 1); t.getTime() < span.end; t.setMonth(t.getMonth() + 1)) {
      buckets.push({ start: t.getTime(), end: new Date(t.getFullYear(), t.getMonth() + 1, 1).getTime(), total: 0 });
    }
  } else if (range === "year") {
    const y = new Date(span.start).getFullYear();
    for (let m = 0; m < 12; m++) buckets.push({ start: new Date(y, m, 1).getTime(), end: new Date(y, m + 1, 1).getTime(), total: 0 });
  } else {
    for (let t = new Date(span.start); t.getTime() < span.end; t.setDate(t.getDate() + 1)) {
      buckets.push({ start: t.getTime(), end: new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1).getTime(), total: 0 });
    }
  }
  for (const b of buckets) b.count = 0;
  for (const e of expenses) { const t = Date.parse(e.date); const b = buckets.find(b => t >= b.start && t < b.end); if (b) { b.total += core.toMinor(e.amount); b.count++; } }
  const peak = Math.max(...buckets.map(b => b.total), 1);
  const yearly = range === "year" || all;
  // the bar being read out: the one tapped, else today (this month for the year view), else the highest
  const picked = buckets.find(b => b.start === state.insightsBar)
    || buckets.find(b => now >= b.start && now < b.end && b.total)
    || buckets.find(b => b.total === peak);
  const full = t => new Date(t).toLocaleDateString(LOCALE, yearly ? { month: "long", year: "numeric" } : { weekday: "short", day: "numeric", month: "short" });
  const tick = (b, i) => {
    const d = new Date(b.start);
    if (yearly && buckets.length > 12) return d.getMonth() === 0 || i === 0 ? String(d.getFullYear()).slice(2) : "";   // too many to letter: mark the years
    if (yearly) return d.toLocaleDateString(LOCALE, { month: "narrow" });
    if (range === "week") return d.toLocaleDateString(LOCALE, { weekday: "narrow" });
    const n = d.getDate();
    return (i === 0 || n % 5 === 0) && !(i === 1 && n % 5 === 0) ? String(n) : "";
  };
  const chart = `<div class="card"><div class="small muted">${yearly ? "By month" : "By day"}. Tap a bar to see the amount.</div>
      <div class="readout" aria-live="polite"><span>${esc(full(picked.start))}</span><strong class="num">${esc(money(picked.total))}</strong>
        <span class="small muted">${picked.count ? `${picked.count} expense${picked.count === 1 ? "" : "s"}` : "nothing spent"}</span></div>
      <div class="bars" role="group" aria-label="Spending ${yearly ? "by month" : "by day"}">${buckets.map((b, i) =>
        `<button type="button" class="col${b === picked ? " on" : ""}${b.total ? "" : " zero"}${b.start > now ? " later" : ""}" data-action="pick-bar" data-t="${b.start}"
          aria-pressed="${b === picked}" aria-label="${esc(full(b.start))}: ${esc(money(b.total))}">
          <span class="track"><i data-f="${b.total ? Math.max(b.total / peak, 0.05).toFixed(4) : 0}"></i></span><span class="tick" aria-hidden="true">${esc(tick(b, i))}</span></button>`).join("")}</div></div>`;
  const cats = core.byCategory(state.ledger, expenses);
  const rows = cats.map(r => `<button class="catrow" data-action="show-category" data-id="${esc(r.category.id)}">
      <div class="top"><span><span aria-hidden="true">${esc(r.category.emoji)}</span> ${esc(r.category.name)}</span><span class="num">${esc(money(r.total))} <span class="chev" aria-hidden="true">›</span></span></div>
      <div class="bot"><div class="meter" data-f="${r.share.toFixed(4)}" data-c="${esc(r.category.colorHex)}"><i></i></div><span class="pct num">${Math.round(r.share * 100)}%</span></div></button>`).join("");

  // plain-language findings, most useful first
  const pace = core.pace(expenses, span, now);
  const places = core.topPlaces(expenses, 50);
  const notes = [];
  notes.push(`<strong>${esc(cats[0].category.name)}</strong> is your biggest category: ${esc(money(cats[0].total))}, ${Math.round(cats[0].share * 100)}% of ${esc(here)}.`);
  if (pace.oneOff) {
    notes.push(`<strong>${esc(nameOf(pace.oneOff))}</strong> (${esc(money(core.toMinor(pace.oneOff.amount)))}) is one big payment. Everything else comes to ${esc(money(pace.everyday))}, about ${esc(money(pace.perDay))} a day.`);
  }
  const repeat = places.filter(p => p.count > 1).sort((a, b) => b.count - a.count || b.total - a.total)[0];
  if (repeat) notes.push(`You paid <strong>${esc(repeat.label)}</strong> ${repeat.count} times, ${esc(money(repeat.total))} in total.`);
  if (!yearly && pace.projected !== null && pace.daysLeft > 0) {
    let line = `At this pace you will end the ${unit} at about <strong>${esc(money(pace.projected))}</strong>.`;
    if (range === "month" && status) {
      const gap = pace.perDay * pace.daysLeft - status.remaining;
      line += gap > 0 ? ` That is ${esc(money(gap))} over your budget.` : ` That is ${esc(money(-gap))} under your budget.`;
      if (status.remaining > 0 && gap > 0) line += ` To stay inside it, keep to ${esc(money(Math.floor(status.remaining / pace.daysLeft)))} a day for the next ${pace.daysLeft} days.`;
    }
    notes.push(line);
  }
  const before = all ? null : core.intervalFor(range, new Date(span.start - 1), state.ledger.preferences.monthStartDay, WEEK_START);
  const cutoff = before ? before.start + (Math.min(now, span.end) - span.start) : 0;
  const then = before ? core.total(core.expensesIn(state.ledger, before).filter(e => Date.parse(e.date) < cutoff)) : 0;
  if (then > 0) {
    const diff = sum - then;
    const versus = past ? `the ${unit} before` : `at this point last ${unit}`;
    notes.push(diff === 0 ? `Exactly the same as ${versus}.`
      : `<strong>${esc(money(Math.abs(diff)))} ${diff > 0 ? "more" : "less"}</strong> than ${versus} (${esc(money(then))}).`);
  }
  const findings = `<div class="card"><div class="small muted">What stands out</div><ul class="notes">${notes.map(n => `<li>${n}</li>`).join("")}</ul></div>`;
  const placeRows = places.slice(0, 5).map(p => `<div class="place"><span class="clip">${esc(p.label)}</span>
      <span class="small muted">${p.count === 1 ? "once" : `${p.count} times`}</span><span class="num">${esc(money(p.total))}</span></div>`).join("");
  return `${head}${tiles}${findings}${chart}
    <div class="card"><div class="small muted">By category. Tap one to see its expenses.</div><div class="stack">${rows}</div></div>
    ${placeRows ? `<div class="card"><div class="small muted">Where the money went</div>${placeRows}</div>` : ""}`;
}

/** The expenses behind one category row on Insights, for the range being shown. */
function sheetCategoryExpenses(id) {
  const c = core.categoryById(state.ledger, id);
  const span = insightsSpan();
  const list = core.expensesIn(state.ledger, span).filter(e => e.categoryID === id)
    .sort((a, b) => core.toMinor(b.amount) - core.toMinor(a.amount));
  openSheet(`${sheetHeader(`${c?.emoji ?? ""} ${c?.name ?? "Unknown"}`, "Close")}
    <p class="small muted">${list.length} expense${list.length === 1 ? "" : "s"} ${state.insightsRange === "all" ? "in total" : `in ${esc(spanLabel(state.insightsRange, span))}`}, ${esc(money(core.total(list)))} in total. Biggest first.</p>
    <div class="list">${list.map(e => {
      const day = new Date(e.date).toLocaleDateString(LOCALE, { day: "numeric", month: "short" });
      return `<button class="item" data-action="edit-expense" data-id="${esc(e.id)}">
        <span class="main"><span class="title">${esc(e.note || c?.name || "Unknown")}</span><div class="sub">${esc(day)}</div></span>
        <span class="end"><span class="title num">${esc(money(core.toMinor(e.amount)))}</span></span></button>`; }).join("")}</div>`);
}

function viewSettings() {
  const p = state.ledger.preferences, active = core.activeCategories(state.ledger);
  const codes = (Intl.supportedValuesOf?.("currency") ?? ["USD", "EUR", "GBP", "INR", "JPY", "CAD", "AUD"]);
  const names = new Intl.DisplayNames([LOCALE], { type: "currency" });
  const installed = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  return `<h1>Settings</h1>
    ${state.notice ? `<p class="small warning">${esc(state.notice)}</p>` : ""}
    ${installed ? "" : `<div class="card small"><strong>Put this on your Home Screen.</strong> In Safari tap Share, then Add to Home Screen. Do it before adding real expenses: the Home Screen app keeps its own separate data.</div>`}
    <h2>Money</h2>
    <form class="card" data-form="money">
      <label class="f" for="currency">Currency</label>
      <select class="field" id="currency" name="currency">${codes.map(c => `<option value="${c}" ${c === p.currencyCode ? "selected" : ""}>${c} · ${esc(names.of(c) ?? c)}</option>`).join("")}</select>
      <label class="f" for="budget">Budget per month (leave empty for none)</label>
      <input class="field" id="budget" name="budget" inputmode="decimal" autocomplete="off" placeholder="No budget" value="${esc(p.monthlyBudget ?? "")}">
      <label class="f" for="startday">Month starts on day</label>
      <select class="field" id="startday" name="startday">${Array.from({ length: 31 }, (_, i) => `<option ${i + 1 === p.monthStartDay ? "selected" : ""}>${i + 1}</option>`).join("")}</select>
      <p class="small muted">Pick your payday to count each month from when the money arrives. Shorter months use their last day. Changing the currency relabels amounts; it does not convert them.</p>
      <p class="small danger" data-error role="alert"></p>
      <button class="btn secondary" type="submit">Save money settings</button>
    </form>
    <h2>Categories</h2>
    <div class="list">${active.map((c, i) => `<div class="item">
        <span class="badge" data-c="${esc(c.colorHex)}" aria-hidden="true">${esc(c.emoji)}</span>
        <span class="main"><span class="title">${esc(c.name)}</span></span>
        <button class="iconbtn" data-action="move-category" data-id="${esc(c.id)}" data-dir="-1" aria-label="Move ${esc(c.name)} up" ${i === 0 ? "disabled" : ""}>↑</button>
        <button class="iconbtn" data-action="move-category" data-id="${esc(c.id)}" data-dir="1" aria-label="Move ${esc(c.name)} down" ${i === active.length - 1 ? "disabled" : ""}>↓</button>
        <button class="iconbtn" data-action="edit-category" data-id="${esc(c.id)}" aria-label="Edit ${esc(c.name)}">✎</button></div>`).join("")}
      <button class="item link" data-action="edit-category" data-id="">＋ New category</button></div>
    <h2>Bring in expenses from another app</h2>
    <div class="card stack">
      <p class="small muted">Export a CSV file from the other app, then choose it here. It needs a date column and an amount column. You see what will be added before anything changes.</p>
      <label class="check small"><input type="checkbox" id="dayfirst"> Dates in the file are day first (16/11/2026)</label>
      <label class="btn secondary" for="import-file" role="button" tabindex="0">Choose a CSV file<input id="import-file" type="file" accept=".csv,text/csv,text/plain" hidden></label>
    </div>
    <h2>Your data</h2>
    <div class="card stack">
      <button class="btn secondary" data-action="export-csv">Export to CSV</button>
      <button class="btn secondary" data-action="save-backup">Save a backup</button>
      <label class="btn secondary" for="restore-file" role="button" tabindex="0">Restore from a backup<input id="restore-file" type="file" accept=".json,application/json" hidden></label>
      <p class="small muted">${state.ledger.expenses.length} expenses, stored only on this device. Removing the Home Screen icon or clearing Safari's website data deletes them, so save a backup to Files now and then.</p>
    </div>
    <h2>Open faster</h2>
    <details><summary>Double tap the back of the phone</summary><ol>
      <li>Open the Shortcuts app and make a shortcut with one action: Open App, set to ${APP_NAME}.</li>
      <li>Open iOS Settings, then Accessibility, Touch, Back Tap.</li><li>Choose Double Tap and pick that shortcut.</li>
      <li>Double tap the back of the phone. The number pad opens.</li></ol></details>
    <details><summary>Ask Siri</summary><ol><li>Name the shortcut above something short, such as Log expense.</li><li>Say: Hey Siri, log expense. The number pad opens and you type the amount.</li></ol></details>
    <p class="small muted">${APP_NAME} works with no connection. Nothing you enter leaves this device.</p>`;
}

const VIEWS = { add: viewAdd, history: viewHistory, insights: viewInsights, settings: viewSettings };
const TABS = [["history", "☰", "History"], ["add", "＋", "Add"], ["insights", "▥", "Insights"], ["settings", "⚙\uFE0E", "Settings"]];

function render() {
  if (!VIEWS[state.tab]) state.tab = "add";
  $("view").innerHTML = VIEWS[state.tab]();
  $("tabs").innerHTML = TABS.map(([id, glyph, name]) =>
    `<button data-action="tab" data-tab="${id}" ${id === state.tab ? 'aria-current="page"' : ""}><span class="glyph" aria-hidden="true">${glyph}</span>${name}</button>`).join("");
  paint(document.body);
  document.title = `${TABS.find(t => t[0] === state.tab)[2]} · ${APP_NAME}`;
}

// ---------- sheets ----------

function openSheet(html) {
  const sheet = $("sheet");
  sheet.innerHTML = `<div class="inner">${html}</div>`;
  paint(sheet);
  if (!sheet.open) sheet.showModal();
}
function closeSheet() { $("sheet").close(); $("sheet").innerHTML = ""; }
const sheetHeader = (title, close = "Cancel") => `<header><h1 id="sheet-title">${esc(title)}</h1><button class="link" data-action="close-sheet">${close}</button></header>`;
const localDate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const localDateTime = d => `${localDate(d)}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

function sheetExpense(id) {
  const e = state.ledger.expenses.find(x => x.id === id);
  if (!e) return;
  let choices = core.activeCategories(state.ledger);
  const own = core.categoryById(state.ledger, e.categoryID);
  if (own && !choices.includes(own)) choices = [...choices, own];        // its category was deleted since
  openSheet(`${sheetHeader("Edit expense")}
    <form data-form="expense" data-id="${esc(e.id)}">
      <label class="f" for="e-amount">Amount (${esc(code())})</label>
      <input class="field" id="e-amount" name="amount" inputmode="decimal" autocomplete="off" required value="${esc(e.amount)}">
      <label class="f" for="e-category">Category</label>
      <select class="field" id="e-category" name="category">${choices.map(c => `<option value="${esc(c.id)}" ${c.id === e.categoryID ? "selected" : ""}>${esc(c.emoji)} ${esc(c.name)}</option>`).join("")}</select>
      <label class="f" for="e-note">Note</label>
      <input class="field" id="e-note" name="note" maxlength="120" autocomplete="off" value="${esc(e.note)}">
      <label class="f" for="e-date">When</label>
      <input class="field" id="e-date" name="date" type="datetime-local" required max="${localDateTime(new Date())}" value="${localDateTime(new Date(e.date))}">
      <p class="small danger" data-error role="alert"></p>
      <div class="stack"><button class="btn" type="submit">Save changes</button>
      <button class="btn destructive" type="button" data-action="delete-expense" data-id="${esc(e.id)}">Delete expense</button></div>
    </form>`);
}

function sheetCategory(id) {
  const c = id ? core.categoryById(state.ledger, id) : null;
  const color = c?.colorHex ?? core.PALETTE[state.ledger.categories.length % core.PALETTE.length];
  openSheet(`${sheetHeader(c ? "Edit category" : "New category")}
    <form data-form="category" data-id="${esc(id || "")}">
      <label class="f" for="c-name">Name</label>
      <input class="field" id="c-name" name="name" maxlength="30" autocomplete="off" required placeholder="Coffee, Rent, Pets" value="${esc(c?.name ?? "")}">
      <label class="f" for="c-emoji">Emoji</label>
      <input class="field" id="c-emoji" name="emoji" maxlength="8" autocomplete="off" value="${esc(c?.emoji ?? "🙂")}">
      <label class="f" id="c-color-label">Colour</label>
      <div class="swatches" role="group" aria-labelledby="c-color-label">${core.PALETTE.map((hex, i) =>
        `<button type="button" class="swatch" data-action="pick-color" data-hex="${hex}" data-c="${hex}" aria-label="Colour ${i + 1}" aria-pressed="${hex === color}"></button>`).join("")}</div>
      <input type="hidden" name="color" value="${color}">
      <p class="small danger" data-error role="alert"></p>
      <div class="stack"><button class="btn" type="submit">Save category</button>
      ${c ? `<button class="btn destructive" type="button" data-action="delete-category" data-id="${esc(c.id)}">Delete category</button>
        <p class="small muted">Past expenses keep this category's name in History.</p>` : ""}</div>
    </form>`);
}

let pendingLedger = null;
function sheetImport(plan) {
  pendingLedger = plan.added ? plan.ledger : null;
  const skipped = plan.skipped.length ? `<p class="small muted">${plan.skipped.length} row${plan.skipped.length === 1 ? "" : "s"} will be left out:</p>
    <ul class="skipped">${plan.skipped.map(s => `<li>Row ${s.line}: ${esc(s.reason)}</li>`).join("")}</ul>` : "";
  openSheet(`${sheetHeader("Import expenses")}
    ${plan.problem ? `<p class="danger">${esc(plan.problem)}</p>` : `
      <p><strong>${plan.added}</strong> expense${plan.added === 1 ? "" : "s"} will be added${plan.newCategories.length ? `, with ${plan.newCategories.length} new categor${plan.newCategories.length === 1 ? "y" : "ies"}: ${esc(plan.newCategories.join(", "))}` : ""}.</p>
      <p class="small muted">Amounts are taken as ${esc(code())}. Check a few in History afterwards; if the dates look swapped, undo by restoring your backup and tick "day first".</p>${skipped}`}
    <div class="stack"><button class="btn" data-action="confirm-import" ${plan.added ? "" : "disabled"}>Add ${plan.added} expense${plan.added === 1 ? "" : "s"}</button></div>`);
}

function sheetRestore(restored) {
  pendingLedger = restored;
  openSheet(`${sheetHeader("Replace everything?")}
    <p>This backup has <strong>${restored.expenses.length}</strong> expenses. The app has <strong>${state.ledger.expenses.length}</strong> now, and they will be gone.</p>
    <p class="small muted">Save a backup first if you might want the current ones back.</p>
    <div class="stack"><button class="btn destructive" data-action="confirm-restore">Replace with the backup</button></div>`);
}

// ---------- files ----------

async function giveFile(name, text, type) {
  const file = new File([text], name, { type });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return; } catch (error) { if (error.name === "AbortError") return; }
  }
  const link = Object.assign(document.createElement("a"), { href: URL.createObjectURL(file), download: name });
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 10000);
}

// ---------- actions ----------

function fail(form, error) {
  form.querySelector("[data-error]").textContent = ERROR_TEXT[error.code] || "That did not save. Please try again.";
}

const ACTIONS = {
  tab: el => { state.tab = el.dataset.tab; render(); $("view").focus({ preventScroll: true }); scrollTo(0, 0); },
  "history-range": el => { state.historyRange = el.dataset.range; state.historyBack = 0; render(); },
  "history-step": el => { state.historyBack = Math.max(0, state.historyBack + Number(el.dataset.dir)); render(); scrollTo(0, 0); },
  "insights-range": el => { state.insightsRange = el.dataset.range; state.insightsBar = null; state.insightsBack = 0; render(); },
  "insights-step": el => { state.insightsBack = Math.max(0, state.insightsBack + Number(el.dataset.dir)); state.insightsBar = null; render(); },
  "show-category": el => sheetCategoryExpenses(el.dataset.id),
  "pick-bar": el => { state.insightsBar = Number(el.dataset.t); render(); },
  digit: el => { state.entry = core.entryAppend(state.entry, Number(el.dataset.digit), digits()); state.addError = null; render(); },
  separator: () => { state.entry = core.entrySeparator(state.entry, digits()); render(); },
  backspace: () => { state.entry = core.entryBackspace(state.entry); render(); },
  "pick-category": el => { state.categoryID = el.dataset.id; render(); },
  "save-expense": () => {
    const minor = core.entryValue(state.entry);
    if (!minor) return;
    let date = new Date();
    if (state.addDate && state.addDate !== localDate(date)) {                 // a past day: keep the day, use midday
      const [y, m, d] = state.addDate.split("-").map(Number);
      date = new Date(y, m - 1, d, 12);
    }
    try {
      const { ledger, expense } = core.addExpense(state.ledger, { amount: core.fromMinor(minor), categoryID: chosenCategory().id, note: state.note, date });
      if (!commit(ledger)) return;
      localStorage.setItem("lastCategoryID", expense.categoryID);
      Object.assign(state, { entry: "", note: "", lastSaved: expense, addError: null, categoryID: expense.categoryID });
      navigator.vibrate?.(10);
    } catch (error) { state.addError = ERROR_TEXT[error.code] || "That did not save. Please try again."; }
    render();
  },
  undo: () => {
    const e = state.lastSaved;
    if (e && commit(core.deleteExpense(state.ledger, e.id))) Object.assign(state, { entry: e.amount, note: e.note, lastSaved: null });
    render();
  },
  "edit-expense": el => sheetExpense(el.dataset.id),
  "delete-expense": el => {
    if (el.dataset.armed !== "yes") { el.dataset.armed = "yes"; el.textContent = "Tap again to delete"; return; }
    if (commit(core.deleteExpense(state.ledger, el.dataset.id))) { closeSheet(); render(); toast("Expense deleted."); }
  },
  "edit-category": el => sheetCategory(el.dataset.id),
  "pick-color": el => {
    el.closest("form").elements.color.value = el.dataset.hex;
    el.parentElement.querySelectorAll(".swatch").forEach(s => s.setAttribute("aria-pressed", String(s === el)));
  },
  "delete-category": el => {
    if (el.dataset.armed !== "yes") { el.dataset.armed = "yes"; el.textContent = "Tap again to delete"; return; }
    try { if (commit(core.removeCategory(state.ledger, el.dataset.id))) { closeSheet(); render(); } }
    catch (error) { fail(el.closest("form"), error); }
  },
  "move-category": el => { if (commit(core.moveCategory(state.ledger, el.dataset.id, Number(el.dataset.dir)))) render(); },
  "close-sheet": () => { pendingLedger = null; closeSheet(); },
  "export-csv": () => giveFile("Expenses.csv", core.toCSV(state.ledger), "text/csv"),
  "save-backup": () => giveFile(`${APP_NAME} backup ${localDate(new Date())}.json`, core.encodeBackup(state.ledger), "application/json"),
  "confirm-import": () => {
    const before = state.ledger.expenses.length;
    if (pendingLedger && commit(pendingLedger)) { toast(`Added ${state.ledger.expenses.length - before} expenses.`); state.tab = "history"; state.historyRange = "all"; }
    pendingLedger = null; closeSheet(); render();
  },
  "confirm-restore": () => {
    if (pendingLedger && commit(pendingLedger)) toast(`Restored ${state.ledger.expenses.length} expenses.`);
    pendingLedger = null; closeSheet(); render();
  },
};

const FORMS = {
  money: form => {
    const raw = form.elements.budget.value.trim();
    const parsed = raw === "" ? null : core.parseLooseAmount(raw);
    if (raw !== "" && (!parsed || parsed.minor <= 0 || parsed.negative)) {
      form.querySelector("[data-error]").textContent = "The budget has to be a number above zero, or empty for none.";
      return;
    }
    const next = core.setPreferences(state.ledger, { currencyCode: form.elements.currency.value,
      monthlyBudget: parsed ? core.fromMinor(parsed.minor) : null, monthStartDay: Number(form.elements.startday.value) });
    if (commit(next)) { state.entry = ""; render(); toast("Money settings saved."); }
  },
  expense: form => {
    const original = state.ledger.expenses.find(e => e.id === form.dataset.id);
    const amount = core.parseLooseAmount(form.elements.amount.value);
    const date = new Date(form.elements.date.value);
    if (!original || isNaN(date)) return fail(form, {});
    if (!amount || amount.negative) return fail(form, { code: "amountNotPositive" });
    try {
      const next = core.updateExpense(state.ledger, { ...original, amount: core.fromMinor(amount.minor),
        categoryID: form.elements.category.value, note: form.elements.note.value, date });
      if (commit(next)) { closeSheet(); render(); }
    } catch (error) { fail(form, error); }
  },
  category: form => {
    const values = { name: form.elements.name.value, emoji: [...form.elements.emoji.value.trim()].slice(0, 4).join("") || "🙂", colorHex: form.elements.color.value };
    try {
      const next = form.dataset.id ? core.updateCategory(state.ledger, form.dataset.id, values) : core.addCategory(state.ledger, values).ledger;
      if (commit(next)) { closeSheet(); render(); }
    } catch (error) { fail(form, error); }
  },
};

document.addEventListener("click", event => {
  const el = event.target.closest("[data-action]");
  if (el && !el.disabled) ACTIONS[el.dataset.action]?.(el);
});
document.addEventListener("submit", event => {
  event.preventDefault();
  FORMS[event.target.dataset.form]?.(event.target);
});
document.addEventListener("input", event => {
  if (event.target.id === "note") state.note = event.target.value;        // no re-render, so the keyboard stays up
});
document.addEventListener("keydown", event => {
  if (event.target.id === "note" && event.key === "Enter") event.target.blur();
  if (event.target.matches("label[role=button]") && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); event.target.click(); }
});
document.addEventListener("change", async event => {
  const input = event.target;
  if (input.id === "add-date") { state.addDate = input.value && input.value !== localDate(new Date()) ? input.value : null; render(); return; }
  if (input.type !== "file" || !input.files[0]) return;
  const text = await input.files[0].text();
  if (input.id === "import-file") {
    sheetImport(core.planImport(state.ledger, text, { dayFirst: $("dayfirst").checked }));
  } else if (input.id === "restore-file") {
    try { sheetRestore(core.decodeBackup(text)); } catch (error) { toast(ERROR_TEXT[error.code] || ERROR_TEXT.notABackup); }
  }
  input.value = "";
});
// The date chip is a label around a visually hidden date input; this opens the picker where the browser allows it.
document.addEventListener("click", event => {
  if (!event.target.closest('label[for="add-date"]')) return;
  try { $("add-date").showPicker?.(); } catch { /* the label's own click still focuses the input */ }
});
$("sheet").addEventListener("close", () => { pendingLedger = null; });

// ---------- start ----------

state.ledger = load();
render();

// iOS keeps the app as it was left. Coming back after a while (Back Tap, the Home Screen) is nearly always to log
// something, so return to the number pad, unless an expense or category is open for editing.
let hiddenAt = 0;
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  if (hiddenAt && Date.now() - hiddenAt > 10000 && state.tab !== "add" && !$("sheet").open) {
    Object.assign(state, { tab: "add", historyBack: 0, insightsBack: 0 });
    render(); scrollTo(0, 0);
  }
});
navigator.storage?.persist?.();                       // asks the browser not to clear the data on its own
if ("serviceWorker" in navigator) {
  if (["localhost", "127.0.0.1"].includes(location.hostname)) {
    // On the development machine the offline copy only gets in the way: always load the files as they are now.
    navigator.serviceWorker.getRegistrations().then(list => list.forEach(r => r.unregister())).catch(() => {});
    if (window.caches) caches.keys().then(keys => keys.forEach(k => caches.delete(k))).catch(() => {});
  } else navigator.serviceWorker.register("sw.js").catch(() => {});
}
