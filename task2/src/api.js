export function queryString(params) {
  const entries = Object.entries(params).filter(([, value]) => value !== '')
  return new URLSearchParams(entries).toString()
}

async function requestJson(path, label, options) {
  const response = await fetch(`/api/${path}`, { cache: 'no-store', ...options })
  if (!response.ok) {
    const error = new Error(`Could not load ${label} (HTTP ${response.status}).`)
    error.status = response.status
    const body = await response.json().catch(() => null)
    error.detail = body?.detail
    throw error
  }
  return response.json()
}

export function getAccounts(query, signal) {
  return requestJson(`accounts?${query}`, 'accounts', { signal })
}

export function getSummary(query, signal) {
  return requestJson(`accounts/summary?${query}`, 'usage summary', { signal })
}

export function getAccount(id, signal) {
  return requestJson(`accounts/${id}`, 'account', { signal })
}

export function getSettings(id, signal) {
  return requestJson(`accounts/${id}/settings`, 'settings', { signal })
}

export function saveSettingsStep(id, step, data, signal) {
  return requestJson(`accounts/${id}/settings/step/${step}`, 'settings step', {
    method: 'PUT',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data }),
  })
}

export function submitSettings(id, signal) {
  return requestJson(`accounts/${id}/settings/submit`, 'submission', { method: 'POST', signal })
}
