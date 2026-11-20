import { steps, titles } from './validation'

function stepNote(form, step) {
  if (form.missing.includes(step)) return 'Missing'
  if (form.saveState[step]?.status === 'failed') return 'Needs attention'
  if (Object.values(form.errors[step] || {}).some(Boolean)) return 'Needs attention'
  if (form.saved[step]) return 'Done'
  return ''
}

export function Stepper({ step, visited, form, go }) {
  return (
    <nav aria-label="Settings steps">
      <ol className="stepper">
        {steps.map(n => (
          <li key={n}>
            <button
              disabled={n > visited || form.phase === 'submitting'}
              aria-current={n === step ? 'step' : undefined}
              onClick={() => go(n)}
            >
              <span>
                {n}. {titles[n]}
              </span>
              <small>{stepNote(form, n)}</small>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  )
}

export function SaveStatus({ state, retry }) {
  let text = ''
  if (state.status === 'saving') text = 'Saving…'
  if (state.status === 'saved') {
    text = 'Saved'
    if (state.at)
      text +=
        ' ' +
        new Date(state.at).toLocaleTimeString('en-GB', {
          hour: '2-digit',
          minute: '2-digit',
        })
  }
  if (state.status === 'failed') text = "Couldn't save,"
  return (
    <div role="status" className="save-status">
      {text}{' '}
      {state.status === 'failed' && (
        <button className="text-button" onClick={retry}>
          Retry
        </button>
      )}
    </div>
  )
}
