import { useEffect, useRef, useState } from 'react'
import { getAccounts, queryString } from './api'
import { dateRangeError } from './dateRange'
import { number } from './accountFields'

function refreshPage(previous, incoming) {
  const byId = new Map(incoming.data.map(row => [row.id, row]))
  const changed = new Set()
  const orderChanged =
    previous.rows.length !== incoming.data.length ||
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

function applyResponse(old, incoming, { refresh, query, updated }) {
  const keepOrder = refresh && old.query === query
  const contents = keepOrder
    ? refreshPage(old, incoming)
    : { rows: incoming.data, changed: new Set(), pendingOrder: null }
  const announceCount = !keepOrder || old.error
  return {
    ...contents,
    query,
    updated,
    total: incoming.total,
    loading: false,
    error: '',
    announcement: announceCount
      ? `${number.format(incoming.total)} accounts. Page ${incoming.page}.`
      : old.announcement,
  }
}

export function useAccounts(params) {
  const query = queryString(params)
  const blocked = Boolean(dateRangeError(params))
  const [attempt, setAttempt] = useState(0)
  const [page, setPage] = useState({
    rows: null,
    total: 0,
    query: null,
    error: '',
    changed: new Set(),
    pendingOrder: null,
    updated: null,
    announcement: '',
    loading: true,
  })
  const lastSearch = useRef(params.search)

  useEffect(() => {
    if (blocked) return
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
        setPage(old => applyResponse(old, incoming, { refresh, query, updated }))
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
  }, [query, params.search, attempt, blocked])

  function acceptOrder() {
    setPage(old =>
      old.pendingOrder
        ? { ...old, rows: old.pendingOrder, pendingOrder: null, changed: new Set() }
        : old,
    )
  }

  return {
    ...page,
    blocked,
    updating: !blocked && (page.loading || (page.query !== query && !page.error)),
    retry: () => setAttempt(n => n + 1),
    acceptOrder,
  }
}
