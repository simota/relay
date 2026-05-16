import { SkeletonBlock, SkeletonScreen } from "@/components/skeleton";

const LEGEND = [0, 1, 2] as const;

export default function Loading() {
  return (
    <SkeletonScreen className="overflow-y-auto">
      <div className="space-y-5 px-6 py-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-2">
            <SkeletonBlock className="h-6 w-40" />
            <SkeletonBlock className="h-3 w-96 max-w-[60vw]" />
          </div>
          <SkeletonBlock className="h-9 w-[260px]" />
        </div>

        <div className="space-y-3">
          <SkeletonBlock className="h-[calc(100vh-188px)] min-h-[460px] rounded-[var(--radius-lg)]" />
          <div className="flex flex-wrap gap-2">
            {LEGEND.map((item) => (
              <div key={item} className="flex items-center gap-2 rounded-[var(--radius)] p-2">
                <SkeletonBlock className="h-2 w-2 rounded-full" />
                <SkeletonBlock className="h-3 w-20 rounded-[3px]" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </SkeletonScreen>
  );
}

