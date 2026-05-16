"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertCircle, LockKeyhole, RefreshCw, WifiOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type PageStateVariant = "empty" | "locked" | "offline" | "unauthorized";

interface PageStateProps {
  variant: PageStateVariant;
  title?: string;
  hint?: string;
  action?: () => void | Promise<unknown>;
}

const LOCKED_DELAYS_MS = [1_000, 2_000, 4_000] as const;

export function PageState({ variant, title, hint, action }: PageStateProps) {
  const [attempt, setAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    setAttempt(0);
    setRetrying(false);
  }, [variant]);

  useEffect(() => {
    if (variant !== "locked" || !action || attempt >= LOCKED_DELAYS_MS.length) return;

    const timeout = window.setTimeout(() => {
      setRetrying(true);
      void Promise.resolve(action()).finally(() => {
        setRetrying(false);
        setAttempt((current) => current + 1);
      });
    }, LOCKED_DELAYS_MS[attempt]);

    return () => window.clearTimeout(timeout);
  }, [action, attempt, variant]);

  useEffect(() => {
    if (variant !== "offline" || !action) return;

    const handleOnline = () => {
      void Promise.resolve(action());
    };
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [action, variant]);

  const content = useMemo(() => pageStateContent(variant, title, hint), [hint, title, variant]);
  const Icon = content.icon;
  const exhausted = variant === "locked" && attempt >= LOCKED_DELAYS_MS.length;

  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-elev)] px-5 py-10 text-center">
      <div className="mx-auto mb-3 flex h-9 w-9 items-center justify-center rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-fg-muted)]">
        <Icon className={cn("h-4 w-4", retrying && "animate-spin")} />
      </div>
      <h2 className="text-[14px] font-medium text-[var(--color-fg)]">{content.title}</h2>
      <p className="mx-auto mt-1 max-w-md text-[12px] text-[var(--color-fg-muted)]">{content.hint}</p>

      {variant === "empty" && (
        <div className="mt-4 flex flex-wrap justify-center gap-2 text-[12px]">
          <Link className="text-[var(--color-cool)] hover:text-[var(--color-fg)]" href="/sync">
            Sync sources
          </Link>
          <span className="text-[var(--color-fg-dim)]">/</span>
          <Link className="text-[var(--color-cool)] hover:text-[var(--color-fg)]" href="/">
            View tasks
          </Link>
        </div>
      )}

      {variant === "unauthorized" && (
        <div className="mt-4">
          <Link className="text-[12px] text-[var(--color-cool)] hover:text-[var(--color-fg)]" href="/sync">
            Reconnect in Sync
          </Link>
        </div>
      )}

      {action && variant !== "empty" && variant !== "unauthorized" && (
        <div className="mt-4">
          <Button size="sm" onClick={() => { void action(); }} disabled={variant === "locked" && !exhausted}>
            <RefreshCw className={cn("h-3 w-3", retrying && "animate-spin")} />
            {variant === "locked" && !exhausted ? `Retrying ${attempt + 1}/3` : "Retry"}
          </Button>
        </div>
      )}
    </div>
  );
}

export function useOnlineStatus() {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  return online;
}

export function stateVariantFromError(error: unknown, online: boolean): Exclude<PageStateVariant, "empty"> | null {
  if (!online) return "offline";
  if (!(error instanceof Error)) return null;

  const message = error.message.toLowerCase();
  if (message.includes("→ 401") || message.includes("→ 403")) return "unauthorized";
  if (message.includes("db locked") || message.includes("database is locked") || message.includes("sqlite_busy") || message.includes("→ 423")) {
    return "locked";
  }
  return null;
}

function pageStateContent(variant: PageStateVariant, title?: string, hint?: string) {
  if (variant === "locked") {
    return {
      icon: RefreshCw,
      title: title ?? "DB is busy — retrying...",
      hint: hint ?? "The local database is locked by another operation. Automatic retries run after 1s, 2s, and 4s.",
    };
  }
  if (variant === "offline") {
    return {
      icon: WifiOff,
      title: title ?? "Offline",
      hint: hint ?? "Network access is unavailable. This page will retry automatically when the browser comes back online.",
    };
  }
  if (variant === "unauthorized") {
    return {
      icon: LockKeyhole,
      title: title ?? "Authorization required",
      hint: hint ?? "Reconnect the source from the sync console, then return here.",
    };
  }
  return {
    icon: AlertCircle,
    title: title ?? "Nothing to show yet",
    hint: hint ?? "No matching records are available for this view.",
  };
}
