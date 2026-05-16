import { SkeletonBlock, SkeletonScreen } from "@/components/skeleton";

const ROWS = [0, 1, 2, 3, 4, 5] as const;

export default function Loading() {
  return (
    <SkeletonScreen className="overflow-y-auto">
      <div className="max-w-[900px] space-y-5 px-6 py-6">
        <div className="flex items-baseline justify-between gap-4">
          <div className="space-y-2">
            <SkeletonBlock className="h-6 w-28" />
            <SkeletonBlock className="h-3 w-64" />
          </div>
          <SkeletonBlock className="h-8 w-[240px]" />
        </div>

        <div className="space-y-px overflow-hidden rounded-[var(--radius-lg)]">
          {ROWS.map((row) => (
            <SkeletonBlock key={row} className="h-16 rounded-none" />
          ))}
        </div>
      </div>
    </SkeletonScreen>
  );
}
