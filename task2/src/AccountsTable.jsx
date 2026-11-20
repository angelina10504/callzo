import { useEffect, useRef } from 'react'
import { columns, currency, number } from './accountFields'

function valueFor(account, field) {
  const value = account[field]
  if (field === 'cost_cents') return currency.format(value / 100)
  if (typeof value === 'number') return number.format(value)
  return value
}

function PageCheckbox({ rows, selected, toggle, disabled }) {
  const ref = useRef(null)
  const count = rows.filter(row => selected.has(row.id)).length
  useEffect(() => {
    ref.current.indeterminate = count > 0 && count < rows.length
  }, [count, rows.length])

  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label="Select all accounts on this page"
      checked={count > 0 && count === rows.length}
      disabled={disabled || !rows.length}
      onChange={e =>
        toggle(
          rows.map(row => row.id),
          e.target.checked,
        )
      }
    />
  )
}

const sortIndicators = {
  asc: { label: 'ascending', arrow: '↑' },
  desc: { label: 'descending', arrow: '↓' },
}

function SortHeader({ field, label, params, sort, children }) {
  const indicator = params.sort_by === field && sortIndicators[params.sort_dir]
  return (
    <th scope="col" aria-sort={indicator?.label}>
      <div className="flex items-center gap-3">
        {children}
        <button onClick={() => sort(field)}>
          {label} <span aria-hidden="true">{indicator?.arrow || '↕'}</span>
        </button>
      </div>
    </th>
  )
}

function NameCell({ account, checked, toggle, changed, onEdit }) {
  const { id, name, email } = account
  return (
    <td>
      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          aria-label={`Select ${name}, account ${id}`}
          checked={checked}
          onChange={e => toggle([id], e.target.checked)}
        />
        <div className="min-w-0">
          <strong className={changed.has(`${id}:name`) ? 'flash' : ''}>{name}</strong>
          <small className={changed.has(`${id}:email`) ? 'flash' : ''}>{email}</small>
          <button
            className="text-button edit-settings"
            data-edit-account={id}
            aria-label={`Edit settings for ${name}, account ${id}`}
            onClick={e => onEdit(id, e.currentTarget)}
          >
            Edit settings
          </button>
        </div>
      </div>
    </td>
  )
}

function ValueCell({ account, field, changed, updated }) {
  const flashed = changed.has(`${account.id}:${field}`)
  const classes = []
  if (flashed) classes.push('flash')
  if (field === 'status') classes.push('badge', account.status)

  return (
    <td>
      <span key={flashed ? updated.getTime() : 'value'} className={classes.join(' ')}>
        {valueFor(account, field)}
      </span>
    </td>
  )
}

function AccountRow({ account, checked, toggle, changed, updated, onEdit }) {
  return (
    <tr data-account-id={account.id} data-selected={checked}>
      {columns.map(([field]) => {
        if (field === 'name') {
          return (
            <NameCell
              onEdit={onEdit}
              key={field}
              account={account}
              checked={checked}
              toggle={toggle}
              changed={changed}
            />
          )
        }
        return (
          <ValueCell
            key={field}
            field={field}
            account={account}
            changed={changed}
            updated={updated}
          />
        )
      })}
    </tr>
  )
}

function SkeletonRows() {
  return Array.from({ length: 8 }, (_, index) => (
    <tr key={index} aria-hidden="true">
      {columns.map(([key]) => (
        <td key={key}>
          <div className="skeleton" />
        </td>
      ))}
    </tr>
  ))
}

function EmptyState({ clearFilters }) {
  return (
    <div className="empty">
      <p>No accounts match</p>
      <button className="text-button" onClick={clearFilters}>
        Clear filters
      </button>
    </div>
  )
}

export function AccountsTable({ page, params, sort, selected, toggle, clearFilters, onEdit }) {
  const { rows, updating, changed, updated, error } = page
  const empty = rows?.length === 0 && !updating && !error && !page.blocked

  return (
    <div className="table-area" tabIndex={0} role="region" aria-label="Scrollable accounts table">
      <table>
        <caption className="sr-only">Accounts and current month usage</caption>
        <thead>
          <tr>
            {columns.map(([field, label]) => (
              <SortHeader key={field} field={field} label={label} params={params} sort={sort}>
                {field === 'name' && (
                  <PageCheckbox
                    rows={rows || []}
                    selected={selected}
                    toggle={toggle}
                    disabled={updating || page.blocked}
                  />
                )}
              </SortHeader>
            ))}
          </tr>
        </thead>
        <tbody className={rows && updating ? 'opacity-55' : ''}>
          {!rows && !error && !page.blocked && <SkeletonRows />}
          {rows?.map(account => (
            <AccountRow
              key={account.id}
              account={account}
              onEdit={onEdit}
              checked={selected.has(account.id)}
              toggle={toggle}
              changed={changed}
              updated={updated}
            />
          ))}
        </tbody>
      </table>
      {empty && <EmptyState clearFilters={clearFilters} />}
    </div>
  )
}
