import { severityName } from "./utils.js";

export function filterReports(
  reports,
  { query = "", status = "", severity = "", sort = "newest" } = {},
) {
  const term = query.trim().toLocaleLowerCase();
  const timestamp = (value) => Date.parse(value) || 0;
  return reports
    .filter(
      (report) =>
        (!status || report.status === status) &&
        (!severity || report.severity === Number(severity)) &&
        (!term ||
          [report.id, report.asset_name, report.description, report.resolution_note].some((value) =>
            String(value ?? "")
              .toLocaleLowerCase()
              .includes(term),
          )),
    )
    .sort((a, b) => {
      const newest = timestamp(b.created_at) - timestamp(a.created_at);
      const order =
        sort === "priority"
          ? b.severity - a.severity || newest
          : sort === "oldest"
            ? -newest
            : newest;
      return order || b.id - a.id;
    });
}

function csvCell(value) {
  let text = String(value ?? "");
  // Quoting alone does not stop spreadsheet formulas, including after whitespace.
  if (/^[\s\uFEFF]*[=+@-]/u.test(text)) text = "'" + text;
  return `"${text.replaceAll('"', '""')}"`;
}

/** Export only the supplied, authorized rows; keep tracking tokens and photos private. */
export function reportsCsv(reports) {
  const rows = [
    [
      "Report ID",
      "Asset",
      "Description",
      "Observed priority",
      "Status",
      "Created at",
      "Resolved at",
      "Resolution note",
      "Photo attached",
    ],
  ];
  for (const report of reports)
    rows.push([
      report.id,
      report.asset_name,
      report.description,
      severityName(report.severity),
      report.status,
      report.created_at,
      report.resolved_at,
      report.resolution_note,
      report.has_image ? "Yes" : "No",
    ]);
  return "\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
