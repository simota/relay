"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ReviewPager } from "@/components/review-pager";

export default function ReviewPage() {
  const searchParams = useSearchParams();
  const weekParam = searchParams?.get("week") ?? null;
  // Compute initial week on the client to avoid build-time vs runtime drift
  // under static export (output: export).
  const [initialWeek, setInitialWeek] = useState<string | null>(null);
  useEffect(() => {
    setInitialWeek(weekParam ?? currentIsoWeek());
  }, [weekParam]);

  if (!initialWeek) {
    return <div className="px-6 py-6 text-[13px] text-[var(--color-fg-muted)]">Loading…</div>;
  }
  return <ReviewPager initialWeek={initialWeek} />;
}

function currentIsoWeek(): string {
  const now = new Date();
  const start = isoWeekStart(now);
  const year = isoWeekYear(now);
  const yearStart = isoWeekStart(new Date(Date.UTC(year, 0, 4)));
  const week = Math.floor((start.getTime() - yearStart.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1;
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
