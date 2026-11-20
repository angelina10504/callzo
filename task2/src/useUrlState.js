import { useEffect, useState } from 'react'
import { columns, options } from './accountFields'

function readParams() {
  const query = new URLSearchParams(location.search)
  const choice = (key, choices, fallback) =>
    choices.includes(query.get(key)) ? query.get(key) : fallback
  const positiveInt = (key, fallback, max) => {
    const value = Number(query.get(key))
    return Number.isSafeInteger(value) && value > 0 && value <= max ? value : fallback
  }
  return {
    search: query.get('search') || '',
    status: choice('status', options.status, ''),
    country: query.get('country') || '',
    plan: choice('plan', options.plan, ''),
    sort_by: choice(
      'sort_by',
      columns.map(([key]) => key),
      'id',
    ),
    sort_dir: choice('sort_dir', ['asc', 'desc'], 'asc'),
    page: positiveInt('page', 1, Number.MAX_SAFE_INTEGER),
    page_size: positiveInt('page_size', 25, 200),
  }
}

export function useUrlState() {
  const [params, setParams] = useState(readParams)

  useEffect(() => {
    const restore = () => setParams(readParams())
    window.addEventListener('popstate', restore)
    return () => window.removeEventListener('popstate', restore)
  }, [])

  function update(changes, replace = false) {
    const url = new URL(location.href)
    for (const [key, value] of Object.entries({ page: 1, ...changes })) {
      if (value === '') url.searchParams.delete(key)
      else url.searchParams.set(key, value)
    }
    if (url.href === location.href) return
    if (replace) history.replaceState(null, '', url)
    else history.pushState(null, '', url)
    setParams(readParams())
  }
  return [params, update]
}
