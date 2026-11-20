import { options } from '../accountFields'
import { countries } from './validation'

const fields = {
  1: [
    { key: 'name', label: 'Name', autoComplete: 'name' },
    { key: 'email', label: 'Email', type: 'email', autoComplete: 'email' },
  ],
  2: [
    { key: 'plan', label: 'Plan', choices: options.plan },
    { key: 'billing_country', label: 'Billing country', choices: countries },
  ],
  3: [
    { key: 'minutes_cap', label: 'Minutes cap (optional)', inputMode: 'numeric' },
    { key: 'sms_cap', label: 'SMS cap (optional)', inputMode: 'numeric' },
  ],
  4: [{ key: 'webhook_url', label: 'Webhook URL (optional)', type: 'url' }],
}

function Field({ field, step, form }) {
  const { key, label, choices, type = 'text', inputMode, autoComplete } = field
  const error = form.errors[step]?.[key]
  const id = 'settings-' + key
  const savedCountry = form.saved[2]?.billing_country
  const rejected =
    key === 'billing_country' && error && form.saveState[step].rejected && savedCountry
  const props = {
    id,
    name: key,
    value: form.draft[step][key],
    required: step < 3,
    'aria-invalid': Boolean(error),
    'aria-describedby': error ? id + '-error' : undefined,
    onChange: e => form.edit(step, key, e.target.value),
    onBlur: () => form.validate(step, key),
  }
  return (
    <div className="settings-field">
      <label htmlFor={id}>{label}</label>
      {choices ? (
        <select {...props}>
          <option value="">Choose…</option>
          {choices.map(option => (
            <option key={option}>{option}</option>
          ))}
        </select>
      ) : (
        <input {...props} type={type} inputMode={inputMode} autoComplete={autoComplete} />
      )}
      {error && (
        <div className="field-error" id={id + '-error'}>
          <p>{error}</p>
          {rejected && (
            <p>
              The server rejected this change. Your previously saved value ({savedCountry}) is still
              on file.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export function StepFields({ step, form }) {
  return (
    <fieldset
      className="settings-fields"
      aria-labelledby="step-title"
      disabled={form.phase === 'submitting'}
    >
      {fields[step].map(field => (
        <Field key={field.key} field={field} step={step} form={form} />
      ))}
    </fieldset>
  )
}
