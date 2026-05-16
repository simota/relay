import { SkeletonBlock, SkeletonScreen } from "@/components/skeleton";

const TILES = [3, 2, 2, 2, 3] as const;

export default function Loading() {
  return (
    <SkeletonScreen className="overflow-y-auto">
      <div className="mx-auto max-w-[1400px] space-y-5 px-6 py-6">
        <div className="space-y-2">
          <SkeletonBlock className="h-6 w-28" />
          <SkeletonBlock className="h-3 w-56" />
        </div>

        <div className="grid grid-cols-12 gap-4">
          {TILES.map((span, i) => (
            <SkeletonBlock
              key={i}
              className={`col-span-12 sm:col-span-6 md:col-span-${span} h-[110px] rounded-[var(--radius-lg)]`}
            />
          ))}
        </div>

        <div className="grid grid-cols-12 gap-4">
          <SkeletonBlock className="col-span-12 md:col-span-8 h-[320px] rounded-[var(--radius-lg)]" />
          <div className="col-span-12 md:col-span-4 space-y-4">
            <SkeletonBlock className="h-[150px] rounded-[var(--radius-lg)]" />
            <SkeletonBlock className="h-[150px] rounded-[var(--radius-lg)]" />
          </div>
        </div>

        <div className="grid grid-cols-12 gap-4">
          <SkeletonBlock className="col-span-12 md:col-span-8 h-[220px] rounded-[var(--radius-lg)]" />
          <div className="col-span-12 md:col-span-4 space-y-4">
            <SkeletonBlock className="h-[180px] rounded-[var(--radius-lg)]" />
            <SkeletonBlock className="h-[150px] rounded-[var(--radius-lg)]" />
          </div>
        </div>

        {/* Section 4 */}
        <div className="grid grid-cols-12 gap-4">
          <SkeletonBlock className="col-span-12 md:col-span-6 h-[220px] rounded-[var(--radius-lg)]" />
          <SkeletonBlock className="col-span-12 md:col-span-6 h-[220px] rounded-[var(--radius-lg)]" />
        </div>

        {/* Section 4b */}
        <div className="grid grid-cols-12 gap-4">
          <SkeletonBlock className="col-span-12 h-[180px] rounded-[var(--radius-lg)]" />
        </div>

        {/* Section 5 */}
        <div className="grid grid-cols-12 gap-4">
          <SkeletonBlock className="col-span-12 md:col-span-6 h-[220px] rounded-[var(--radius-lg)]" />
          <SkeletonBlock className="col-span-12 md:col-span-6 h-[220px] rounded-[var(--radius-lg)]" />
        </div>

        {/* Section 6 */}
        <div className="grid grid-cols-12 gap-4">
          <SkeletonBlock className="col-span-12 h-[260px] rounded-[var(--radius-lg)]" />
        </div>
      </div>
    </SkeletonScreen>
  );
}
