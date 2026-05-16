import { SkeletonBlock, SkeletonScreen } from "@/components/skeleton";

const ROWS = [0, 1, 2, 3] as const;
const DAYS = [0, 1, 2, 3, 4, 5, 6] as const;

export default function Loading() {
  return (
    <SkeletonScreen className="flex flex-col">
      <div className="flex items-center justify-between gap-4 px-6 pb-3 pt-5">
        <div className="space-y-2">
          <SkeletonBlock className="h-6 w-44" />
          <SkeletonBlock className="h-3 w-20" />
        </div>
        <div className="flex items-center gap-2">
          <SkeletonBlock className="h-8 w-8" />
          <SkeletonBlock className="h-8 w-8" />
          <SkeletonBlock className="h-8 w-32" />
        </div>
      </div>

      <div className="px-6 py-2">
        <div className="flex h-11 items-center gap-2 overflow-hidden">
          <SkeletonBlock className="h-8 w-36 shrink-0" />
          <SkeletonBlock className="h-8 w-28 shrink-0" />
          <SkeletonBlock className="h-8 w-32 shrink-0" />
          <SkeletonBlock className="h-8 w-40 shrink-0" />
        </div>
      </div>

      <div className="flex-1 overflow-hidden px-6 py-5">
        <div className="grid h-full grid-rows-4 gap-3">
          {ROWS.map((row) => (
            <div key={row} className="grid grid-cols-7 gap-3">
              {DAYS.map((day) => (
                <SkeletonBlock key={`${row}-${day}`} className="min-h-24 rounded-[var(--radius-lg)]" />
              ))}
            </div>
          ))}
        </div>
      </div>
    </SkeletonScreen>
  );
}

