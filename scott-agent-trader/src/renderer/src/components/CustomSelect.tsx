import { useState, useRef, useEffect } from 'react'

interface Option {
  value: string
  label: string
}

interface CustomSelectProps {
  value: string
  options: Option[]
  onChange: (value: string) => void
  className?: string
  // When provided, renders ‹ › step buttons flanking the trigger that share
  // its border. Used by the account filter to let the user cycle through
  // accounts without opening the dropdown.
  onPrev?: () => void
  onNext?: () => void
}

export default function CustomSelect({
  value,
  options,
  onChange,
  className = '',
  onPrev,
  onNext
}: CustomSelectProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const selectedLabel = options.find((o) => o.value === value)?.label || ''
  const showSteppers = !!(onPrev || onNext)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div
      className={`custom-select ${className} ${showSteppers ? 'with-steppers' : ''}`}
      ref={ref}
    >
      {onPrev && (
        <button
          type="button"
          className="custom-select-step custom-select-step-prev"
          title="上一個"
          onClick={(e) => {
            e.stopPropagation()
            onPrev()
          }}
        >
          ‹
        </button>
      )}
      <button type="button" className="custom-select-trigger" onClick={() => setOpen(!open)}>
        <span>{selectedLabel}</span>
        {/* The ‹ › steppers already convey it's cyclable — drop the ▾ and
            centre the label in that mode. */}
        {!showSteppers && <span className="custom-select-arrow">▾</span>}
      </button>
      {onNext && (
        <button
          type="button"
          className="custom-select-step custom-select-step-next"
          title="下一個"
          onClick={(e) => {
            e.stopPropagation()
            onNext()
          }}
        >
          ›
        </button>
      )}
      {open && (
        <div className="custom-select-dropdown">
          {options.map((opt) => (
            <div
              key={opt.value}
              className={`custom-select-option ${opt.value === value ? 'selected' : ''}`}
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
