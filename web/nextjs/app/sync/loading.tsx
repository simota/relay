import { SkeletonBlock, SkeletonScreen } from "@/components/skeleton";

const CARDS = [0, 1, 2, 3] as const;
const ROWS = [0, 1, 2, 3] as const;

export default function Loading() {
  return (
    <SkeletonScreen className="overflow-y-auto">
      <div className="mx-auto flex max-w-6xl flex-col gap-5 p-6">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-2">
            <SkeletonBlock className="h-6 w-40" />
            <SkeletonBlock className="h-3 w-80 max-w-[52vw]" />
          </div>
          <SkeletonBlock className="h-8 w-24" />
        </div>

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {CARDS.map((card) => (
            <div key={card} className="space-y-4 rounded-[var(--radius-lg)] p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-2">
                  <SkeletonBlock className="h-3 w-24" />
                  <SkeletonBlock className="h-5 w-28" />
                </div>
                <SkeletonBlock className="h-4 w-4 rounded-full" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <SkeletonBlock className="h-12" />
                <SkeletonBlock className="h-12" />
              </div>
              <SkeletonBlock className="h-9" />
              <SkeletonBlock className="h-8 w-24" />
            </div>
          ))}
        </section>

        <section className="space-y-2">
          <SkeletonBlock className="h-4 w-20" />
          <div className="space-y-px overflow-hidden rounded-[var(--radius-lg)]">
            {ROWS.map((row) => (
              <SkeletonBlock key={row} className="h-11 rounded-none" />
            ))}
          </div>
        </section>
      </div>
    </SkeletonScreen>
  );
}

