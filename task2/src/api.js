export async function getAccounts(query, signal) {
  const response = await fetch(`/api/accounts?${query}`, { signal, cache: 'no-store' })
  if (!response.ok) {
    const error = new Error(`Could not load accounts (HTTP ${response.status}).`)
    error.status = response.status
    throw error
  }
  return response.json()
}
