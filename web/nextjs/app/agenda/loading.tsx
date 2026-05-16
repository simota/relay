import { SkeletonBlock, SkeletonScreen } from "@/components/skeleton";

const DAYS = [0, 1, 2, 3, 4, 5] as const;
const DAY_ROWS = [0, 1, 2] as const;

export default function Loading() {
  return (
    <SkeletonScreen className="overflow-y-auto">
      <div className="max-w-[1400px] space-y-5 px-6 py-6">
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <div className="space-y-2">
            <SkeletonBlock className="h-6 w-28" />
            <SkeletonBlock className="h-3 w-64" />
          </div>
          <div className="flex gap-1 rounded-[var(--radius)] p-0.5">
            <SkeletonBlock className="h-7 w-12" />
            <SkeletonBlock className="h-7 w-12" />
            <SkeletonBlock className="h-7 w-12" />
          </div>
        </div>

        <div className="space-y-3 rounded-[var(--radius-lg)] p-4">
          <div className="flex items-center justify-between">
            <SkeletonBlock className="h-4 w-32" />
            <SkeletonBlock className="h-3 w-40" />
          </div>
          <div className="space-y-2">
            <SkeletonBlock className="h-8" />
            <SkeletonBlock className="h-8" />
          </div>
        </div>

        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
          {DAYS.map((day) => (
            <div key={day} className="space-y-3 rounded-[var(--radius-lg)] p-4">
              <div className="flex items-baseline justify-between">
                <SkeletonBlock className="h-4 w-20" />
                <SkeletonBlock className="h-3 w-8" />
              </div>
              <div className="space-y-2">
                {DAY_ROWS.map((row) => (
                  <SkeletonBlock key={row} className="h-7" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </SkeletonScreen>
  );
}
