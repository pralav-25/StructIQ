export function priority(score) {
  return score < 40 ? "Emergency" : score < 70 ? "High" : "Low";
}
export function color(score) {
  return score < 40 ? "#ba5550" : score < 70 ? "#ca9847" : "#3f9571";
}
export function summary(assets, reports) {
  return {
    total: assets.length,
    average: assets.length
      ? assets.reduce((sum, a) => sum + a.health_score, 0) / assets.length
      : 0,
    attention: assets.filter((a) => a.health_score < 70).length,
    open: reports.filter((r) => r.status === "Open").length,
  };
}
export function filterAssets(assets, query = "", type = "", risk = "") {
  const term = query.trim().toLocaleLowerCase();
  return assets.filter(
    (a) =>
      (!term || `${a.name} ${a.id}`.toLocaleLowerCase().includes(term)) &&
      (!type || a.asset_type === type) &&
      (!risk || priority(a.health_score) === risk),
  );
}
export function date(value, time = false) {
  if (!value) return "Not recorded";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return "Not recorded";
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    ...(time ? { hour: "2-digit", minute: "2-digit" } : { year: "numeric" }),
  }).format(parsed);
}
export function initials(name) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0])
    .join("")
    .toUpperCase();
}
export function severityName(value) {
  return { 5: "Low", 10: "Medium", 15: "High" }[value] || "Unrated";
}
