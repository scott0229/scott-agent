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
}

export default function CustomSelect({ value, options, onChange, className = '' }: CustomSelectProps) {
    const [open, setOpen] = useState(false)
    const ref = useRef<HTMLDivElement>(null)

    const selectedLabel = options.find((o) => o.value === value)?.label || ''

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
        <div className={`custom-select ${className}`} ref={ref}>
            <button
                type="button"
                className="custom-select-trigger"
                onClick={() => setOpen(!open)}
            >
                <span>{selectedLabel}</span>
                <span className="custom-select-arrow">▾</span>
            </button>
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
