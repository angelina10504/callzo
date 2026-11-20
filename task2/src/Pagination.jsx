import { number, pageSizes } from './accountFields'

export function Pagination({ params, total, update, updating }) {
  const { page, page_size: size } = params
  const pages = Math.max(1, Math.ceil(total / size))
  const sizes = pageSizes.includes(size) ? pageSizes : [...pageSizes, size]
  return <nav aria-label="Account pages" className="pagination">
    <label className="flex items-center gap-2">Rows per page
      <select value={size} onChange={e => update({ page_size: Number(e.target.value) })}>
        {sizes.map(value => <option key={value}>{value}</option>)}
      </select>
    </label>
    <div className="flex items-center gap-3">
      <span>Page {number.format(page)} of {number.format(pages)}</span>
      <button className="step" aria-label="Previous page" disabled={page <= 1 || updating}
        onClick={() => update({ page: page - 1 })}>←</button>
      <button className="step" aria-label="Next page" disabled={page >= pages || updating}
        onClick={() => update({ page: page + 1 })}>→</button>
    </div>
  </nav>
}
