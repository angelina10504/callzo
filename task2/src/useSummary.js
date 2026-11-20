import { useEffect, useState } from 'react'
import { getSummary, queryString } from './api'
import { dateRangeError } from './dateRange'

const loading = { status: 'loading', data: null, stale: false }

export function useSummary({ date_from, date_to }) {
  const query = queryString({ date_from, date_to })
  const invalid = Boolean(dateRangeError({ date_from, date_to }))
  const [state, setState] = useState(loading)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (invalid) return
    const controller = new AbortController()
    const { signal } = controller
    let retryTimer
    let hasData = false
    let busy = false

    function save(data) {
      hasData = true
      setState({ query, data, status: 'ready', stale: false, updated: new Date() })
    }

    async function loadInitial(canRetry) {
      try {
        const data = await getSummary(query, signal)
        if (!signal.aborted) save(data)
      } catch (error) {
        if (signal.aborted) return
        if (canRetry) {
          retryTimer = setTimeout(() => loadInitial(false), 1000)
          return
        }
        const message = error.status ? error.message : 'Could not reach the summary API.'
        setState({ query, status: 'error', message })
      }
    }

    async function refresh() {
      if (!hasData || busy || document.hidden) return
      busy = true
      try {
        const data = await getSummary(query, signal)
        if (!signal.aborted) save(data)
      } catch {
        if (!signal.aborted) setState(old => ({ ...old, stale: true }))
      } finally {
        busy = false
      }
    }

    setState(loading)
    loadInitial(true)
    const poll = setInterval(refresh, 15_000)
    return () => {
      controller.abort()
      clearTimeout(retryTimer)
      clearInterval(poll)
    }
  }, [query, invalid, attempt])

  if (invalid) return { status: 'invalid' }
  if (state.query !== query) return loading
  return { ...state, retry: () => setAttempt(n => n + 1) }
}
