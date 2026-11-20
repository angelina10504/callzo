export function ChartSkeleton() {
  return (
    <div className="chart-placeholder" role="status">
      <span className="sr-only">Loading usage summary…</span>
      <div className="chart-skeleton" aria-hidden="true" />
    </div>
  )
}
