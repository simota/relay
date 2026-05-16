import { SkeletonBlock, SkeletonScreen } from "@/components/skeleton";

const ROWS = [0, 1, 2, 3, 4, 5, 6, 7] as const;

export default function Loading() {
  return (
    <SkeletonScreen className="overflow-y-auto">
      <div className="max-w-[1400px] space-y-5 px-6 py-6">
        <div className="flex items-baseline justify-between gap-4">
          <div className="space-y-2">
            <SkeletonBlock className="h-6 w-32" />
            <SkeletonBlock className="h-3 w-56" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1 rounded-[var(--radius)] p-0.5">
              <SkeletonBlock className="h-7 w-12" />
              <SkeletonBlock className="h-7 w-14" />
              <SkeletonBlock className="h-7 w-14" />
              <SkeletonBlock className="h-7 w-14" />
            </div>
            <div className="flex gap-1 rounded-[var(--radius)] p-0.5">
              <SkeletonBlock className="h-7 w-10" />
              <SkeletonBlock className="h-7 w-10" />
              <SkeletonBlock className="h-7 w-10" />
            </div>
            <SkeletonBlock className="h-8 w-[240px]" />
          </div>
        </div>

        <div className="overflow-hidden rounded-[var(--radius)]">
          <SkeletonBlock className="h-9 rounded-none" />
          {ROWS.map((row) => (
            <SkeletonBlock key={row} className="h-10 rounded-none" />
          ))}
        </div>
      </div>
    </SkeletonScreen>
  );
}
