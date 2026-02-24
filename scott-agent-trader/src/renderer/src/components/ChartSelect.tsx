import React, { useState, useRef, useEffect } from 'react'

interface ChartSelectProps {
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
}

export default function ChartSelect({ value, onChange, options }: ChartSelectProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const selectedLabel = options.find((o) => o.value === value)?.label ?? value

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div className="chart-select" ref={ref}>
      <button type="button" className="chart-select-trigger" onClick={() => setOpen(!open)}>
        <span>{selectedLabel}</span>
        <svg
          className={`chart-select-chevron ${open ? 'open' : ''}`}
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div className="chart-select-dropdown">
          {options.map((opt) => (
            <div
              key={opt.value}
              className={`chart-select-option ${opt.value === value ? 'selected' : ''}`}
              onClick={() => {
                onChange(opt.value)
                setOpen(false)
              }}
            >
              {opt.label}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
