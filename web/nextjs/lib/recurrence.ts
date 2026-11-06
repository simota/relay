// Display helpers for tasks.recurrence (schema v13). Parsing / validation
// is server-side (src/lib/recurrence.ts); the UI only labels canonical rules
// and offers the common presets.

export const RECURRENCE_PRESETS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "", label: "does not repeat" },
  { value: "daily", label: "daily" },
  { value: "weekdays", label: "weekdays (Mon–Fri)" },
  { value: "weekly", label: "weekly" },
  { value: "biweekly", label: "every 2 weeks" },
  { value: "monthly", label: "monthly" },
];

export function isPresetRecurrence(rule: string | null | undefined): boolean {
  return RECURRENCE_PRESETS.some((p) => p.value === (rule ?? ""));
}

/** Short label, e.g. "weekly", "every 3 days", "Mon, Thu". */
export function describeRecurrence(rule: string): string {
  switch (rule) {
    case "biweekly":
      return "every 2 weeks";
    case "daily":
    case "weekdays":
    case "weekly":
    case "monthly":
      return rule;
  }
  const every = /^every:(\d+)([dw])$/.exec(rule);
  if (every) return `every ${every[1]} ${every[2] === "w" ? "weeks" : "days"}`;
  if (rule.startsWith("days:")) {
    return rule
      .slice(5)
      .split(",")
      .map((d) => d.charAt(0).toUpperCase() + d.slice(1))
      .join(", ");
  }
  return rule;
}
