import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './style.css'

function HealthPage() {
  const [message, setMessage] = useState('Checking the mock API…')

  useEffect(() => {
    const controller = new AbortController()

    async function checkHealth() {
      try {
        const response = await fetch('/api/health', { signal: controller.signal })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const { status, accounts } = await response.json()
        setMessage(`Status: ${status} · Accounts: ${accounts.toLocaleString('en-US')}`)
      } catch (error) {
        if (!controller.signal.aborted) setMessage(`Health check failed: ${error.message}`)
      }
    }

    checkHealth()
    return () => controller.abort()
  }, [])

  return (
    <main className="mx-auto max-w-xl px-6 py-16 text-slate-900">
      <h1 className="text-3xl font-semibold tracking-tight">Callzo API health</h1>
      <p role="status" className="mt-4 border-l-2 border-teal-600 pl-4 text-lg">{message}</p>
    </main>
  )
}

createRoot(document.getElementById('root')).render(<HealthPage />)
