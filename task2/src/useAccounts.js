import { useLayoutEffect, useRef, useState } from 'react'
import { getAccounts } from './api'
import { number } from './accountFields'

function refreshPage(previous, incoming) {
  const byId = new Map(incoming.data.map(row => [row.id, row]))
  const changed = new Set()
  const orderChanged = previous.rows.length !== incoming.data.length ||
    previous.rows.some((row, index) => row.id !== incoming.data[index]?.id)
  const rows = previous.rows.map(old => {
    const fresh = byId.get(old.id)
    if (!fresh) return old
    for (const key of Object.keys(fresh)) {
      if (fresh[key] !== old[key]) changed.add(`${old.id}:${key}`)
    }
    return fresh
  })
  return { ...previous, rows, changed, pendingOrder: orderChanged ? incoming.data : null }
}

export function useAccounts(params) {
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== '')).toString()
  const [attempt, setAttempt] = useState(0)
  const [page, setPage] = useState({
    rows: null, total: 0, query: null, error: '', changed: new Set(),
    pendingOrder: null, updated: null, announcement: '', loading: true,
  })
  const lastSearch = useRef(params.search)

  useLayoutEffect(() => {
    const controller = new AbortController()
    const { signal } = controller
    let busy = false
    const delay = lastSearch.current === params.search ? 0 : 300
    lastSearch.current = params.search
    setPage(old => ({ ...old, loading: true, error: '', pendingOrder: null, announcement: '' }))

    async function load(refresh) {
      if (busy || (refresh && document.hidden)) return
      busy = true
      try {
        const incoming = await getAccounts(query, signal)
        if (signal.aborted) return
        const updated = new Date()
        setPage(old => {
          const keepOrder = refresh && old.query === query
          const next = keepOrder ? refreshPage(old, incoming) : {
            ...old, rows: incoming.data, changed: new Set(), pendingOrder: null,
          }
          return { ...next, query, total: incoming.total, updated, loading: false, error: '',
            announcement: keepOrder && !old.error ? old.announcement : `${number.format(incoming.total)} accounts. Page ${incoming.page}.` }
        })
      } catch (error) {
        if (signal.aborted) return
        const message = error.status ? error.message : 'Could not reach the accounts API.'
        setPage(old => ({ ...old, loading: false, error: message, announcement: message }))
      } finally {
        busy = false
      }
    }

    const start = setTimeout(() => load(false), delay)
    const poll = setInterval(() => load(true), 15_000)
    return () => {
      clearTimeout(start)
      clearInterval(poll)
      controller.abort()
    }
  }, [query, params.search, attempt])

  function acceptOrder() {
    setPage(old => old.pendingOrder
      ? { ...old, rows: old.pendingOrder, pendingOrder: null, changed: new Set() }
      : old)
  }

  return { ...page, updating: page.loading || (page.query !== query && !page.error),
    retry: () => setAttempt(n => n + 1), acceptOrder }
}
