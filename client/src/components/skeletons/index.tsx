import { Skeleton } from "@/components/ui/skeleton";

interface KpiCardsSkeletonProps {
  count?: number;
  className?: string;
}

export function KpiCardsSkeleton({ count = 4, className = "" }: KpiCardsSkeletonProps) {
  return (
    <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 ${className}`} data-testid="skeleton-kpi-cards">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-lg border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-8 w-8 rounded-full" />
          </div>
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-3 w-20" />
        </div>
      ))}
    </div>
  );
}

interface DataTableSkeletonProps {
  rows?: number;
  columns?: number;
  showHeader?: boolean;
  className?: string;
}

export function DataTableSkeleton({ rows = 8, columns = 5, showHeader = true, className = "" }: DataTableSkeletonProps) {
  return (
    <div className={`w-full space-y-2 ${className}`} data-testid="skeleton-table">
      {showHeader && (
        <div className="flex gap-3 border-b pb-2">
          {Array.from({ length: columns }).map((_, i) => (
            <Skeleton key={i} className="h-4 flex-1" />
          ))}
        </div>
      )}
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-3 py-1.5">
          {Array.from({ length: columns }).map((_, c) => (
            <Skeleton key={c} className="h-4 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

interface ChartSkeletonProps {
  height?: number;
  className?: string;
}

export function ChartSkeleton({ height = 280, className = "" }: ChartSkeletonProps) {
  return (
    <div className={`w-full rounded-lg border bg-card p-4 space-y-3 ${className}`} data-testid="skeleton-chart">
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-4 w-20" />
      </div>
      <Skeleton className="w-full" style={{ height }} />
    </div>
  );
}

interface WizardStepSkeletonProps {
  className?: string;
}

export function WizardStepSkeleton({ className = "" }: WizardStepSkeletonProps) {
  return (
    <div className={`w-full space-y-4 ${className}`} data-testid="skeleton-wizard">
      <div className="space-y-2">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-3 w-72" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-9 w-full" />
          </div>
        ))}
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Skeleton className="h-9 w-24" />
        <Skeleton className="h-9 w-24" />
      </div>
    </div>
  );
}

export function PageLoadingSkeleton() {
  return (
    <div className="min-h-screen p-4 sm:p-6 space-y-6" data-testid="skeleton-page">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-9 w-28" />
      </div>
      <KpiCardsSkeleton />
      <DataTableSkeleton rows={6} columns={5} />
    </div>
  );
}
