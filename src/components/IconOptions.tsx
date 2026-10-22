import type { ReactNode } from 'react'

interface IconOption<T extends string> {
  value: T
  label: string
  icon: ReactNode
}

interface IconOptionsProps<T extends string> {
  options: IconOption<T>[]
  value: T
  onChange: (value: T) => void
}

export function IconOptions<T extends string>({ options, value, onChange }: IconOptionsProps<T>) {
  return (
    <div className="icon-options" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          aria-label={o.label}
          title={o.label}
          className={`icon-option${o.value === value ? ' active' : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.icon}
        </button>
      ))}
    </div>
  )
}
