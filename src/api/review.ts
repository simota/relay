import { Hono } from "hono";
import { RelayDB } from "../db/client.js";

const WEEK_RE = /^(\d{4})-(\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;

export function createReviewApi() {
  const app = new Hono();

  app.get("/", (c) => {
    const week = c.req.query("week") ?? currentIsoWeek();
    const range = parseIsoWeek(week);
    if (!range) return c.json({ error: "week must be YYYY-WW" }, 400);

    const db = new RelayDB();
    const review = db.reviewTasks(range);
    db.close();
    return c.json(review);
  });

  return app;
}

function parseIsoWeek(week: string): {
  weekStart: string;
  weekEnd: string;
  previousWeekStart: string;
  staleBefore: string;
} | null {
  const match = WEEK_RE.exec(week);
  if (!match) return null;
  const year = Number(match[1]);
  const weekNo = Number(match[2]);
  if (!Number.isInteger(year) || !Number.isInteger(weekNo) || weekNo < 1 || weekNo > 53) {
    return null;
  }

  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const weekOneMonday = new Date(jan4.getTime() - (jan4Day - 1) * DAY_MS);
  const start = new Date(weekOneMonday.getTime() + (weekNo - 1) * 7 * DAY_MS);
  if (isoWeekYear(start) !== year && weekNo > 1) return null;

  const end = new Date(start.getTime() + 7 * DAY_MS);
  const previous = new Date(start.getTime() - 7 * DAY_MS);
  const staleBefore = new Date(start.getTime() - 7 * DAY_MS);

  return {
    weekStart: start.toISOString(),
    weekEnd: end.toISOString(),
    previousWeekStart: previous.toISOString(),
    staleBefore: staleBefore.toISOString(),
  };
}

function currentIsoWeek(): string {
  const now = new Date();
  const year = isoWeekYear(now);
  const start = isoWeekStart(now);
  const yearStart = isoWeekStart(new Date(Date.UTC(year, 0, 4)));
  const week = Math.floor((start.getTime() - yearStart.getTime()) / (7 * DAY_MS)) + 1;
  return `${year}-${String(week).padStart(2, "0")}`;
}

function isoWeekYear(date: Date): number {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  return d.getUTCFullYear();
}

function isoWeekStart(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - day + 1);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}
