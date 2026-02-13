'use client';

import { createContext, useContext, useState, ReactNode } from 'react';

interface AdminSettings {
    showTradeCode: boolean;
    showPhone: boolean;
    showEmail: boolean;
}

interface AdminSettingsContextType {
    settings: AdminSettings;
    updateSetting: (key: keyof AdminSettings, value: boolean) => void;
}

const STORAGE_KEY = 'scott-agent-admin-settings';

const defaultSettings: AdminSettings = {
    showTradeCode: true,
    showPhone: true,
    showEmail: true,
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

    const updateSetting = (key: keyof AdminSettings, value: boolean) => {
        setSettings(prev => {
            const next = { ...prev, [key]: value };
            if (typeof window !== 'undefined') {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
            }
            return next;
        });
    };

    return (
        <AdminSettingsContext.Provider value={{ settings, updateSetting }}>
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
