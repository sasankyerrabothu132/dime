// Rules and maths for the expense tracker. No DOM in here, so it runs under `node --test` too.
// Backup files use the same shape as the native app's ledger.json, so the two can swap data.

export const SCHEMA_VERSION = 1;
const SCALE = 1000; // amounts are summed as whole thousandths, so 0.1 + 0.2 is exactly 0.3

export const PALETTE = ["#F2994A", "#56A8F5", "#6FCF97", "#BB9AF7", "#F2C94C", "#EB7B9C",
  "#4DD0C8", "#A0A7B4", "#FF7A7A", "#B8F26B", "#7FA8FF", "#E0A6FF"];

const STARTERS = [["Food", "🍜"], ["Transport", "🚌"], ["Groceries", "🧺"], ["Bills", "🧾"],
  ["Shopping", "🛒"], ["Health", "💊"], ["Fun", "🎟️"], ["Other", "📦"]];

export class EditError extends Error {
  constructor(code) { super(code); this.code = code; }
}

export function newId() { return crypto.randomUUID().toUpperCase(); }

export function newLedger() {
  return {
    schemaVersion: SCHEMA_VERSION,
    expenses: [],
    categories: STARTERS.map(([name, emoji], i) => (
      { id: newId(), name, emoji, colorHex: PALETTE[i], sortOrder: i, isArchived: false })),
    preferences: { currencyCode: "USD", monthlyBudget: null, monthStartDay: 1 },
  };
}

// ---------- money ----------

/** "12.50" -> 12500. Returns null for anything that is not a plain non-negative number. */
export function toMinor(text) {
  const match = /^(\d{1,12})(?:\.(\d{0,3}))?$/.exec(String(text).trim());
  if (!match) return null;
  return Number(match[1]) * SCALE + Number((match[2] || "").padEnd(3, "0"));
}

/** 12500 -> "12.5" */
export function fromMinor(minor) {
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  const frac = String(abs % SCALE).padStart(3, "0").replace(/0+$/, "");
  return sign + Math.floor(abs / SCALE) + (frac ? "." + frac : "");
}

export function fractionDigits(code) {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency: code }).resolvedOptions().maximumFractionDigits;
  } catch { return 2; }
}

export function formatMoney(minor, code, locale) {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency: code }).format(minor / SCALE);
  } catch { return `${code} ${fromMinor(minor)}`; }
}

/** Reads amounts people and spreadsheets write: "$1,234.50", "1.234,50 €", "12,5", "-4.20". */
export function parseLooseAmount(raw) {
  let text = String(raw).replace(/[^\d.,-]/g, "");
  if (!/\d/.test(text)) return null;
  const negative = text.startsWith("-");
  text = text.replace(/-/g, "");
  const lastDot = text.lastIndexOf("."), lastComma = text.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    const decimal = lastDot > lastComma ? "." : ",";
    text = text.split(decimal === "." ? "," : ".").join("").replace(decimal, ".");
  } else if (lastComma >= 0) {
    const tail = text.length - lastComma - 1;
    text = tail === 3 && text.indexOf(",") === lastComma && text.length > 4 ? text.replace(",", "") // 1,234
      : text.split(",").length > 2 ? text.split(",").join("") : text.replace(",", ".");
  } else if (text.split(".").length > 2) {
    text = text.split(".").join("");
  }
  const [whole, frac = ""] = text.split(".");
  const minor = toMinor(`${whole || "0"}.${frac.slice(0, 3)}`);
  return minor === null ? null : { minor, negative };
}

// ---------- number pad ----------

export function entryAppend(text, digit, maxFrac) {
  const [whole, frac] = text.split(".");
  if (frac !== undefined) return frac.length < maxFrac ? text + digit : text;
  if (text === "0") return String(digit);            // "0" then "5" is "5"
  return whole.length >= 9 ? text : text + digit;
}
export function entrySeparator(text, maxFrac) {
  if (maxFrac === 0 || text.includes(".")) return text;
  return text === "" ? "0." : text + ".";
}
export function entryBackspace(text) {
  const next = text.slice(0, -1);
  return next === "0" ? "" : next;
}
/** Minor units, or null until the amount is above zero. */
export function entryValue(text) {
  const minor = toMinor(text.endsWith(".") ? text.slice(0, -1) : text);
  return minor && minor > 0 ? minor : null;
}

// ---------- reading ----------

export function activeCategories(ledger) {
  return ledger.categories.filter(c => !c.isArchived)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}
export function categoryById(ledger, id) { return ledger.categories.find(c => c.id === id) || null; }
export function categoryByName(ledger, name) {
  const wanted = String(name).trim().toLowerCase();
  return wanted ? activeCategories(ledger).find(c => c.name.toLowerCase() === wanted) || null : null;
}

/** interval null means all time. Newest first. */
export function expensesIn(ledger, interval) {
  const picked = interval
    ? ledger.expenses.filter(e => { const t = Date.parse(e.date); return t >= interval.start && t < interval.end; })
    : ledger.expenses.slice();
  return picked.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
}

// ---------- editing (each returns a new ledger; the old one is never changed) ----------

const clone = ledger => structuredClone(ledger);
export function isoSeconds(date) { return new Date(date).toISOString().replace(/\.\d{3}Z$/, "Z"); }

function checkExpense(ledger, amount, categoryID) {
  const minor = toMinor(amount);
  if (minor === null || minor <= 0) throw new EditError("amountNotPositive");
  if (!categoryById(ledger, categoryID)) throw new EditError("unknownCategory");
  return fromMinor(minor);
}

export function addExpense(ledger, { amount, categoryID, note = "", date = new Date() }) {
  const clean = checkExpense(ledger, amount, categoryID);
  const next = clone(ledger);
  const expense = { id: newId(), amount: clean, categoryID, note: note.trim(), date: isoSeconds(date) };
  next.expenses.push(expense);
  return { ledger: next, expense };
}

export function updateExpense(ledger, changed) {
  const clean = checkExpense(ledger, changed.amount, changed.categoryID);
  const next = clone(ledger);
  const index = next.expenses.findIndex(e => e.id === changed.id);
  if (index < 0) throw new EditError("unknownExpense");
  next.expenses[index] = { ...changed, amount: clean, note: changed.note.trim(), date: isoSeconds(changed.date) };
  return next;
}

export function deleteExpense(ledger, id) {
  const next = clone(ledger);
  next.expenses = next.expenses.filter(e => e.id !== id);
  return next;
}

function cleanName(ledger, name, exceptId) {
  const clean = String(name).trim();
  if (!clean) throw new EditError("emptyName");
  const clash = ledger.categories.some(c => !c.isArchived && c.id !== exceptId && c.name.toLowerCase() === clean.toLowerCase());
  if (clash) throw new EditError("duplicateName");
  return clean;
}

export function addCategory(ledger, { name, emoji, colorHex }) {
  const clean = cleanName(ledger, name, null);
  const next = clone(ledger);
  const order = Math.max(-1, ...next.categories.map(c => c.sortOrder)) + 1;
  const category = { id: newId(), name: clean, emoji: emoji || "🙂", colorHex, sortOrder: order, isArchived: false };
  next.categories.push(category);
  return { ledger: next, category };
}

export function updateCategory(ledger, id, { name, emoji, colorHex }) {
  const next = clone(ledger);
  const category = next.categories.find(c => c.id === id);
  if (!category) throw new EditError("unknownCategory");
  Object.assign(category, { name: cleanName(ledger, name, id), emoji: emoji || "🙂", colorHex });
  return next;
}

/** A category that has expenses is archived, so history keeps its name. */
export function removeCategory(ledger, id) {
  const next = clone(ledger);
  const category = next.categories.find(c => c.id === id);
  if (!category) throw new EditError("unknownCategory");
  if (!category.isArchived && activeCategories(next).length <= 1) throw new EditError("lastCategory");
  if (next.expenses.some(e => e.categoryID === id)) category.isArchived = true;
  else next.categories = next.categories.filter(c => c.id !== id);
  return next;
}

/** direction -1 moves up, +1 moves down. */
export function moveCategory(ledger, id, direction) {
  const next = clone(ledger);
  const ids = activeCategories(next).map(c => c.id);
  const from = ids.indexOf(id), to = from + direction;
  if (from < 0 || to < 0 || to >= ids.length) return next;
  [ids[from], ids[to]] = [ids[to], ids[from]];
  ids.forEach((cid, position) => { next.categories.find(c => c.id === cid).sortOrder = position; });
  return next;
}

export function setPreferences(ledger, changes) {
  const next = clone(ledger);
  Object.assign(next.preferences, changes);
  next.preferences.monthStartDay = Math.min(31, Math.max(1, Math.trunc(next.preferences.monthStartDay) || 1));
  return next;
}

// ---------- periods (all in the phone's local time) ----------

function startDayIn(year, month, startDay) {
  const length = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(startDay, length));
}

/** The budget month can start on any day, a payday for example. Day 29 to 31 clamps in short months. */
export function budgetMonth(date, startDay = 1) {
  const day = Math.min(31, Math.max(1, startDay));
  const d = new Date(date);
  let start = startDayIn(d.getFullYear(), d.getMonth(), day);
  if (d < start) start = startDayIn(d.getFullYear(), d.getMonth() - 1, day);
  const end = startDayIn(start.getFullYear(), start.getMonth() + 1, day);
  return { start: start.getTime(), end: end.getTime() };
}

/** range: today | week | month | year | all. weekStart 0 is Sunday, 1 is Monday. */
export function intervalFor(range, date, startDay = 1, weekStart = 0) {
  const d = new Date(date);
  const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  switch (range) {
    case "today": return { start: midnight.getTime(), end: new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime() };
    case "week": {
      const back = (midnight.getDay() - weekStart + 7) % 7;
      return { start: new Date(d.getFullYear(), d.getMonth(), d.getDate() - back).getTime(),
               end: new Date(d.getFullYear(), d.getMonth(), d.getDate() - back + 7).getTime() };
    }
    case "month": return budgetMonth(d, startDay);
    case "year": return { start: new Date(d.getFullYear(), 0, 1).getTime(), end: new Date(d.getFullYear() + 1, 0, 1).getTime() };
    default: return null;
  }
}

// ---------- summaries ----------

export function total(expenses) { return expenses.reduce((sum, e) => sum + toMinor(e.amount), 0); }

/** Biggest first: [{category, total, share, count}] */
export function byCategory(ledger, expenses) {
  const sums = new Map();
  for (const e of expenses) {
    const row = sums.get(e.categoryID) || { total: 0, count: 0 };
    row.total += toMinor(e.amount); row.count += 1;
    sums.set(e.categoryID, row);
  }
  const grand = [...sums.values()].reduce((s, r) => s + r.total, 0);
  return [...sums].map(([id, row]) => ({ category: categoryById(ledger, id), ...row, share: grand ? row.total / grand : 0 }))
    .filter(row => row.category)
    .sort((a, b) => b.total - a.total || a.category.name.localeCompare(b.category.name));
}

/** Newest day first: [{day (local midnight ms), expenses, total}] */
export function byDay(expenses) {
  const groups = new Map();
  for (const e of expenses) {
    const d = new Date(e.date);
    const key = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  return [...groups].map(([day, list]) => (
    { day, expenses: list.sort((a, b) => Date.parse(b.date) - Date.parse(a.date)), total: total(list) }))
    .sort((a, b) => b.day - a.day);
}

/** Expenses grouped by their note, ignoring case: [{label, count, total}], biggest total first. Notes left empty are skipped. */
export function topPlaces(expenses, limit = 5) {
  const groups = new Map();
  for (const e of expenses) {
    const label = (e.note || "").trim().replace(/\s+/g, " ");
    if (!label) continue;
    const key = label.toLowerCase();
    const g = groups.get(key) || { label, count: 0, total: 0 };
    g.count++; g.total += toMinor(e.amount);
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.total - a.total || b.count - a.count).slice(0, limit);
}

/**
 * What an expense was really for. A few kinds of spending are recognised by words in the note, so that every cab
 * ride or every flight is counted together whatever category it was filed under; anything else is grouped by its
 * category. Order matters: "Uber Eats" is food, not a cab.
 */
const KINDS = [
  [null, /\b(uber\s*eats|ubereats|door\s*dash|grubhub|instacart|swiggy|zomato)\b/i],          // falls through to the category
  ["Cabs", /\b(uber|lyft|taxi|cab|cabs|ola|rapido|waymo)\b/i],
  ["Flights", /\b(flight|flights|airline|airlines|airways|airfare|air india|indigo|delta|southwest|spirit|frontier|emirates|jetblue)\b/i],
  ["Fuel", /\b(fuel|gas|gasoline|petrol|diesel)\b/i],
  ["Rent", /\brent\b/i],
];
export function kindOf(ledger, expense) {
  const note = expense.note || "";
  for (const [label, pattern] of KINDS) if (pattern.test(note)) { if (label) return label; break; }
  return categoryById(ledger, expense.categoryID)?.name || "Other";
}

/** Spending by kind, biggest first: [{label, count, total, share, places: topPlaces of that kind}]. */
export function byKind(ledger, expenses) {
  const groups = new Map();
  for (const e of expenses) {
    const label = kindOf(ledger, e);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(e);
  }
  const grand = total(expenses);
  return [...groups].map(([label, list]) => (
    { label, count: list.length, total: total(list), share: grand ? total(list) / grand : 0, places: topPlaces(list, 50) }))
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
}

/**
 * Where a period is heading. A single expense that is at least 30% of the total and three times the next biggest (rent, a flight) is treated as a
 * one-off: it is counted once, and only the rest is assumed to continue at the same daily rate.
 * Returns {oneOff (expense or null), everyday, perDay, daysSoFar, daysTotal, daysLeft, projected (null once the period is over)}.
 */
export function pace(expenses, span, now = Date.now()) {
  const DAY = 86400000;
  const sum = total(expenses);
  const daysTotal = Math.round((span.end - span.start) / DAY);
  const daysSoFar = Math.min(daysTotal, Math.max(1, Math.floor((now - span.start) / DAY) + 1));
  const biggest = expenses.reduce((top, e) => (!top || toMinor(e.amount) > toMinor(top.amount) ? e : top), null);
  const second = expenses.reduce((top, e) => (e !== biggest ? Math.max(top, toMinor(e.amount)) : top), 0);
  const oneOff = biggest && second > 0 && toMinor(biggest.amount) * 10 >= sum * 3 && toMinor(biggest.amount) >= second * 3 ? biggest : null;
  const everyday = sum - (oneOff ? toMinor(oneOff.amount) : 0);
  const perDay = Math.round(everyday / daysSoFar);
  const over = now >= span.end;
  return { oneOff, everyday, perDay, daysSoFar, daysTotal, daysLeft: daysTotal - daysSoFar,
           projected: over ? null : sum + perDay * (daysTotal - daysSoFar) };
}

/** null when no budget is set. */
export function budgetStatus(ledger, date = new Date()) {
  const budget = ledger.preferences.monthlyBudget === null ? null : toMinor(ledger.preferences.monthlyBudget);
  if (!budget) return null;
  const spent = total(expensesIn(ledger, budgetMonth(date, ledger.preferences.monthStartDay)));
  return { budget, spent, remaining: budget - spent, isOver: spent > budget, fractionUsed: Math.min(1, spent / budget) };
}

// ---------- CSV ----------

const pad = n => String(n).padStart(2, "0");
const localDay = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function csvEscape(field) {
  let cell = String(field);
  if (/^[=+\-@\t\r]/.test(cell) && !/^-?\d+(\.\d+)?$/.test(cell)) cell = "'" + cell;   // not a formula
  return /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

export function toCSV(ledger) {
  const lines = ["date,time,category,note,amount,currency"];
  const sorted = ledger.expenses.slice().sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  for (const e of sorted) {
    const d = new Date(e.date);
    lines.push([localDay(d), `${pad(d.getHours())}:${pad(d.getMinutes())}`, categoryById(ledger, e.categoryID)?.name ?? "Unknown",
      e.note, e.amount, ledger.preferences.currencyCode].map(csvEscape).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

/** RFC 4180 reader. Also accepts semicolon or tab separated files. Returns rows of strings. */
export function parseCSV(text) {
  const body = text.replace(/^\uFEFF/, "");
  const firstLine = body.split(/\r?\n/, 1)[0];
  const sep = [",", ";", "\t"].map(s => [s, firstLine.split(s).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], cell = "", quoted = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quoted) {
      if (ch === '"' && body[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === sep) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && body[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ""));
}

const HEADER_NAMES = {
  date: ["date", "day", "created", "created at", "timestamp", "datetime", "date time", "when"],
  time: ["time"],
  category: ["category", "categories", "type", "group", "tag"],
  note: ["note", "notes", "description", "title", "name", "memo", "details", "comment", "merchant"],
  amount: ["amount", "price", "value", "total", "cost", "expense", "spent", "sum"],
};

/** Understands 2026-11-16, 2026-11-16T14:05:00Z, 16/11/2026, 11/16/2026, "Nov 16, 2026". */
export function parseLooseDate(dateText, timeText = "", dayFirst = false) {
  const text = String(dateText).trim();
  let y, m, d, rest = "";
  let hit = /^(\d{4})-(\d{1,2})-(\d{1,2})(.*)$/.exec(text);
  if (hit) {
    if (/[T ]\d{1,2}:\d{2}.*(Z|[+-]\d{2}:?\d{2})$/.test(hit[4])) {       // has its own time zone
      const exact = new Date(text.replace(" ", "T"));
      return isNaN(exact) ? null : exact;
    }
    [y, m, d, rest] = [+hit[1], +hit[2], +hit[3], hit[4]];
  } else if ((hit = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})(.*)$/.exec(text))) {
    let a = +hit[1], b = +hit[2];
    y = +hit[3] < 100 ? 2000 + +hit[3] : +hit[3];
    rest = hit[4];
    if (a > 12) [d, m] = [a, b]; else if (b > 12) [m, d] = [a, b]; else [d, m] = dayFirst ? [a, b] : [b, a];
  } else {
    const guess = new Date(timeText ? `${text} ${timeText}` : text);
    return isNaN(guess) ? null : guess;
  }
  const clock = /(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]m)?/i.exec(`${rest} ${timeText}`);
  let h = 12, min = 0, s = 0;                                             // no time given: midday
  if (clock) {
    h = +clock[1]; min = +clock[2]; s = +(clock[3] || 0);
    if (clock[4]) h = (h % 12) + (clock[4].toLowerCase() === "pm" ? 12 : 0);
  }
  const made = new Date(y, m - 1, d, h, min, s);
  return made.getMonth() === m - 1 && made.getDate() === d ? made : null;  // rejects 31/02
}

/**
 * Works out what a CSV would add, without changing anything.
 * Returns { ledger, added, newCategories, skipped: [{line, reason}], problem }.
 */
export function planImport(ledger, text, { dayFirst = false } = {}) {
  const rows = parseCSV(text);
  const empty = { ledger, added: 0, newCategories: [], skipped: [], problem: null };
  if (rows.length < 2) return { ...empty, problem: "The file has no rows to import." };
  const headers = rows[0].map(h => h.trim().toLowerCase());
  const col = {};
  for (const [field, names] of Object.entries(HEADER_NAMES)) {
    col[field] = headers.findIndex(h => names.includes(h));
    if (col[field] < 0) col[field] = headers.findIndex(h => names.some(n => h.includes(n)) && !Object.values(col).includes(headers.indexOf(h)));
  }
  if (col.amount < 0) return { ...empty, problem: "No amount column was found. The first row needs a heading such as Amount." };
  if (col.date < 0) return { ...empty, problem: "No date column was found. The first row needs a heading such as Date." };

  let next = clone(ledger);
  const seen = new Set(next.expenses.map(e => [isoSeconds(e.date), e.amount, e.categoryID, e.note].join("|")));
  const result = { ...empty, newCategories: [], skipped: [] };
  // Some apps write every expense as a negative number. Then the sign means nothing and is dropped.
  const signs = rows.slice(1).map(r => parseLooseAmount(r[col.amount] ?? "")).filter(a => a && a.minor > 0);
  const allNegative = signs.length > 0 && signs.every(a => a.negative);
  rows.slice(1).forEach((row, index) => {
    const line = index + 2;
    const get = field => (col[field] >= 0 ? (row[col[field]] ?? "").trim() : "");
    const amount = parseLooseAmount(get("amount"));
    if (!amount || amount.minor <= 0) return result.skipped.push({ line, reason: `amount "${get("amount")}" is not a number above zero` });
    if (amount.negative && !allNegative) return result.skipped.push({ line, reason: "negative amount (a refund or income)" });
    const date = parseLooseDate(get("date"), col.time !== col.date ? get("time") : "", dayFirst);
    if (!date) return result.skipped.push({ line, reason: `date "${get("date")}" was not understood` });
    const name = get("category").replace(/^[^\p{L}\p{N}]+/u, "").trim() || "Other";   // drops a leading emoji
    let category = categoryByName(next, name);
    if (!category) {
      const made = addCategory(next, { name, emoji: "🏷️", colorHex: PALETTE[next.categories.length % PALETTE.length] });
      next = made.ledger; category = made.category; result.newCategories.push(name);
    }
    const key = [isoSeconds(date), fromMinor(amount.minor), category.id, get("note")].join("|");
    if (seen.has(key)) return result.skipped.push({ line, reason: "already in the app" });
    seen.add(key);
    next = addExpense(next, { amount: fromMinor(amount.minor), categoryID: category.id, note: get("note"), date }).ledger;
    result.added += 1;
  });
  return { ...result, ledger: next };
}

// ---------- backup ----------

export function encodeBackup(ledger) { return JSON.stringify(ledger, null, 2); }

/** Throws EditError("notABackup") or EditError("newerVersion"). */
export function decodeBackup(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new EditError("notABackup"); }
  const ok = data && Number.isInteger(data.schemaVersion) && Array.isArray(data.expenses) &&
    Array.isArray(data.categories) && data.categories.length > 0 && data.preferences;
  if (!ok) throw new EditError("notABackup");
  if (data.schemaVersion > SCHEMA_VERSION) throw new EditError("newerVersion");
  const ids = new Set();
  const categories = data.categories.map((c, i) => {
    if (typeof c.id !== "string" || typeof c.name !== "string") throw new EditError("notABackup");
    ids.add(c.id);
    return { id: c.id, name: c.name, emoji: String(c.emoji ?? "🙂"), colorHex: /^#[0-9a-f]{6}$/i.test(c.colorHex) ? c.colorHex : PALETTE[i % PALETTE.length],
      sortOrder: Number(c.sortOrder) || 0, isArchived: Boolean(c.isArchived) };
  });
  const expenses = data.expenses.map(e => {
    const minor = toMinor(e.amount);
    if (typeof e.id !== "string" || minor === null || minor <= 0 || !ids.has(e.categoryID) || isNaN(Date.parse(e.date))) throw new EditError("notABackup");
    return { id: e.id, amount: fromMinor(minor), categoryID: e.categoryID, note: String(e.note ?? ""), date: isoSeconds(e.date) };
  });
  const p = data.preferences;
  const budget = p.monthlyBudget == null ? null : toMinor(p.monthlyBudget);
  return { schemaVersion: SCHEMA_VERSION, expenses, categories, preferences: {
    currencyCode: typeof p.currencyCode === "string" ? p.currencyCode : "USD",
    monthlyBudget: budget ? fromMinor(budget) : null,
    monthStartDay: Math.min(31, Math.max(1, Math.trunc(p.monthStartDay) || 1)) } };
}
