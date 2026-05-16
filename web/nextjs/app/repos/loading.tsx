import { SkeletonBlock, SkeletonScreen } from "@/components/skeleton";

const CARDS = [0, 1, 2, 3, 4, 5] as const;

export default function Loading() {
  return (
    <SkeletonScreen className="overflow-y-auto">
      <div className="max-w-[1400px] space-y-5 px-6 py-6">
        <div className="flex items-baseline justify-between gap-4">
          <div className="space-y-2">
            <SkeletonBlock className="h-6 w-24" />
            <SkeletonBlock className="h-3 w-56" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SkeletonBlock className="h-7 w-28" />
            <SkeletonBlock className="h-7 w-32" />
            <div className="flex gap-1 rounded-[var(--radius)] p-0.5">
              <SkeletonBlock className="h-7 w-14" />
              <SkeletonBlock className="h-7 w-12" />
              <SkeletonBlock className="h-7 w-12" />
            </div>
            <SkeletonBlock className="h-8 w-[240px]" />
          </div>
        </div>

        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
          {CARDS.map((card) => (
            <div key={card} className="space-y-3 rounded-[var(--radius-lg)] p-4">
              <div className="flex items-baseline justify-between">
                <SkeletonBlock className="h-4 w-32" />
                <SkeletonBlock className="h-3 w-10" />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <SkeletonBlock className="h-10" />
                <SkeletonBlock className="h-10" />
                <SkeletonBlock className="h-10" />
              </div>
              <SkeletonBlock className="h-3 w-3/4" />
              <SkeletonBlock className="h-2 w-full" />
            </div>
          ))}
        </div>
      </div>
    </SkeletonScreen>
  );
}
