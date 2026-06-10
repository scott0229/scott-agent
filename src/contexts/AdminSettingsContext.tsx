'use client';

import { createContext, useContext, useState, ReactNode } from 'react';

interface AdminSettings {
    showTradeCode: boolean;
    showPhone: boolean;
    showEmail: boolean;
    showPremium: boolean;
    premiumTargetPercent: number;
    includeStockDiffInPremium: boolean;
    reportCcEmail1?: string;
    reportCcEnabled1?: boolean;
    reportCcEmail2?: string;
    reportCcEnabled2?: boolean;
    reportCcEmail3?: string;
    reportCcEnabled3?: boolean;
    reportCcEmail4?: string;
    reportCcEnabled4?: boolean;
    // BCC 寄出報告 內容選項 (multi-select). Default both on so existing
    // recipients keep seeing the full report.
    bccIncludeTradeAdvice?: boolean;
    bccIncludeDailyOps?: boolean;
}

interface AdminSettingsContextType {
    settings: AdminSettings;
    updateSetting: (key: keyof AdminSettings, value: boolean | number | string) => void;
    setAllSettings: (newSettings: Partial<AdminSettings>) => void;
}

const STORAGE_KEY = 'scott-agent-admin-settings';

const defaultSettings: AdminSettings = {
    showTradeCode: true,
    showPhone: true,
    showEmail: true,
    showPremium: true,
    premiumTargetPercent: 4,
    includeStockDiffInPremium: true,
    reportCcEmail1: '',
    reportCcEnabled1: true,
    reportCcEmail2: '',
    reportCcEnabled2: true,
    reportCcEmail3: '',
    reportCcEnabled3: true,
    reportCcEmail4: '',
    reportCcEnabled4: true,
    bccIncludeTradeAdvice: true,
    bccIncludeDailyOps: true,
};

const AdminSettingsContext = createContext<AdminSettingsContextType | undefined>(undefined);

function loadSettings(): AdminSettings {
    if (typeof window === 'undefined') return defaultSettings;
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            return { ...defaultSettings, ...JSON.parse(stored) };
        }
    } catch (e) {
        // ignore parse errors
    }
    return defaultSettings;
}

export function AdminSettingsProvider({ children }: { children: ReactNode }) {
    const [settings, setSettings] = useState<AdminSettings>(loadSettings);

    const updateSetting = (key: keyof AdminSettings, value: boolean | number | string) => {
        setSettings(prev => {
            const next = { ...prev, [key]: value };
            if (typeof window !== 'undefined') {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
            }
            return next;
        });
    };

    const setAllSettings = (newSettings: Partial<AdminSettings>) => {
        setSettings(prev => {
            const next = { ...prev, ...newSettings };
            if (typeof window !== 'undefined') {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
            }
            return next;
        });
    };

    return (
        <AdminSettingsContext.Provider value={{ settings, updateSetting, setAllSettings }}>
            {children}
        </AdminSettingsContext.Provider>
    );
}

export function useAdminSettings() {
    const context = useContext(AdminSettingsContext);
    if (context === undefined) {
        throw new Error('useAdminSettings must be used within an AdminSettingsProvider');
    }
    return context;
}
