"use client";

import { Suspense } from "react";
import { c } from "@/lib/copy";
import { SessionsBoard } from "./_components/sessions-board";

// ---------------------------------------------------------------------------
// Page root
// ---------------------------------------------------------------------------
export default function SessionDetailPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-[13px] text-[var(--color-fg-dim)]">{c("common.loading")}</div>
      }
    >
      <SessionsBoard />
    </Suspense>
  );
}
