import { options } from './accountFields'

export function Filters({ params, update }) {
  return <div className="filters">
    <label>Search accounts
      <input type="search" placeholder="Name, email or company" value={params.search}
        onChange={e => update({ search: e.target.value }, true)} />
    </label>
    {Object.entries(options).map(([key, values]) => (
      <label key={key}>{key[0].toUpperCase() + key.slice(1)}
        <select value={params[key]} onChange={e => update({ [key]: e.target.value })}>
          <option value="">All {key === 'status' ? 'statuses' : key === 'country' ? 'countries' : 'plans'}</option>
          {params[key] && !values.includes(params[key]) && <option>{params[key]}</option>}
          {values.map(value => <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>)}
        </select>
      </label>
    ))}
  </div>
}
