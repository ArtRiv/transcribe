/**
 * /history skeleton loading state (UI-SPEC §9.5).
 * Displayed by Next.js while the RSC is streaming.
 */
export default function HistoryLoading() {
  return (
    <div className="mx-auto max-w-[1080px] px-8 pt-8 pb-12">
      <header className="mb-[22px] h-16 bg-(--color-bg-2) animate-pulse rounded-(--radius-md)" />
      <div className="flex flex-col gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="h-[68px] bg-(--color-bg-2) animate-pulse rounded-(--radius-lg)"
          />
        ))}
      </div>
    </div>
  );
}
