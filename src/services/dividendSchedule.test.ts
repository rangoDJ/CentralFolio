import { test } from "node:test";
import assert from "node:assert/strict";
import {
  advanceDate,
  daysBetween,
  payLagDays,
  projectDistributions,
  utcDay,
} from "./dividendSchedule.js";

const day = (iso: string) => utcDay(iso);
const iso = (d: Date) => d.toISOString().slice(0, 10);

// ── advanceDate ─────────────────────────────────────────────────────────────

test("a month-end monthly payer stays on month-end through February", () => {
  // The bug: setUTCMonth() on Jan 31 lands on Mar 2/3, and every later date
  // in the series keeps the shift.
  let d = day("2026-01-31");
  const got: string[] = [];
  for (let i = 0; i < 4; i++) {
    d = advanceDate(d, 12, 31);
    got.push(iso(d));
  }
  assert.deepEqual(got, ["2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31"]);
});

test("the anchor day survives a clamped month rather than sticking", () => {
  // Without the anchor, February's clamp to the 28th would hold for good.
  const feb = advanceDate(day("2026-01-30"), 12, 30);
  assert.equal(iso(feb), "2026-02-28");
  assert.equal(iso(advanceDate(feb, 12, 30)), "2026-03-30");
});

test("a leap February clamps to the 29th", () => {
  assert.equal(iso(advanceDate(day("2028-01-31"), 12, 31)), "2028-02-29");
});

test("quarterly steps three months and crosses the year boundary", () => {
  assert.equal(iso(advanceDate(day("2026-11-13"), 4, 13)), "2027-02-13");
});

test("weekly steps exactly seven days", () => {
  assert.equal(iso(advanceDate(day("2026-09-08"), 52)), "2026-09-15");
});

test("bi-weekly steps exactly fourteen days", () => {
  assert.equal(iso(advanceDate(day("2026-09-08"), 26)), "2026-09-22");
});

test("semi-monthly alternates mid-month and month-end", () => {
  // A flat 15-day step gives 9/30, 10/15, 10/30, 11/14 — off the real schedule
  // by the second month.
  let d = day("2026-09-15");
  const got: string[] = [];
  for (let i = 0; i < 4; i++) {
    d = advanceDate(d, 24);
    got.push(iso(d));
  }
  assert.deepEqual(got, ["2026-09-30", "2026-10-15", "2026-10-31", "2026-11-15"]);
});

// ── pay lag ─────────────────────────────────────────────────────────────────

test("the lag is the gap between the ex and pay dates Snowball reported", () => {
  assert.equal(payLagDays("2026-09-30", "2026-10-08"), 8);   // HDIV.TO
  assert.equal(payLagDays("2026-11-13", "2026-12-01"), 18);  // ENB.TO
});

test("no pay date means no lag, not a guess", () => {
  assert.equal(payLagDays("2026-09-30", null), 0);
  assert.equal(payLagDays(null, "2026-10-08"), 0);
});

test("a backwards or absurd pair is clamped, never applied raw", () => {
  assert.equal(payLagDays("2026-10-08", "2026-09-30"), 0);
  assert.equal(payLagDays("2026-01-01", "2027-01-01"), 90);
});

test("daysBetween is signed and counts whole days", () => {
  assert.equal(daysBetween("2026-09-08", "2026-09-15"), 7);
  assert.equal(daysBetween("2026-09-15", "2026-09-08"), -7);
});

// ── projectDistributions ────────────────────────────────────────────────────

test("distributions are placed on the pay date, not the ex-date", () => {
  // HDIV.TO as Snowball reports it: ex 2026-09-30, cash 2026-10-08.
  const [first] = projectDistributions("2026-09-30", "2026-10-08", 12, new Date("2026-09-08T12:00:00Z"));
  assert.equal(first.exDate, "2026-09-30");
  assert.equal(first.payDate.slice(0, 10), "2026-10-08");
});

test("a payout that has gone ex but not yet paid is still upcoming", () => {
  // Ex was yesterday, cash lands in a week. Catching up on the ex-date drops
  // this one and shows next month's instead.
  const [first] = projectDistributions("2026-09-30", "2026-10-08", 12, new Date("2026-10-01T12:00:00Z"));
  assert.equal(first.payDate.slice(0, 10), "2026-10-08");
});

test("a payout dated today survives the whole day", () => {
  // GDXW: ex Sep 8, pays Sep 9. Comparing against the instant dropped it at
  // 00:00:01Z — 8pm the evening before, in Eastern time.
  for (const t of ["2026-09-09T00:00:01Z", "2026-09-09T12:00:00Z", "2026-09-09T23:59:59Z"]) {
    const [first] = projectDistributions("2026-09-08", "2026-09-09", 52, new Date(t));
    assert.equal(first.payDate.slice(0, 10), "2026-09-09", `dropped at ${t}`);
  }
});

test("yesterday's payout is still shown, covering timezone skew and broker lag", () => {
  const [first] = projectDistributions("2026-09-08", "2026-09-09", 52, new Date("2026-09-10T12:00:00Z"));
  assert.equal(first.payDate.slice(0, 10), "2026-09-09");
});

test("a payout two days old has rolled forward", () => {
  const [first] = projectDistributions("2026-09-08", "2026-09-09", 52, new Date("2026-09-11T12:00:00Z"));
  assert.equal(first.payDate.slice(0, 10), "2026-09-16");
});

test("a distribution whose cash has already landed is skipped", () => {
  // Sep 30 is month-end, so the next ex is Oct 31 — not Oct 30.
  const [first] = projectDistributions("2026-09-30", "2026-10-08", 12, new Date("2026-10-10T12:00:00Z"));
  assert.equal(first.exDate, "2026-10-31");
  assert.equal(first.payDate.slice(0, 10), "2026-11-08");
});

test("a month-end ex-date keeps a month-end schedule, not a 30th-of-the-month one", () => {
  const out = projectDistributions("2026-09-30", null, 12, new Date("2026-09-08T12:00:00Z"));
  assert.deepEqual(out.slice(0, 5).map(d => d.exDate),
    ["2026-09-30", "2026-10-31", "2026-11-30", "2026-12-31", "2027-01-31"]);
});

test("a mid-month ex-date is not treated as month-end", () => {
  const out = projectDistributions("2026-09-15", null, 12, new Date("2026-09-08T12:00:00Z"));
  assert.deepEqual(out.slice(0, 3).map(d => d.exDate),
    ["2026-09-15", "2026-10-15", "2026-11-15"]);
});

test("one year of distributions is produced, in order", () => {
  const out = projectDistributions("2026-09-30", "2026-10-08", 12, new Date("2026-09-08T12:00:00Z"));
  assert.equal(out.length, 12);
  const pays = out.map(d => d.payDate.slice(0, 10));
  assert.deepEqual([...pays].sort(), pays, "dates must already be ascending");
  assert.equal(pays[0], "2026-10-08");
  // Month-end anchoring holds across February: ex 2027-02-28 + 8 days.
  assert.equal(pays[5], "2027-03-08");
  assert.equal(out[5].exDate, "2027-02-28");
});

test("every pay date sits the same lag after its own ex date", () => {
  const out = projectDistributions("2026-11-13", "2026-12-01", 4, new Date("2026-09-08T12:00:00Z"));
  for (const d of out) {
    assert.equal(daysBetween(d.exDate, d.payDate.slice(0, 10)), 18);
  }
});

test("with no pay date the ex date is used, matching the old behaviour", () => {
  const [first] = projectDistributions("2026-09-30", null, 12, new Date("2026-09-08T12:00:00Z"));
  assert.equal(first.payDate.slice(0, 10), "2026-09-30");
});

test("a stale ex-date years in the past still lands in the future", () => {
  const now = new Date("2026-09-08T12:00:00Z");
  const [first] = projectDistributions("2019-01-15", "2019-01-31", 12, now);
  assert.ok(new Date(first.payDate) >= now, `expected a future date, got ${first.payDate}`);
});

test("garbage in gives an empty schedule, not an infinite loop", () => {
  assert.deepEqual(projectDistributions("", null, 12, new Date()), []);
  assert.deepEqual(projectDistributions("2026-09-30", null, 0, new Date()), []);
});
