import { useEffect, useRef, useState } from 'react'
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
    date_from: query.get('date_from') || '',
    date_to: query.get('date_to') || '',
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

function readLocation() {
  const url = new URL(location.href)
  const id = Number(url.searchParams.get('settings'))
  const step = Number(url.searchParams.get('step'))
  return {
    params: readParams(),
    href: url.href,
    historyState: history.state,
    accountId: Number.isSafeInteger(id) && id > 0 ? id : null,
    step: [1, 2, 3, 4].includes(step) ? step : 1,
  }
}

export function useUrlState() {
  const [view, setView] = useState(readLocation)
  const leaveGuard = useRef(null)
  useEffect(() => {
    function restore() {
      const next = readLocation()
      if (view.accountId !== next.accountId && leaveGuard.current) {
        history.pushState(view.historyState, '', view.href)
        leaveGuard.current(() => {
          leaveGuard.current = null
          history.back()
        })
        return
      }
      setView(next)
    }
    window.addEventListener('popstate', restore)
    return () => window.removeEventListener('popstate', restore)
  }, [view])

  function write(changes, replace, historyState = history.state) {
    const url = new URL(location.href)
    for (const [key, value] of Object.entries(changes)) {
      if (value === '') url.searchParams.delete(key)
      else url.searchParams.set(key, value)
    }
    if (url.href === location.href) return
    if (replace) history.replaceState(historyState, '', url)
    else history.pushState(historyState, '', url)
    setView(readLocation())
  }

  function update(changes, replace = false) {
    write({ page: 1, ...changes }, replace)
  }

  function openSettings(id, step = 1) {
    const alreadyOpen = Boolean(view.accountId)
    const entry = alreadyOpen ? history.state : { settingsEntry: true }
    write({ settings: id, step }, alreadyOpen, entry)
  }

  function closeSettings() {
    leaveGuard.current = null
    if (history.state?.settingsEntry) history.back()
    else write({ settings: '', step: '' }, true, null)
  }

  return { ...view, update, openSettings, closeSettings, leaveGuard }
}
