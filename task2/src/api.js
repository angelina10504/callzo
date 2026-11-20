export function queryString(params) {
  const entries = Object.entries(params).filter(([, value]) => value !== '')
  return new URLSearchParams(entries).toString()
}

async function getJson(path, label, query, signal) {
  const response = await fetch(`/api/${path}?${query}`, { signal, cache: 'no-store' })
  if (!response.ok) {
    const error = new Error(`Could not load ${label} (HTTP ${response.status}).`)
    error.status = response.status
    throw error
  }
  return response.json()
}

export function getAccounts(query, signal) {
  return getJson('accounts', 'accounts', query, signal)
}

export function getSummary(query, signal) {
  return getJson('accounts/summary', 'usage summary', query, signal)
}
