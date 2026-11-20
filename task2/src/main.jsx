import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { useUrlState } from './useUrlState'
import { useAccounts } from './useAccounts'
import { AccountsTable } from './AccountsTable'
import { Filters } from './Filters'
import { Pagination } from './Pagination'
import { SelectionBar } from './SelectionBar'
import { number } from './accountFields'
import { DateRange } from './DateRange'
import { dateRangeError } from './dateRange'
import { SummaryCard } from './SummaryCard'
import './style.css'

function TableFeedback({ page }) {
  if (page.blocked) return <div className="feedback">Fix the date range to load accounts.</div>
  let message = ''
  let action = 'Refresh'
  if (page.error) {
    message = page.error
    action = 'Retry'
  } else if (page.updating) {
    message = page.rows ? 'Updating…' : 'Loading accounts…'
  } else if (page.pendingOrder) {
    message = 'Order changed,'
    action = 'Reload'
  }
  return (
    <div className="feedback">
      {message}
      <button
        className="text-button feedback-action"
        data-visible={action !== 'Refresh'}
        onClick={action === 'Reload' ? page.acceptOrder : page.retry}
      >
        {action}
      </button>
    </div>
  )
}

function AccountsPage() {
  const [params, update] = useUrlState()
  const page = useAccounts(params)
  const [selected, setSelected] = useState(() => new Set())

  function toggle(ids, checked) {
    setSelected(old => {
      const next = new Set(old)
      for (const id of ids) {
        if (checked) next.add(id)
        else next.delete(id)
      }
      return next
    })
  }

  function sort(key) {
    update({
      sort_by: key,
      sort_dir: params.sort_by === key && params.sort_dir === 'asc' ? 'desc' : 'asc',
    })
  }

  return (
    <>
      <header className="mast">
        <div className="shell flex items-center gap-5">
          <strong className="brand">Callzo</strong>
          <span className="product">Usage console</span>
        </div>
      </header>
      <main className="shell">
        <div className="title-row">
          <h1>Accounts</h1>
          <p>
            {page.updated && (
              <>
                Updated <time>{page.updated.toLocaleTimeString('en-GB', { hour12: false })}</time>
              </>
            )}
          </p>
        </div>
        <DateRange params={params} update={update} error={dateRangeError(params)} />
        <SummaryCard date_from={params.date_from} date_to={params.date_to} />
        <Filters params={params} update={update} />
        <section className="panel" aria-label="Account results">
          <div className="toolbar">
            <strong>{page.rows ? number.format(page.total) : '—'} accounts</strong>
            <SelectionBar selected={selected} clear={() => setSelected(new Set())} />
          </div>
          <TableFeedback page={page} />
          <div className="sr-only" aria-live="polite" aria-atomic="true">
            {page.announcement}
          </div>
          <AccountsTable
            page={page}
            params={params}
            sort={sort}
            selected={selected}
            toggle={toggle}
            clearFilters={() =>
              update({ search: '', status: '', country: '', plan: '', date_from: '', date_to: '' })
            }
          />
          <Pagination
            params={params}
            total={page.total}
            update={update}
            updating={page.updating || page.blocked}
          />
        </section>
      </main>
    </>
  )
}
createRoot(document.getElementById('root')).render(<AccountsPage />)
