import { Component, lazy, Suspense } from 'react'
import { ChartSkeleton } from './ChartSkeleton'

const SummaryCard = lazy(() => import('./SummaryCard'))

// A failed chart download must leave the accounts table and editor usable.
class ChartBoundary extends Component {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <section className="panel summary">
        <h2>Daily usage</h2>
        <p role="alert">The chart could not open.</p>
        <button className="text-button" onClick={() => location.reload()}>
          Reload page
        </button>
      </section>
    )
  }
}

export function LazySummary({ date_from, date_to }) {
  return (
    <ChartBoundary>
      <Suspense
        fallback={
          <section className="panel summary">
            <h2>Daily usage</h2>
            <ChartSkeleton />
          </section>
        }
      >
        <SummaryCard date_from={date_from} date_to={date_to} />
      </Suspense>
    </ChartBoundary>
  )
}
