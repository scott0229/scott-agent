'use client';

import { createContext, useContext, useState, ReactNode } from 'react';

interface YearFilterContextType {
    selectedYear: string;
    setSelectedYear: (year: string) => void;
}

const YearFilterContext = createContext<YearFilterContextType | undefined>(undefined);

export function YearFilterProvider({ children }: { children: ReactNode }) {
    // Default to current year instead of 'All'
    const currentYear = new Date().getFullYear();
    const [selectedYear, setSelectedYear] = useState<string>(currentYear.toString());

    return (
        <YearFilterContext.Provider value={{ selectedYear, setSelectedYear }}>
            {children}
        </YearFilterContext.Provider>
    );
}

export function useYearFilter() {
    const context = useContext(YearFilterContext);
    if (context === undefined) {
        throw new Error('useYearFilter must be used within a YearFilterProvider');
    }
    return context;
}
