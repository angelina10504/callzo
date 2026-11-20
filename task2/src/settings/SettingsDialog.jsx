import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useSettingsForm } from './useSettingsForm'
import { SaveStatus, Stepper } from './Stepper'
import { StepFields } from './StepFields'
import { awaitingBilling } from './formState'
import { steps, titles } from './validation'
import './settings.css'

function trapTab(event) {
  if (event.key !== 'Tab') return
  const items = event.currentTarget.querySelectorAll(
    'button:enabled, input:enabled, select:enabled',
  )
  if (!items.length) {
    event.preventDefault()
    event.currentTarget.querySelector('#settings-title').focus()
    return
  }
  const first = items[0]
  const last = items[items.length - 1]
  const active = document.activeElement
  if (event.shiftKey && (active === first || !Array.from(items).includes(active))) {
    event.preventDefault()
    last?.focus()
  } else if (!event.shiftKey && active === last) {
    event.preventDefault()
    first?.focus()
  }
}

function DiscardPrompt({ keep, discard, saving }) {
  return (
    <section>
      <h3 tabIndex={-1} id="discard-title">
        Discard unsaved changes?
      </h3>
      <p className="submit-note">Changes already saved stay on file.</p>
      <div className="settings-actions">
        <button className="primary" onClick={keep}>
          Keep editing
        </button>
        <button className="step" disabled={saving} onClick={discard}>
          Discard
        </button>
      </div>
    </section>
  )
}

function StepEditor({ form, step, visited, go, heading, submit }) {
  const allowSubmit = step === 4 || steps.every(n => form.saved[n])
  function next() {
    if (form.validate(step)) go(step + 1)
    else
      requestAnimationFrame(() => document.querySelector('dialog [aria-invalid="true"]')?.focus())
  }
  return (
    <>
      <Stepper form={form} step={step} visited={visited} go={go} />
      <div className="settings-step-title">
        <h3 ref={heading} tabIndex={-1} id="step-title">
          Step {step} of 4 · {titles[step]}
        </h3>
        <SaveStatus state={form.saveState[step]} retry={() => form.schedule(step, 0, true)} />
      </div>
      <StepFields form={form} step={step} />
      {awaitingBilling(form, step) && (
        <p className="submit-note">
          Save Billing first. Your valid webhook draft will then save automatically.
        </p>
      )}
      {form.submitError && (
        <p role="alert" className="field-error">
          {form.submitError}
        </p>
      )}
      {allowSubmit && (
        <p className="submit-note">Submit uses the last saved version of each step.</p>
      )}
      <div className="settings-actions">
        <button
          className="step"
          disabled={step === 1 || form.phase === 'submitting'}
          onClick={() => go(step - 1)}
        >
          Back
        </button>
        {step < 4 && (
          <button className="primary" disabled={form.phase === 'submitting'} onClick={next}>
            Next
          </button>
        )}
        {allowSubmit && (
          <button className="primary" disabled={form.submitDisabled} onClick={submit}>
            {form.phase === 'submitting' ? 'Submitting…' : 'Submit'}
          </button>
        )}
      </div>
    </>
  )
}

export function SettingsDialog({ accountId, step, goToStep, close, opener, leaveGuard }) {
  const form = useSettingsForm(accountId)
  const dialog = useRef(null)
  const heading = useRef(null)
  const [visited, setVisited] = useState(step)
  const [discardAction, setDiscardAction] = useState(null)
  const { schedule, setPaused } = form

  // Activate the native modal and its focus boundary before the browser paints.
  useLayoutEffect(() => {
    const element = dialog.current
    element.showModal()
    element.querySelector('#settings-title').focus()
    return () => {
      element.close()
      const button = document.querySelector(`[data-edit-account="${accountId}"]`)
      const target = opener.current?.isConnected ? opener.current : button
      const focusTarget = target || document.getElementById('accounts-heading')
      focusTarget?.focus({ preventScroll: true })
      opener.current = null
    }
  }, [accountId, opener])

  useEffect(() => {
    if (form.phase !== 'ready') return
    setVisited(old => Math.max(old, step))
    schedule(step)
    heading.current?.focus()
  }, [step, form.phase, schedule])

  useEffect(() => {
    if (discardAction) dialog.current.querySelector('#discard-title')?.focus()
    if (form.phase === 'submitted') dialog.current.querySelector('#success-title')?.focus()
  }, [discardAction, form.phase])

  useEffect(() => {
    if (!form.unsaved && !form.saving && form.phase !== 'submitting') return
    leaveGuard.current = action => {
      if (form.phase === 'submitting') return
      setPaused(true)
      setDiscardAction(() => action)
    }
    return () => {
      leaveGuard.current = null
    }
  }, [form.unsaved, form.saving, form.phase, setPaused, leaveGuard])

  function keepEditing() {
    for (const n of steps) {
      if (form.saveState[n]?.due != null) schedule(n)
    }
    setDiscardAction(null)
    setPaused(false)
    requestAnimationFrame(() => heading.current?.focus())
  }

  function requestClose() {
    if (discardAction) return keepEditing()
    if (leaveGuard.current) return leaveGuard.current(close)
    close()
  }

  function go(n) {
    if (n === step) return
    schedule(step, 0)
    goToStep(n)
  }

  async function submit() {
    const missing = await form.submit()
    if (missing) goToStep(missing)
  }

  const editing = form.phase === 'ready' || form.phase === 'submitting'
  return (
    <dialog
      ref={dialog}
      className="settings-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
      onKeyDown={trapTab}
      onCancel={e => {
        e.preventDefault()
        requestClose()
      }}
    >
      <header className="settings-head">
        <div>
          <p>
            Account {accountId}
            {form.account && ' · ' + form.account.name}
          </p>
          <h2 id="settings-title" tabIndex={-1}>
            Account settings
          </h2>
        </div>
        {!discardAction && form.phase !== 'submitted' && (
          <button
            className="text-button"
            disabled={form.phase === 'submitting'}
            onClick={requestClose}
          >
            Close
          </button>
        )}
      </header>
      {discardAction && (
        <DiscardPrompt keep={keepEditing} discard={discardAction} saving={form.saving} />
      )}
      {!discardAction && (
        <>
          {form.phase === 'loading' && <p role="status">Loading settings…</p>}
          {form.phase === 'loadError' && (
            <div>
              <p role="alert">{form.loadError}</p>
              <button className="text-button" onClick={form.retryLoad}>
                Retry
              </button>
            </div>
          )}
          {editing && (
            <StepEditor
              form={form}
              step={step}
              visited={Math.max(visited, step, ...Object.keys(form.saved).map(Number))}
              go={go}
              heading={heading}
              submit={submit}
            />
          )}
          {form.phase === 'submitted' && (
            <section>
              <h3 id="success-title" tabIndex={-1}>
                Settings submitted
              </h3>
              <button className="primary" onClick={close}>
                Close
              </button>
            </section>
          )}
        </>
      )}
    </dialog>
  )
}
