import { options } from '../accountFields'

export const steps = [1, 2, 3, 4]
export const titles = { 1: 'Contact', 2: 'Billing', 3: 'Usage limits', 4: 'Webhook' }
export const countries = ['US', 'IN', 'GB', 'CA', 'AU']

export function initialDraft(account, saved) {
  const defaults = {
    1: { name: account.name, email: account.email },
    2: { plan: account.plan, billing_country: '' },
    3: { minutes_cap: '', sms_cap: '' },
    4: { webhook_url: '' },
  }
  for (const step of steps) {
    if (!saved[step]) continue
    for (const key of Object.keys(defaults[step])) {
      defaults[step][key] = String(saved[step][key] ?? '')
    }
  }
  return defaults
}

export function validateStep(step, values) {
  const errors = {}
  if (step === 1) {
    if (!values.name.trim()) errors.name = 'Enter a name.'
    if (!values.email.includes('@')) errors.email = 'Enter an email containing @.'
  }
  if (step === 2) {
    if (!options.plan.includes(values.plan)) errors.plan = 'Choose a plan.'
    if (!countries.includes(values.billing_country))
      errors.billing_country = 'Choose a billing country.'
  }
  if (step === 3) {
    for (const [key, value] of Object.entries(values)) {
      if (value && (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))) {
        errors[key] = 'Enter a non-negative whole number.'
      }
    }
  }
  if (step === 4 && values.webhook_url && !/^https?:\/\//.test(values.webhook_url)) {
    errors.webhook_url = 'Start the URL with http:// or https://.'
  }
  return errors
}

// The inputs keep strings while the API expects numeric caps and permits absent optional fields.
export function payloadFor(step, values) {
  const data = {}
  for (const [key, value] of Object.entries(values)) {
    if (value == null || value === '') continue
    const numericCap = step === 3 && /^\d+$/.test(value)
    data[key] = numericCap ? Number(value) : value
  }
  return data
}

export function matches(step, draft, saved) {
  if (!saved) return false
  const left = payloadFor(step, draft)
  const right = payloadFor(step, saved)
  return (
    Object.keys(left).length === Object.keys(right).length &&
    Object.keys(left).every(key => left[key] === right[key])
  )
}
