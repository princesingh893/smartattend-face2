export function Skeleton({ className = '' }) {
  return <div className={`skeleton rounded-lg ${className}`} aria-hidden />;
}

export function SkeletonStat() {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5">
      <Skeleton className="h-3 w-20 mb-3" />
      <Skeleton className="h-8 w-14" />
    </div>
  );
}

export function SkeletonRows({ rows = 5 }) {
  return (
    <div className="space-y-2" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 p-3.5 rounded-lg border border-slate-100"
        >
          <Skeleton className="w-10 h-10 rounded-full shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3 w-1/4" />
          </div>
          <Skeleton className="h-6 w-16 rounded-md" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonTable({ rows = 6 }) {
  return (
    <div className="p-5 space-y-3" aria-label="Loading">
      <Skeleton className="h-4 w-full" />
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}
