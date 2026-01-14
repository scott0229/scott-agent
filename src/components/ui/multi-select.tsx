'use client';

import * as React from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface MultiSelectProps {
    options: { value: string; label: string }[];
    selected: string[];
    onChange: (selected: string[]) => void;
    placeholder?: string;
    className?: string;
}

export function MultiSelect({
    options,
    selected,
    onChange,
    placeholder = '選擇選項',
    className,
}: MultiSelectProps) {
    const [open, setOpen] = React.useState(false);
    const containerRef = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, []);

    const handleToggle = (value: string) => {
        const newSelected = selected.includes(value)
            ? selected.filter((v) => v !== value)
            : [...selected, value];
        onChange(newSelected);
    };

    const displayText = React.useMemo(() => {
        if (selected.length === 0) {
            return '全部用戶';
        }
        if (selected.length === 1) {
            const option = options.find((opt) => opt.value === selected[0]);
            return option?.label || '已選 1 位用戶';
        }
        return `已選 ${selected.length} 位用戶`;
    }, [selected, options]);

    return (
        <div className={cn("relative inline-block text-left", className)} ref={containerRef}>
            <Button
                type="button"
                variant="outline"
                className="w-full justify-between font-normal"
                onClick={() => setOpen(!open)}
            >
                {displayText}
                <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>

            {open && (
                <div className="absolute left-0 mt-2 w-full min-w-[200px] origin-top-left rounded-md border bg-popover p-1 text-popover-foreground shadow-md outline-none z-50 animate-in fade-in-0 zoom-in-95">
                    <div className="max-h-64 overflow-auto">
                        <div
                            className={cn(
                                'relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground',
                                selected.length === 0 && 'bg-accent'
                            )}
                            onClick={() => {
                                onChange([]);
                                setOpen(false);
                            }}
                        >
                            <Check
                                className={cn(
                                    'mr-2 h-4 w-4',
                                    selected.length === 0 ? 'opacity-100' : 'opacity-0'
                                )}
                            />
                            全部用戶
                        </div>
                        <div className="h-px bg-muted my-1" />
                        {options.map((option) => (
                            <div
                                key={option.value}
                                className={cn(
                                    'relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground',
                                    selected.includes(option.value) && 'bg-accent'
                                )}
                                onClick={() => handleToggle(option.value)}
                            >
                                <Check
                                    className={cn(
                                        'mr-2 h-4 w-4',
                                        selected.includes(option.value) ? 'opacity-100' : 'opacity-0'
                                    )}
                                />
                                {option.label}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
