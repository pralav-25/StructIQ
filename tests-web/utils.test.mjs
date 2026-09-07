import test from "node:test";
import assert from "node:assert/strict";
import {
  priority,
  summary,
  filterAssets,
  date,
} from "../public/static/utils.js";
const assets = [
  { id: 1, name: "Adyar Bridge", asset_type: "Bridge", health_score: 70 },
  { id: 2, name: "Mount Road", asset_type: "Road", health_score: 39.9 },
  { id: 3, name: "East Coast Road", asset_type: "Road", health_score: 40 },
];
test("dashboard bands match documented boundary values", () => {
  assert.equal(priority(39.9), "Emergency");
  assert.equal(priority(40), "High");
  assert.equal(priority(69.9), "High");
  assert.equal(priority(70), "Low");
});
test("summaries use all assets and only open reports", () => {
  assert.deepEqual(summary([], []), {
    total: 0,
    average: 0,
    attention: 0,
    open: 0,
  });
  const s = summary(assets, [{ status: "Open" }, { status: "Resolved" }]);
  assert.equal(s.total, 3);
  assert.equal(s.attention, 2);
  assert.equal(s.open, 1);
  assert.ok(Math.abs(s.average - 49.96666666) < 1e-6);
});
test("combined search, asset type, and priority filters select matching rows", () => {
  assert.deepEqual(
    filterAssets(assets, " ROAD ", "Road", "High").map((a) => a.id),
    [3],
  );
  assert.deepEqual(
    filterAssets(assets, "1").map((a) => a.id),
    [1],
  );
  assert.equal(filterAssets(assets, "missing").length, 0);
});
test("dates do not manufacture missing maintenance records", () => {
  assert.equal(date(null), "Not recorded");
  assert.equal(date("invalid"), "Not recorded");
});
