import { ChartSkeleton } from './ChartSkeleton'
import { useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, XAxis, YAxis } from 'recharts'
import { currency, number } from './accountFields'
import { useSummary } from './useSummary'

const metrics = { minutes: 'Minutes', sms: 'SMS', cost_cents: 'Cost' }
const shortDate = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
})
const fullDate = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})
const compact = new Intl.NumberFormat('en-US', { notation: 'compact' })

function displayValue(metric, value) {
  if (metric === 'cost_cents') return currency.format(value / 100)
  return number.format(value)
}

function describeSeries(series, metric) {
  let total = 0
  let peak = series[0]
  for (const day of series) {
    total += day[metric]
    if (day[metric] > peak[metric]) peak = day
  }
  const first = fullDate.format(new Date(series[0].date))
  const last = fullDate.format(new Date(series.at(-1).date))
  const peakDate = fullDate.format(new Date(peak.date))
  return [
    `${metrics[metric]} per day, ${first} to ${last}.`,
    `Total ${displayValue(metric, total)}.`,
    `Peak ${displayValue(metric, peak[metric])} on ${peakDate}.`,
  ].join(' ')
}

function DailyLine({ series, metric }) {
  const axisValue = value => {
    if (metric === 'cost_cents') return '$' + compact.format(value / 100)
    return compact.format(value)
  }

  return (
    <div className="plot" aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={series}
          accessibilityLayer={false}
          margin={{ top: 10, bottom: 2, left: 0, right: 16 }}
        >
          <CartesianGrid vertical={false} stroke="#dce6e2" />
          <XAxis
            dataKey="date"
            minTickGap={28}
            tickMargin={8}
            tickFormatter={date => shortDate.format(new Date(date))}
          />
          <YAxis width={52} tickFormatter={axisValue} />
          <Line
            type="linear"
            dataKey={metric}
            stroke="#08776a"
            strokeWidth={2}
            dot={series.length === 1}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

function ChartBody({ summary, metric }) {
  if (summary.status === 'loading') {
    return <ChartSkeleton />
  }
  if (summary.status === 'error') {
    return (
      <div className="chart-placeholder">
        <p role="alert">{summary.message}</p>
        <button className="text-button" onClick={summary.retry}>
          Retry
        </button>
      </div>
    )
  }
  if (summary.status === 'invalid') {
    return <p className="chart-placeholder">Fix the date range to load usage.</p>
  }
  const { series } = summary.data
  if (!series.length) {
    return <p className="chart-placeholder">No usage in this date range</p>
  }
  return (
    <figure>
      <figcaption>{describeSeries(series, metric)}</figcaption>
      <DailyLine series={series} metric={metric} />
    </figure>
  )
}

function DailyValues({ series, metric }) {
  return (
    <div className="daily-values" role="region" aria-label="Daily usage data" tabIndex={0}>
      <table>
        <caption className="sr-only">{metrics[metric]} per day</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">{metrics[metric]}</th>
          </tr>
        </thead>
        <tbody>
          {series.map(day => (
            <tr key={day.date}>
              <th scope="row">{day.date}</th>
              <td>{displayValue(metric, day[metric])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function SummaryCard({ date_from, date_to }) {
  const summary = useSummary({ date_from, date_to })
  const [metric, setMetric] = useState('minutes')
  const [expanded, setExpanded] = useState(false)
  const series = summary.data?.series
  const hasRows = Boolean(series?.length)

  return (
    <section className="panel summary" aria-labelledby="usage-title">
      <div className="summary-heading">
        <div>
          <h2 id="usage-title">Daily usage</h2>
          <p className="summary-count">
            {summary.data && `${number.format(summary.data.total_accounts)} accounts`}
          </p>
        </div>
        <label>
          Metric
          <select value={metric} onChange={e => setMetric(e.target.value)}>
            {Object.entries(metrics).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="chart-body">
        <ChartBody summary={summary} metric={metric} />
      </div>
      <div className="summary-footer">
        <button
          className="text-button"
          disabled={!hasRows}
          aria-expanded={expanded && hasRows}
          aria-controls="summary-values"
          onClick={() => setExpanded(open => !open)}
        >
          {expanded && hasRows ? 'Hide data table' : 'Show data table'}
        </button>
        {summary.stale && (
          <small role="status">
            Couldn't refresh, showing data from{' '}
            {summary.updated.toLocaleTimeString('en-GB', {
              hour: '2-digit',
              minute: '2-digit',
            })}
            .
          </small>
        )}
      </div>
      <div id="summary-values" hidden={!expanded || !hasRows}>
        {expanded && hasRows && <DailyValues series={series} metric={metric} />}
      </div>
    </section>
  )
}
