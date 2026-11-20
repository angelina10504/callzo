import { number } from './accountFields'

export function SelectionBar({ selected, clear }) {
  return <div className="flex items-center gap-3">
    <span>{number.format(selected.size)} selected</span>
    <button className="text-button" onClick={clear} disabled={!selected.size}>Clear selection</button>
  </div>
}
