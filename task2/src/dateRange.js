function isCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(value + 'T00:00:00Z')
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function dateRangeError({ date_from, date_to }) {
  if ([date_from, date_to].some(value => value && !isCalendarDate(value))) {
    return 'Enter a valid calendar date.'
  }
  if (date_from && date_to && date_from > date_to) {
    return 'From must be on or before To.'
  }
  return ''
}
