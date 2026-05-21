"use client";

// Fleet Hamlet — Cemetery (P5).
//
// Resting place for archived / long-idle residents. Top of the page is
// the Hall of Fame board (always-on, computed across the whole fleet —
// not just the dead). Below that, a tidy grid of pure-SVG headstones.

import type { SessionDetail } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useMemo } from "react";
import type { SimCardModel } from "../_lib/fleet-hamlet";
import {
  buildCemetery,
  computeHallOfFame,
  countRecentlyRested,
  formatDuration,
  formatShortDate,
  type Headstone,
} from "../_lib/fleet-hamlet-cemetery";
import { agentHueShift, hashRepoToHue } from "../_lib/fleet-hamlet-layout";
import { CandleSvg, DECOR_CSS, FogStrip } from "./fleet-hamlet-decor";

interface Props {
  sims: readonly SimCardModel[];
  detailByKey: ReadonlyMap<string, SessionDetail>;
  now: number;
  onOpenHouse: (sim: SimCardModel) => void;
}

export function FleetHamletCemetery({
  sims,
  detailByKey,
  now,
  onOpenHouse,
}: Props) {
  const stones = useMemo(
    () => buildCemetery(sims, detailByKey, now),
    [sims, detailByKey, now],
  );
  const fame = useMemo(
    () => computeHallOfFame(sims, detailByKey, now),
    [sims, detailByKey, now],
  );
  const recent = useMemo(() => countRecentlyRested(stones, now), [stones, now]);

  return (
    <div
      className="h-full overflow-y-auto relative"
      style={{
        background:
          "linear-gradient(to bottom, #1B1F38 0%, #2A2456 35%, #3A2E5C 100%)",
      }}
    >
      {/* Moon */}
      <div
        aria-hidden
        className="absolute pointer-events-none"
        style={{
          top: 24,
          right: 36,
          width: 64,
          height: 64,
          borderRadius: "50%",
          background:
            "radial-gradient(circle at 35% 35%, #FFF6D8 0%, #F5E9B6 55%, rgba(245,233,182,0) 100%)",
          opacity: 0.85,
          filter: "blur(0.5px)",
          animation: "relayHamletSunPulse 4s ease-in-out infinite",
        }}
      />
      <FogStrip width={920} top={140} />
      <FogStrip width={920} top={320} />
      <div className="max-w-[920px] mx-auto px-6 py-5 flex flex-col gap-4 relative z-[1]">
        <style>{DECOR_CSS}</style>
        <header className="flex items-baseline gap-3">
          <h2 className="text-[16px] font-mono" style={{ color: "#F5E9C5" }}>
            🪦 In Loving Memory
          </h2>
          <span className="text-[11px] font-mono" style={{ color: "rgba(245, 233, 197, 0.7)" }}>
            {stones.length} {stones.length === 1 ? "soul rests" : "souls rest"} here
            {stones.length > 0 && ` · ${recent} in the last 7 days`}
          </span>
        </header>

        {/* Hall of Fame — always rendered (we have at least the living roster) */}
        <section
          className="p-3 rounded-[var(--radius-md)] border"
          style={{
            borderColor: "rgba(255, 215, 90, 0.5)",
            background:
              "linear-gradient(135deg, rgba(255, 240, 180, 0.08), rgba(255, 200, 90, 0.04) 60%, rgba(20, 20, 40, 0.4)) ",
            boxShadow: "inset 0 0 0 1px rgba(255, 230, 150, 0.2), 0 0 18px rgba(255, 215, 90, 0.10)",
          }}
          aria-label="hall of fame"
        >
          <div className="text-[11px] font-mono uppercase tracking-wider text-[var(--color-fg-muted)] mb-2 flex items-center gap-2">
            <span aria-hidden>🏆</span>
            <span>Hall of Fame</span>
            <span className="text-[var(--color-fg-dim)] normal-case tracking-normal">
              · whole fleet, living + departed
            </span>
          </div>
          <ul className="grid gap-2 grid-cols-1 sm:grid-cols-2">
            {fame.map((entry) => (
              <li
                key={entry.id}
                className="flex items-center gap-2 px-2 py-1.5 rounded-[var(--radius-sm)] border border-[var(--color-border)]"
              >
                <span aria-hidden className="text-[14px] leading-none">
                  {entry.emoji}
                </span>
                <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--color-fg-dim)] shrink-0 w-[120px]">
                  {entry.label}
                </span>
                {entry.card ? (
                  <button
                    type="button"
                    onClick={() => entry.card && onOpenHouse(entry.card)}
                    className="text-[11px] font-mono text-[var(--color-fg)] hover:text-[var(--color-accent)] truncate text-left"
                    title={`${entry.card.sessionType}/${entry.card.repo ?? "—"}`}
                  >
                    {entry.card.sessionType[0]}/{entry.card.repo ?? "—"}
                    {entry.card.agentId && (
                      <span className="ml-1 text-[var(--color-fg-dim)]">
                        {entry.card.agentId.slice(0, 8)}
                      </span>
                    )}
                  </button>
                ) : (
                  <span className="text-[11px] font-mono text-[var(--color-fg-dim)]">
                    —
                  </span>
                )}
                <span className="ml-auto text-[11px] font-mono tabular text-[var(--color-fg-muted)] shrink-0">
                  {entry.value}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {/* Headstone grid */}
        <section aria-label="headstones">
          <div className="text-[11px] font-mono uppercase tracking-wider text-[var(--color-fg-muted)] mb-2">
            Headstones {stones.length > 0 && `(${stones.length})`}
          </div>
          {stones.length === 0 && (
            <div className="px-3 py-6 rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] text-[11px] font-mono text-[var(--color-fg-dim)] text-center">
              No one has rested here yet. Sessions idle &gt; 7 days move here
              automatically.
            </div>
          )}
          {stones.length > 0 && (
            <ul className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(220px,1fr))]">
              {stones.map((s) => (
                <li key={s.card.key}>
                  <HeadstoneCard stone={s} now={now} onOpen={() => onOpenHouse(s.card)} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Headstone card — half-arch SVG + meta block
// ---------------------------------------------------------------------------

function HeadstoneCard({
  stone,
  now,
  onOpen,
}: {
  stone: Headstone;
  now: number;
  onOpen: () => void;
}) {
  const { card } = stone;
  const roofHue = hashRepoToHue(card.repo);
  const wallHue = (roofHue + agentHueShift(card.sessionType) + 360) % 360;
  // Stable candle delay derived from session id so flickers stagger.
  const candleDelay = -(card.sessionId.charCodeAt(0) % 5) * 0.2;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "group w-full flex flex-col items-center gap-1 p-3 rounded-[var(--radius-md)] border",
        "hover:-translate-y-0.5 hover:border-[var(--color-accent)] transition-transform duration-150 ease-out",
      )}
      style={{
        borderColor: "rgba(255,255,255,0.18)",
        background: "rgba(20, 20, 40, 0.55)",
        backdropFilter: "blur(2px)",
      }}
      title={`Open archived house — ${card.sessionType}/${card.repo ?? "—"}`}
    >
      <div className="relative">
        <HeadstoneSvg roofHue={roofHue} wallHue={wallHue} />
        <span
          aria-hidden
          className="absolute"
          style={{ left: -8, bottom: 0 }}
        >
          <CandleSvg delay={candleDelay} />
        </span>
      </div>
      <div className="w-full text-center">
        <div className="text-[12px] font-mono text-[var(--color-fg)] truncate">
          {card.sessionType[0]}/{card.agentId ?? `#${card.sessionId.slice(0, 6)}`}
        </div>
        <div className="text-[10px] font-mono text-[var(--color-fg-dim)] truncate">
          {card.repo ?? "—"}
        </div>
      </div>
      <dl className="w-full grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px] font-mono">
        <dt className="text-[var(--color-fg-dim)]">Born</dt>
        <dd className="text-[var(--color-fg-muted)] text-right">
          {formatShortDate(stone.bornAt)}
        </dd>
        <dt className="text-[var(--color-fg-dim)]">Rested</dt>
        <dd className="text-[var(--color-fg-muted)] text-right">
          {formatShortDate(stone.restedAt)}
        </dd>
        <dt className="text-[var(--color-fg-dim)]">Lifetime</dt>
        <dd className="text-[var(--color-fg-muted)] text-right">
          {formatDuration(stone.lifetimeMs)}
        </dd>
        <dt className="text-[var(--color-fg-dim)]">Idle</dt>
        <dd className="text-[var(--color-fg-muted)] text-right">
          {formatDuration(now - stone.restedAt)}
        </dd>
      </dl>
      <div className="w-full mt-1 px-2 py-1 rounded-[var(--radius-sm)] border border-dashed border-[var(--color-border)] text-[10px] font-mono italic text-[var(--color-fg-muted)] text-center truncate">
        “{stone.epitaph}”
      </div>
    </button>
  );
}

function HeadstoneSvg({ roofHue, wallHue }: { roofHue: number; wallHue: number }) {
  // Half-arch headstone — rounded top + base. Tint very subtly so we can
  // still tell repos apart at a glance, but stay in cemetery greys.
  const stone = `hsl(${wallHue}, 8%, 55%)`;
  const stoneDark = `hsl(${wallHue}, 8%, 38%)`;
  const cross = `hsl(${roofHue}, 25%, 75%)`;
  return (
    <svg width={64} height={72} viewBox="0 0 64 72" aria-hidden>
      {/* base */}
      <rect x="6" y="58" width="52" height="8" rx="1.5" fill={stoneDark} />
      <rect x="10" y="56" width="44" height="6" rx="1.5" fill={stone} />
      {/* main slab — top is a half circle */}
      <path
        d="M 14 56 L 14 28 A 18 18 0 0 1 50 28 L 50 56 Z"
        fill={stone}
        stroke={stoneDark}
        strokeWidth="1"
      />
      {/* tiny RIP cross */}
      <rect x="30" y="30" width="4" height="14" fill={cross} opacity="0.85" />
      <rect x="26" y="34" width="12" height="4" fill={cross} opacity="0.85" />
      {/* grass tufts */}
      <path
        d="M 4 66 Q 8 60 12 66 M 52 66 Q 56 60 60 66"
        fill="none"
        stroke="hsl(120, 30%, 45%)"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
