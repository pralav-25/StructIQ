import test from "node:test";
import assert from "node:assert/strict";
import { filterReports, reportsCsv } from "../public/static/reports.js";

const reports = [
  {
    id: 1,
    asset_name: "Adyar Bridge",
    description: "Loose railing",
    severity: 15,
    status: "Open",
    created_at: "2026-09-01T12:00:00Z",
    resolved_at: null,
    resolution_note: null,
    has_image: false,
  },
  {
    id: 2,
    asset_name: "Mount Road",
    description: "Pothole",
    severity: 5,
    status: "Resolved",
    created_at: "2026-09-03T12:00:00Z",
    resolved_at: "2026-09-04T12:00:00Z",
    resolution_note: "Resurfaced near junction",
    has_image: true,
  },
  {
    id: 3,
    asset_name: "Adyar Bridge",
    description: "Faded markings",
    severity: 10,
    status: "Open",
    created_at: "2026-09-02T12:00:00Z",
    resolved_at: null,
    resolution_note: null,
    has_image: false,
  },
];
const ids = (rows) => rows.map((row) => row.id);

test("combines incident search, status, and manually selected priority", () => {
  assert.deepEqual(
    ids(filterReports(reports, { query: " ADYAR ", status: "Open", severity: "15" })),
    [1],
  );
  assert.deepEqual(ids(filterReports(reports, { query: "resurfaced" })), [2]);
  assert.deepEqual(ids(filterReports(reports, { query: "1" })), [1]);
  assert.deepEqual(filterReports(reports, { query: "missing" }), []);
  assert.deepEqual(filterReports(reports, { status: "Resolved", severity: "15" }), []);
});

test("orders the queue by recency, age, or priority without mutating report history", () => {
  const original = structuredClone(reports);
  assert.deepEqual(ids(filterReports(reports)), [2, 3, 1]);
  assert.deepEqual(ids(filterReports(reports, { sort: "oldest" })), [1, 3, 2]);
  assert.deepEqual(ids(filterReports(reports, { sort: "priority" })), [1, 3, 2]);
  assert.deepEqual(reports, original);
  assert.deepEqual(filterReports([]), []);
});

test("CSV follows the filtered row order and excludes tracking secrets and photo contents", () => {
  const rows = filterReports(reports, { status: "Open", sort: "priority" });
  const csv = reportsCsv(
    rows.map((row) => ({
      ...row,
      tracking_code: "private-link-token",
      image: "private-image-bytes",
    })),
  );
  assert.ok(csv.startsWith('\uFEFF"Report ID","Asset"'));
  assert.ok(csv.indexOf('"1","Adyar Bridge"') < csv.indexOf('"3","Adyar Bridge"'));
  assert.ok(!csv.includes("Mount Road"));
  assert.ok(!csv.includes("private-link-token"));
  assert.ok(!csv.includes("private-image-bytes"));
  assert.equal(reportsCsv([]).split("\r\n").length, 2);
});

test("CSV quotes commas, quotes, line breaks, and neutralizes spreadsheet formulas", () => {
  for (const value of [
    '=HYPERLINK("https://example.test")',
    "+SUM(1,2)",
    "-1+2",
    "@SUM(1,2)",
    "\t =1+2",
    "\r\n=1+2",
  ]) {
    const csv = reportsCsv([{ ...reports[0], description: value }]);
    assert.ok(csv.includes(`"'${value.replaceAll('"', '""')}"`));
  }
  const csv = reportsCsv([
    { ...reports[0], asset_name: 'Bridge, "North"', description: "Line one\nLine two" },
  ]);
  assert.ok(csv.includes('"Bridge, ""North"""'));
  assert.ok(csv.includes('"Line one\nLine two"'));
});
