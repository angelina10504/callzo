import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { getAccount, getSettings, saveSettingsStep, submitSettings } from '../api'
import { awaitingBilling, formReducer, initialState, needsSave } from './formState'
import { matches, payloadFor, steps, validateStep } from './validation'

export function useSettingsForm(accountId) {
  const [state, dispatch] = useReducer(formReducer, initialState)
  const [attempt, retryLoad] = useReducer(n => n + 1, 0)
  const [paused, setPaused] = useState(false)
  const lifetime = useRef(null)
  const inFlight = useRef(new Set())
  const send = useCallback(action => dispatch({ ...action, now: Date.now() }), [])

  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    const { signal } = controller
    send({ type: 'loading' })
    Promise.all([getAccount(accountId, signal), getSettings(accountId, signal)])
      .then(([account, saved]) => {
        if (!signal.aborted) send({ type: 'loaded', account, saved })
      })
      .catch(() => {
        if (!signal.aborted) send({ type: 'loadError' })
      })
    return () => controller.abort()
  }, [accountId, attempt, send])

  const save = useCallback(
    async (step, snapshot) => {
      const { signal } = lifetime.current
      if (signal.aborted || inFlight.current.has(step)) return
      inFlight.current.add(step)
      send({ type: 'saving', step })
      try {
        const data = payloadFor(step, snapshot)
        const response = await saveSettingsStep(accountId, step, data, signal)
        if (!signal.aborted) send({ type: 'finished', step, snapshot, data: response.data })
      } catch (error) {
        if (!signal.aborted) send({ type: 'finished', step, snapshot, error })
      } finally {
        inFlight.current.delete(step)
      }
    },
    [accountId, send],
  )

  // Absolute deadlines let another step finish without restarting this step's debounce.
  useEffect(() => {
    if (state.phase !== 'ready' || paused) return
    const timers = []
    for (const step of steps) {
      if (awaitingBilling(state, step)) continue
      const { due, status } = state.saveState[step]
      if (due == null || status === 'saving' || !needsSave(state, step)) continue
      const timer = setTimeout(() => save(step, state.draft[step]), Math.max(0, due - Date.now()))
      timers.push(timer)
    }
    return () => timers.forEach(clearTimeout)
  }, [state, paused, save])

  const schedule = useCallback(
    (step, delay = 800, retry = false) => {
      send({ type: 'schedule', step, delay, retry })
    },
    [send],
  )

  function validate(step, field) {
    const errors = validateStep(step, state.draft[step])
    const visible = field ? { [field]: errors[field] } : errors
    // A valid blur does not erase an error the server attached to the same draft.
    if (!field || errors[field]) send({ type: 'errors', step, errors: visible })
    return Object.keys(errors).length === 0
  }

  async function submit() {
    if (inFlight.current.size || state.phase !== 'ready') return
    const { signal } = lifetime.current
    send({ type: 'submitting' })
    try {
      await submitSettings(accountId, signal)
      if (!signal.aborted) send({ type: 'submitted' })
    } catch (error) {
      if (signal.aborted) return
      const missing = error.detail?.missing_steps || []
      const message = missing.length
        ? 'Save the missing steps before submitting.'
        : 'Couldn’t submit. Try again.'
      send({ type: 'submitError', missing, message })
      return missing[0]
    }
  }

  const saving = steps.some(n => state.saveState[n]?.status === 'saving')
  const waiting = steps.some(
    n => !awaitingBilling(state, n) && state.saveState[n]?.due != null && needsSave(state, n),
  )
  const unsaved =
    state.phase === 'ready' &&
    steps.some(n => {
      if (state.saveState[n].status === 'failed') return true
      return !matches(n, state.draft[n], state.saved[n] || state.original[n])
    })
  return {
    ...state,
    saving,
    unsaved,
    submitDisabled: saving || waiting || state.phase !== 'ready',
    schedule,
    validate,
    retryLoad,
    setPaused,
    submit,
    edit: (step, field, value) => send({ type: 'edit', step, field, value }),
  }
}
