'use client';

import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { useYearFilter } from '@/contexts/YearFilterContext';

export function YearFilter() {
    const { selectedYear, setSelectedYear } = useYearFilter();

    // Generate year options from 2025 (when the website started) to current year
    const currentYear = new Date().getFullYear();
    const startYear = 2025;
    const years = Array.from(
        { length: currentYear - startYear + 1 },
        (_, i) => currentYear - i
    ); // Show in descending order: 2026, 2025, ...

    return (
        <Select value={selectedYear} onValueChange={setSelectedYear}>
            <SelectTrigger className="w-[120px]">
                <SelectValue placeholder="選擇年份" />
            </SelectTrigger>
            <SelectContent>
                {years.map(year => (
                    <SelectItem key={year} value={year.toString()}>{year}</SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}
