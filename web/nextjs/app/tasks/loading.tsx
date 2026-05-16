import { SkeletonBlock, SkeletonScreen } from "@/components/skeleton";

const SOURCE_PILLS = [0, 1, 2, 3, 4, 5, 6, 7] as const;
const ROWS = [0, 1, 2, 3, 4, 5, 6, 7] as const;

export default function Loading() {
  return (
    <SkeletonScreen className="flex flex-col">
      <div className="flex items-baseline justify-between gap-4 px-6 pb-3 pt-5">
        <div className="space-y-2">
          <SkeletonBlock className="h-6 w-32" />
          <SkeletonBlock className="h-3 w-48" />
        </div>
        <div className="flex flex-wrap gap-1 rounded-[var(--radius)] p-0.5">
          {SOURCE_PILLS.map((pill) => (
            <SkeletonBlock key={pill} className="h-6 w-14" />
          ))}
        </div>
      </div>

      <div className="flex h-11 items-center gap-2 px-6 py-2">
        <SkeletonBlock className="h-8 flex-1 max-w-[420px]" />
        <SkeletonBlock className="h-8 w-24" />
      </div>

      <div className="grid flex-1 grid-cols-[minmax(0,1fr)_minmax(0,520px)] overflow-hidden border-t border-[var(--color-border)]/0">
        <div className="space-y-px overflow-hidden border-r border-[var(--color-border)] px-3 py-2">
          {ROWS.map((row) => (
            <SkeletonBlock key={row} className="h-12 rounded-[var(--radius)]" />
          ))}
        </div>
        <div className="space-y-3 px-5 py-5">
          <SkeletonBlock className="h-5 w-3/4" />
          <SkeletonBlock className="h-3 w-1/2" />
          <SkeletonBlock className="h-32 w-full" />
          <SkeletonBlock className="h-3 w-2/3" />
        </div>
      </div>
    </SkeletonScreen>
  );
}
