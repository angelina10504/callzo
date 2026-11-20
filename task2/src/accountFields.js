// The API supports sorting on every displayed column. Email is shown with the name.
export const columns = [
  ['name', 'Name'], ['company', 'Company'], ['status', 'Status'], ['plan', 'Plan'],
  ['current_month_minutes', 'Minutes'], ['current_month_sms', 'SMS'], ['cost_cents', 'Cost'],
  ['country', 'Country'], ['signup_date', 'Signup date'], ['last_active', 'Last active'], ['id', 'ID'],
]

export const options = {
  status: ['active', 'trial', 'suspended'],
  country: ['AU', 'BR', 'CA', 'DE', 'FR', 'GB', 'IN', 'NG', 'PK', 'US'],
  plan: ['basic', 'pro', 'enterprise'],
}
export const pageSizes = [10, 25, 50, 100, 200]
export const number = new Intl.NumberFormat('en-US')
export const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
