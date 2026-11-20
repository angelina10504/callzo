import { initialDraft, matches, steps, validateStep } from './validation'

export const initialState = {
  phase: 'loading',
  saved: {},
  draft: {},
  errors: {},
  saveState: {},
  missing: [],
}

function stepStatus(state, step, changes) {
  return { ...state.saveState, [step]: { ...state.saveState[step], ...changes } }
}

// Saving step 4 first would make the mock reject even the first billing save.
export function awaitingBilling(state, step) {
  return step === 4 && !state.saved[2] && !state.saved[4]
}

export function needsSave(state, step) {
  const draft = state.draft[step]
  if (!draft || matches(step, draft, state.saved[step])) return false
  return Object.keys(validateStep(step, draft)).length === 0
}

function loaded({ account, saved }) {
  const draft = initialDraft(account, saved)
  const saveState = {}
  for (const step of steps) {
    saveState[step] = { status: saved[step] ? 'saved' : 'idle', at: null, due: null }
  }
  return { ...initialState, phase: 'ready', account, saved, draft, original: draft, saveState }
}

function edited(state, { step, field, value, now }) {
  const draft = { ...state.draft[step], [field]: value }
  const clean = matches(step, draft, state.saved[step])
  const errors = clean || state.saveState[step].rejected ? {} : { ...state.errors[step] }
  delete errors[field]
  let status = clean ? 'saved' : 'idle'
  if (state.saveState[step].status === 'saving') status = 'saving'
  return {
    ...state,
    draft: { ...state.draft, [step]: draft },
    errors: { ...state.errors, [step]: errors },
    saveState: stepStatus(state, step, { status, rejected: false, due: now + 800 }),
  }
}

function saveFinished(state, action) {
  const { step, now, snapshot, data, error } = action
  const newerEdit = state.draft[step] !== snapshot
  const failed = Boolean(error) && !newerEdit
  const saved = data ? { ...state.saved, [step]: data } : state.saved
  const owner = Number(error?.detail?.step) || step
  let errors = state.errors
  if (failed) errors = { ...errors, [owner]: error.detail?.errors || {} }
  if (data && !newerEdit) errors = { ...errors, [step]: {} }

  const missing = data ? state.missing.filter(n => n !== step) : state.missing
  let status = 'idle'
  if (matches(step, state.draft[step], saved[step])) status = 'saved'
  if (failed) status = 'failed'
  return {
    ...state,
    saved,
    errors,
    missing,
    submitError: state.missing.length && !missing.length ? '' : state.submitError,
    saveState: stepStatus(state, step, {
      status,
      rejected: failed && error.status === 422,
      at: data ? now : state.saveState[step].at,
      due: newerEdit ? (state.saveState[step].due ?? now) : null,
    }),
  }
}

export function formReducer(state, action) {
  const { step, now } = action
  switch (action.type) {
    case 'loading':
      return initialState
    case 'loaded':
      return loaded(action)
    case 'loadError':
      return { ...state, phase: 'loadError' }
    case 'edit':
      return edited(state, action)
    case 'errors':
      return {
        ...state,
        errors: {
          ...state.errors,
          [step]: { ...state.errors[step], ...action.errors },
        },
      }
    case 'schedule': {
      if (!needsSave(state, step)) return state
      if (state.saveState[step].status === 'failed' && !action.retry) return state
      return { ...state, saveState: stepStatus(state, step, { due: now + action.delay }) }
    }
    case 'saving':
      return {
        ...state,
        saveState: stepStatus(state, step, {
          status: 'saving',
          due: null,
          rejected: false,
        }),
      }
    case 'finished':
      return saveFinished(state, action)
    case 'submitting':
      return { ...state, phase: 'submitting', submitError: '' }
    case 'submitted':
      return { ...state, phase: 'submitted' }
    case 'submitError': {
      const saved = { ...state.saved }
      const saveState = { ...state.saveState }
      for (const n of action.missing) {
        delete saved[n]
        saveState[n] = { status: 'idle', at: null, due: state.saveState[n].due }
      }
      return {
        ...state,
        phase: 'ready',
        submitError: action.message,
        missing: action.missing,
        saved,
        saveState,
      }
    }
    default:
      throw new Error('Unknown settings action')
  }
}
