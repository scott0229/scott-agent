'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface YearFilterContextType {
    selectedYear: string;
    setSelectedYear: (year: string) => void;
}

const YearFilterContext = createContext<YearFilterContextType | undefined>(undefined);

const YEAR_STORAGE_KEY = 'scott-agent-selected-year';

export function YearFilterProvider({ children }: { children: ReactNode }) {
    const currentYear = new Date().getFullYear();

    // Initialize from localStorage if available, otherwise use current year
    const [selectedYear, setSelectedYearState] = useState<string>(() => {
        // Only access localStorage on client-side
        if (typeof window !== 'undefined') {
            const stored = localStorage.getItem(YEAR_STORAGE_KEY);
            return stored || currentYear.toString();
        }
        return currentYear.toString();
    });

    // Custom setter that also persists to localStorage
    const setSelectedYear = (year: string) => {
        setSelectedYearState(year);
        if (typeof window !== 'undefined') {
            localStorage.setItem(YEAR_STORAGE_KEY, year);
        }
    };

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
