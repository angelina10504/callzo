export function DateRange({ params, update, error }) {
  const fields = [
    ['date_from', 'From'],
    ['date_to', 'To'],
  ]
  return (
    <fieldset className="date-range">
      <legend>Date range</legend>
      <div className="date-controls">
        {fields.map(([key, label]) => (
          <label key={key}>
            {label}
            <input
              type="date"
              name={key}
              value={params[key]}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'range-error' : undefined}
              onChange={event => update({ [key]: event.target.value })}
            />
          </label>
        ))}
        <button
          className="text-button"
          disabled={!params.date_from && !params.date_to}
          onClick={() => update({ date_from: '', date_to: '' })}
        >
          Clear dates
        </button>
      </div>
      {error && (
        <p id="range-error" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  )
}
