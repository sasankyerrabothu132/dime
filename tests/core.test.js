import test from "node:test";
import assert from "node:assert/strict";
import * as core from "../core.js";

const at = (y, m, d, h = 12, min = 0) => new Date(y, m - 1, d, h, min);
const seeded = () => {
  let ledger = core.newLedger();
  const [food, transport] = core.activeCategories(ledger);
  return { ledger, food, transport };
};

test("money is exact and round-trips", () => {
  assert.equal(core.toMinor("0.1") + core.toMinor("0.2"), core.toMinor("0.3"));
  assert.equal(core.fromMinor(core.toMinor("12.50")), "12.5");
  assert.equal(core.fromMinor(core.toMinor("7")), "7");
  for (const bad of ["", "abc", "-1", "1.2345", "1e3", " "]) assert.equal(core.toMinor(bad), null, bad);
  assert.equal(core.fractionDigits("JPY"), 0);
  assert.equal(core.fractionDigits("USD"), 2);
});

test("loose amounts from spreadsheets", () => {
  const minor = t => core.parseLooseAmount(t)?.minor;
  assert.equal(minor("$1,234.50"), 1234500);
  assert.equal(minor("1.234,50 €"), 1234500);
  assert.equal(minor("12,5"), 12500);
  assert.equal(minor("1,234"), 1234000);
  assert.equal(minor("₹ 42"), 42000);
  assert.equal(core.parseLooseAmount("-4.20").negative, true);
  assert.equal(core.parseLooseAmount("free"), null);
});

test("number pad", () => {
  let t = "";
  for (const d of [1, 2]) t = core.entryAppend(t, d, 2);
  t = core.entrySeparator(t, 2);
  assert.equal(core.entryValue(t), 12000);             // "12." is still twelve
  for (const d of [5, 0, 9]) t = core.entryAppend(t, d, 2);
  assert.equal(t, "12.50");
  assert.equal(core.entryAppend("0", 5, 2), "5");
  assert.equal(core.entrySeparator("", 2), "0.");
  assert.equal(core.entrySeparator("3", 0), "3");      // yen has no decimals
  assert.equal(core.entryValue("0."), null);
  assert.equal(core.entryBackspace("0."), "");
  assert.equal(core.entryAppend("123456789", 1, 2), "123456789");
});

test("expenses: add, reject, edit, delete, and the old ledger is untouched", () => {
  const { ledger, food, transport } = seeded();
  const { ledger: one, expense } = core.addExpense(ledger, { amount: "4.50", categoryID: food.id, note: "  tea \n", date: at(2026, 11, 16) });
  assert.equal(ledger.expenses.length, 0);
  assert.deepEqual([expense.amount, expense.note], ["4.5", "tea"]);
  assert.match(expense.date, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  assert.throws(() => core.addExpense(one, { amount: "0", categoryID: food.id }), { code: "amountNotPositive" });
  assert.throws(() => core.addExpense(one, { amount: "1", categoryID: "nope" }), { code: "unknownCategory" });
  const two = core.updateExpense(one, { ...expense, amount: "6", categoryID: transport.id });
  assert.deepEqual([two.expenses[0].amount, two.expenses[0].categoryID], ["6", transport.id]);
  assert.throws(() => core.updateExpense(one, { ...expense, id: "missing" }), { code: "unknownExpense" });
  assert.equal(core.deleteExpense(two, expense.id).expenses.length, 0);
});

test("categories: unique names, archive when used, keep one, reorder", () => {
  const { ledger, food, transport } = seeded();
  assert.throws(() => core.addCategory(ledger, { name: " food ", emoji: "x", colorHex: "#000000" }), { code: "duplicateName" });
  assert.throws(() => core.addCategory(ledger, { name: "  ", emoji: "x", colorHex: "#000000" }), { code: "emptyName" });
  let next = core.addExpense(ledger, { amount: "5", categoryID: food.id }).ledger;
  next = core.removeCategory(next, food.id);
  next = core.removeCategory(next, transport.id);
  assert.equal(core.categoryById(next, food.id).isArchived, true);
  assert.equal(core.categoryById(next, transport.id), null);
  assert.ok(core.addCategory(next, { name: "Food", emoji: "x", colorHex: "#000000" }));   // the name is free again
  let last = core.newLedger();
  for (const c of core.activeCategories(last).slice(1)) last = core.removeCategory(last, c.id);
  assert.throws(() => core.removeCategory(last, core.activeCategories(last)[0].id), { code: "lastCategory" });
  const moved = core.moveCategory(ledger, transport.id, -1);
  assert.equal(core.activeCategories(moved)[0].id, transport.id);
  assert.equal(core.activeCategories(core.moveCategory(ledger, food.id, -1))[0].id, food.id);   // already first
});

test("budget month: default, payday, short months, year edge, no gaps", () => {
  const span = (date, day) => { const s = core.budgetMonth(date, day); return [new Date(s.start), new Date(s.end)]; };
  assert.deepEqual(span(at(2026, 11, 16), 1), [at(2026, 11, 1, 0), at(2026, 12, 1, 0)]);
  assert.deepEqual(span(at(2026, 11, 16), 25), [at(2026, 10, 25, 0), at(2026, 11, 25, 0)]);
  assert.deepEqual(span(at(2026, 11, 25, 0), 25), [at(2026, 11, 25, 0), at(2026, 12, 25, 0)]);
  assert.deepEqual(span(at(2027, 2, 10), 31), [at(2027, 1, 31, 0), at(2027, 2, 28, 0)]);
  assert.deepEqual(span(at(2027, 2, 28), 31), [at(2027, 2, 28, 0), at(2027, 3, 31, 0)]);
  assert.deepEqual(span(at(2027, 1, 3), 15)[0], at(2026, 12, 15, 0));
  for (const day of [1, 15, 28, 29, 30, 31]) {
    let previous = core.budgetMonth(at(2026, 1, 1), day);
    for (let i = 1; i < 800; i++) {
      const date = at(2026, 1, 1 + i);
      const current = core.budgetMonth(date, day);
      assert.ok(current.start <= date && date < current.end);
      assert.ok(current.start === previous.start || current.start === previous.end, `gap at day ${i}, start ${day}`);
      previous = current;
    }
  }
});

test("other ranges", () => {
  const wed = at(2026, 11, 18);
  assert.equal(core.intervalFor("all", wed), null);
  assert.equal(core.intervalFor("today", wed).start, at(2026, 11, 18, 0).getTime());
  assert.equal(core.intervalFor("week", wed, 1, 1).start, at(2026, 11, 16, 0).getTime());   // Monday start
  assert.equal(core.intervalFor("week", wed, 1, 0).start, at(2026, 11, 15, 0).getTime());   // Sunday start
  assert.equal(core.intervalFor("year", wed).end, at(2027, 1, 1, 0).getTime());
});

test("summaries and budget status", () => {
  let { ledger, food, transport } = seeded();
  const add = (amount, category, date) => { ledger = core.addExpense(ledger, { amount, categoryID: category.id, date }).ledger; };
  add("0.10", food, at(2026, 11, 16, 9)); add("0.20", food, at(2026, 11, 16, 18)); add("0.90", transport, at(2026, 11, 15));
  assert.equal(core.total(ledger.expenses), 1200);
  const rows = core.byCategory(ledger, ledger.expenses);
  assert.deepEqual(rows.map(r => r.category.id), [transport.id, food.id]);
  assert.equal(rows[0].share, 0.75);
  const days = core.byDay(ledger.expenses);
  assert.deepEqual([days.length, days[0].total, days[0].day], [2, 300, at(2026, 11, 16, 0).getTime()]);
  assert.equal(new Date(days[0].expenses[0].date).getHours(), 18);
  assert.equal(core.budgetStatus(ledger, at(2026, 11, 16)), null);

  ledger = core.setPreferences(core.newLedger(), { monthlyBudget: "500", monthStartDay: 25 });
  const cat = core.activeCategories(ledger)[0];
  add("100", cat, at(2026, 10, 24)); add("120", cat, at(2026, 10, 26));
  assert.deepEqual(core.budgetStatus(ledger, at(2026, 11, 16)), { budget: 500000, spent: 120000, remaining: 380000, isOver: false, fractionUsed: 0.24 });
  add("400", cat, at(2026, 11, 1));
  const over = core.budgetStatus(ledger, at(2026, 11, 16));
  assert.deepEqual([over.isOver, over.remaining, over.fractionUsed], [true, -20000, 1]);
});

test("csv export escapes and defuses formulas", () => {
  let { ledger, food } = seeded();
  ledger = core.addExpense(ledger, { amount: "7.2", categoryID: food.id, note: 'tea, "large"', date: at(2026, 11, 16, 14) }).ledger;
  ledger = core.addExpense(ledger, { amount: "3", categoryID: food.id, note: '=HYPERLINK("x")', date: at(2026, 11, 15, 8, 5) }).ledger;
  const lines = core.toCSV(ledger).split("\r\n");
  assert.equal(lines[0], "date,time,category,note,amount,currency");
  assert.equal(lines[1], `2026-11-15,08:05,Food,"'=HYPERLINK(""x"")",3,USD`);
  assert.equal(lines[2], `2026-11-16,14:00,Food,"tea, ""large""",7.2,USD`);
  assert.equal(core.csvEscape("-5"), "-5");
});

test("csv parser handles quotes, newlines in cells, semicolons and a BOM", () => {
  assert.deepEqual(core.parseCSV('\uFEFFa,b\r\n"x, ""y""","line\nbreak"\r\n\r\n'), [["a", "b"], ['x, "y"', "line\nbreak"]]);
  assert.deepEqual(core.parseCSV("a;b\n1;2"), [["a", "b"], ["1", "2"]]);
});

test("loose dates", () => {
  const same = (text, time, expected, dayFirst) => assert.equal(core.parseLooseDate(text, time, dayFirst)?.getTime(), expected.getTime(), text);
  same("2026-11-16", "14:05", at(2026, 11, 16, 14, 5));
  same("2026-11-16", "", at(2026, 11, 16, 12));
  same("2026-11-16 9:30 PM", "", at(2026, 11, 16, 21, 30));
  same("11/16/2026", "", at(2026, 11, 16));
  same("16/11/2026", "", at(2026, 11, 16));
  same("03/04/2026", "", at(2026, 3, 4));
  same("03/04/2026", "", at(2026, 4, 3), true);
  same("16.11.26", "08:00", at(2026, 11, 16, 8));
  assert.equal(core.parseLooseDate("2026-11-16T14:05:00Z").toISOString(), "2026-11-16T14:05:00.000Z");
  assert.equal(core.parseLooseDate("31/02/2026"), null);
  assert.equal(core.parseLooseDate("soon"), null);
  assert.ok(core.parseLooseDate("Nov 16, 2026"));
});

test("import: our own export round-trips, repeats are skipped, bad rows are reported", () => {
  let { ledger, food, transport } = seeded();
  ledger = core.addExpense(ledger, { amount: "7.2", categoryID: food.id, note: 'tea, "large"', date: at(2026, 11, 16, 14) }).ledger;
  ledger = core.addExpense(ledger, { amount: "25", categoryID: transport.id, note: "", date: at(2026, 11, 15, 8, 5) }).ledger;
  const csv = core.toCSV(ledger);

  const fresh = core.planImport(core.newLedger(), csv);
  assert.deepEqual([fresh.added, fresh.skipped.length, fresh.newCategories, fresh.problem], [2, 0, [], null]);
  assert.deepEqual(fresh.ledger.expenses.map(e => [e.amount, e.note, e.date]).sort(), ledger.expenses.map(e => [e.amount, e.note, e.date]).sort());

  const again = core.planImport(ledger, csv);
  assert.deepEqual([again.added, again.skipped.map(s => s.reason)], [0, ["already in the app", "already in the app"]]);
  assert.equal(again.ledger.expenses.length, 2);
});

test("import: another app's file with different headings, emoji categories and junk rows", () => {
  const other = ["Date,Category,Description,Price",
    "11/14/2026,🍔 Food,Nachos,$2.00",
    '11/15/2026,Pets,"Vet, annual","$1,250.00"',
    "11/15/2026,Food,Refund,-3.00",
    "someday,Food,Mystery,4",
    "11/16/2026,,No category,9"].join("\n");
  const base = core.newLedger();
  const plan = core.planImport(base, other);
  assert.equal(plan.added, 3);
  assert.deepEqual(plan.newCategories, ["Pets"]);
  assert.deepEqual(plan.skipped.map(s => s.line), [4, 5]);
  assert.equal(base.expenses.length, 0);                       // planning changes nothing
  const byNote = Object.fromEntries(plan.ledger.expenses.map(e => [e.note, e]));
  assert.equal(byNote["Nachos"].categoryID, core.categoryByName(base, "Food").id);   // emoji prefix ignored
  assert.equal(byNote["Vet, annual"].amount, "1250");
  assert.equal(core.categoryById(plan.ledger, byNote["No category"].categoryID).name, "Other");
  assert.equal(plan.skipped[0].reason, "negative amount (a refund or income)");
  const allMinus = core.planImport(base, "date,amount\n2026-11-01,-5\n2026-11-02,-7.5");   // an app that writes spending as negative
  assert.deepEqual([allMinus.added, core.total(allMinus.ledger.expenses)], [2, 12500]);
  assert.match(core.planImport(base, "a,b\n1,2").problem, /amount column/);
  assert.match(core.planImport(base, "amount\n5").problem, /date column/);
  assert.match(core.planImport(base, "date,amount").problem, /no rows/);
});

test("backup round-trips and rejects junk", () => {
  let { ledger, food } = seeded();
  ledger = core.setPreferences(ledger, { currencyCode: "EUR", monthlyBudget: "1234.56", monthStartDay: 28 });
  ledger = core.addExpense(ledger, { amount: "0.1", categoryID: food.id, date: at(2026, 11, 16) }).ledger;
  assert.deepEqual(core.decodeBackup(core.encodeBackup(ledger)), ledger);
  assert.throws(() => core.decodeBackup("hello"), { code: "notABackup" });
  assert.throws(() => core.decodeBackup(JSON.stringify({ ...ledger, schemaVersion: 99 })), { code: "newerVersion" });
  assert.throws(() => core.decodeBackup(JSON.stringify({ ...ledger, categories: [] })), { code: "notABackup" });
  const orphan = structuredClone(ledger); orphan.expenses[0].categoryID = "gone";
  assert.throws(() => core.decodeBackup(JSON.stringify(orphan)), { code: "notABackup" });
  // a file written by the native app: sorted keys, extra precision in budget
  const native = '{"categories":[{"colorHex":"#F2994A","emoji":"🍜","id":"A","isArchived":false,"name":"Food","sortOrder":0}],"expenses":[{"amount":"4.5","categoryID":"A","date":"2026-11-16T18:00:00Z","id":"E","note":"x"}],"preferences":{"currencyCode":"USD","monthlyBudget":null,"monthStartDay":1},"schemaVersion":1}';
  assert.equal(core.decodeBackup(native).expenses[0].amount, "4.5");
});

test("top places group notes without caring about case and skip empty notes", () => {
  const e = (note, amount) => ({ id: note + amount, amount, categoryID: "c", note, date: "2026-11-12T10:00:00Z" });
  const places = core.topPlaces([e("Uber", "17"), e("uber ", "65"), e("Rent", "823.23"), e("", "5"), e("Lyft", "14.95")]);
  assert.deepEqual(places.map(p => [p.label, p.count, p.total]), [["Rent", 1, 823230], ["Uber", 2, 82000], ["Lyft", 1, 14950]]);
});

test("pace counts a dominant expense once and projects the rest at the daily rate", () => {
  const e = (amount, day) => ({ id: amount, amount, categoryID: "c", note: "", date: new Date(2026, 10, day, 12).toISOString() });
  const span = { start: new Date(2026, 10, 1).getTime(), end: new Date(2026, 11, 1).getTime() };
  const now = new Date(2026, 10, 10, 9).getTime();
  const p = core.pace([e("800", 2), e("60", 3), e("40", 9)], span, now);
  assert.equal(p.oneOff.amount, "800");
  assert.equal(p.everyday, 100000);
  assert.equal(p.daysSoFar, 10); assert.equal(p.daysTotal, 30); assert.equal(p.daysLeft, 20);
  assert.equal(p.perDay, 10000);
  assert.equal(p.projected, 900000 + 200000);
  // nothing dominant: no one-off, and a finished period has no projection
  const flat = core.pace([e("50", 2), e("60", 3), e("40", 9)], span, new Date(2026, 11, 5).getTime());
  assert.equal(flat.oneOff, null); assert.equal(flat.projected, null); assert.equal(flat.daysSoFar, 30);
});
