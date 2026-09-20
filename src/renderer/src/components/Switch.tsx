// 左右滑的开关（对齐 4.0.x 的样式），不用勾选框。
export default function Switch({
  checked,
  onChange,
  label,
  hint,
  disabled
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  hint?: string
  disabled?: boolean
}): React.JSX.Element {
  return (
    <label className={'switch-row' + (disabled ? ' disabled' : '')}>
      <span className="switch">
        <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        <span className="slider" />
      </span>
      <span className="switch-text">
        <b>{label}</b>
        {hint && <span className="dim">{hint}</span>}
      </span>
    </label>
  )
}
