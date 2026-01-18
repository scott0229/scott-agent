import * as React from "react"
import { Check } from "lucide-react"
import { cn } from "@/lib/utils"

// Lite version without Radix dependency
const Checkbox = React.forwardRef<
    HTMLInputElement,
    React.InputHTMLAttributes<HTMLInputElement> & {
        onCheckedChange?: (checked: boolean) => void
    }
>(({ className, checked, onCheckedChange, disabled, ...props }, ref) => {
    return (
        <div className="relative flex items-center">
            <input
                type="checkbox"
                ref={ref}
                className="peer h-4 w-4 shrink-0 opacity-0 absolute cursor-pointer disabled:cursor-not-allowed"
                checked={!!checked}
                onChange={(e) => onCheckedChange?.(e.target.checked)}
                disabled={disabled}
                {...props}
            />
            <div
                className={cn(
                    "h-4 w-4 shrink-0 rounded-sm border border-primary shadow focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground flex items-center justify-center",
                    checked ? "bg-primary text-primary-foreground" : "bg-background",
                    className
                )}
            >
                {checked && <Check className="h-3 w-3" />}
            </div>
        </div>
    )
})
Checkbox.displayName = "Checkbox"

export { Checkbox }
