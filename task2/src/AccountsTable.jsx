import { useEffect, useRef } from 'react'
import { columns, currency, number } from './accountFields'

function valueFor(account, field) {
  if (field === 'cost_cents') return currency.format(account[field] / 100)
  if (typeof account[field] === 'number') return number.format(account[field])
  return account[field]
}

function PageCheckbox({ rows, selected, toggle, disabled }) {
  const ref = useRef(null)
  const count = rows.filter(row => selected.has(row.id)).length
  useEffect(() => { ref.current.indeterminate = count > 0 && count < rows.length }, [count, rows.length])
  return <input ref={ref} type="checkbox" aria-label="Select all accounts on this page"
    checked={count > 0 && count === rows.length} disabled={disabled || !rows.length}
    onChange={e => toggle(rows.map(row => row.id), e.target.checked)} />
}

export function AccountsTable({ page, params, sort, selected, toggle, clearFilters }) {
  const { rows, updating, changed, updated } = page
  return <div className="table-area" tabIndex={0} role="region" aria-label="Scrollable accounts table">
    <table>
      <caption className="sr-only">Accounts and current month usage</caption>
      <thead><tr>{columns.map(([key, label]) => {
        const active = params.sort_by === key
        return <th key={key} scope="col" aria-sort={active ? (params.sort_dir === 'asc' ? 'ascending' : 'descending') : undefined}>
          <div className="flex items-center gap-3">
            {key === 'name' && <PageCheckbox rows={rows || []} selected={selected} toggle={toggle} disabled={updating} />}
            <button onClick={() => sort(key)}>{label} <span aria-hidden="true">{active ? (params.sort_dir === 'asc' ? '↑' : '↓') : '↕'}</span></button>
          </div>
        </th>
      })}</tr></thead>
      <tbody className={rows && updating ? 'opacity-55' : ''}>
        {!rows && !page.error && Array.from({ length: 8 }, (_, i) =>
          <tr key={i} aria-hidden="true">{columns.map(([key]) => <td key={key}><div className="skeleton" /></td>)}</tr>
        )}
        {rows?.map(account => <tr key={account.id} data-account-id={account.id} data-selected={selected.has(account.id)}>
          {columns.map(([key]) => {
            const flashed = changed.has(`${account.id}:${key}`)
            return <td key={key}>
              {key === 'name' ? <div className="flex items-center gap-3">
                <input type="checkbox" aria-label={`Select ${account.name}, account ${account.id}`}
                  checked={selected.has(account.id)} onChange={e => toggle([account.id], e.target.checked)} />
                <div className="min-w-0">
                  <strong className={flashed ? 'flash' : ''}>{account.name}</strong>
                  <small className={changed.has(`${account.id}:email`) ? 'flash' : ''}>{account.email}</small>
                </div>
              </div> : <span key={flashed ? updated.getTime() : 'value'}
                className={`${flashed ? 'flash' : ''} ${key === 'status' ? 'badge ' + account.status : ''}`}>{valueFor(account, key)}</span>}
            </td>
          })}
        </tr>)}
      </tbody>
    </table>
    {rows?.length === 0 && !updating && !page.error && <div className="empty">
      <p>No accounts match</p><button className="text-button" onClick={clearFilters}>Clear filters</button>
    </div>}
  </div>
}
