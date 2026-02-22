import { useState, useCallback, useEffect, useRef } from 'react'

const CLOUDFLARE_BASE = 'https://scott-agent.com'
const DEFAULT_API_KEY = 'R1TIoxXSri38FVn63eolduORz-NXUNyqoptyIx07'

export function useTraderSettings() {
    const [marginLimit, setMarginLimitState] = useState<number>(1.3)
    const [watchSymbols, setWatchSymbolsState] = useState<string[]>([])
    const [accountAliases, setAccountAliasesState] = useState<Record<string, string>>({})
    const [accountTypes, setAccountTypesState] = useState<Record<string, string>>({})
    const apiKey = useRef<string>(DEFAULT_API_KEY)
    const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

    // On mount: fetch from Cloudflare D1 (single source of truth)
    useEffect(() => {
        fetch(`${CLOUDFLARE_BASE}/api/trader-settings`)
            .then(r => r.json())
            .then((data: { settings?: Record<string, unknown> }) => {
                if (!data.settings) return
                if (typeof data.settings.margin_limit === 'number') {
                    setMarginLimitState(data.settings.margin_limit)
                }
                if (Array.isArray(data.settings.watch_symbols)) {
                    setWatchSymbolsState(data.settings.watch_symbols as string[])
                }
                if (data.settings.account_aliases && typeof data.settings.account_aliases === 'object' && !Array.isArray(data.settings.account_aliases)) {
                    setAccountAliasesState(data.settings.account_aliases as Record<string, string>)
                }
                if (data.settings.account_types && typeof data.settings.account_types === 'object' && !Array.isArray(data.settings.account_types)) {
                    setAccountTypesState(data.settings.account_types as Record<string, string>)
                }
            })
            .catch(() => { /* offline — use defaults */ })
    }, [])

    function syncToCloud(key: string, value: unknown) {
        const k = apiKey.current
        if (!k) return
        fetch(`${CLOUDFLARE_BASE}/api/trader-settings`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${k}` },
            body: JSON.stringify({ key, value })
        }).catch(() => { /* silently fail */ })
    }

    function debounceSync(key: string, value: unknown) {
        if (saveTimeout.current) clearTimeout(saveTimeout.current)
        saveTimeout.current = setTimeout(() => syncToCloud(key, value), 800)
    }

    const setMarginLimit = useCallback((v: number) => {
        setMarginLimitState(v)
        debounceSync('margin_limit', v)
    }, [])

    const setWatchSymbol = useCallback((index: number, value: string) => {
        setWatchSymbolsState(prev => {
            const next = [...prev]
            next[index] = value
            debounceSync('watch_symbols', next)
            return next
        })
    }, [])

    // Called when IB returns aliases (merges with existing, syncs to cloud)
    const mergeAccountAliases = useCallback((incoming: Record<string, string>) => {
        setAccountAliasesState(prev => {
            const merged = { ...prev, ...incoming }
            debounceSync('account_aliases', merged)
            return merged
        })
    }, [])

    const setAccountType = useCallback((accountId: string, type: string) => {
        setAccountTypesState(prev => {
            const next = { ...prev }
            if (type) {
                next[accountId] = type
            } else {
                delete next[accountId]
            }
            debounceSync('account_types', next)
            return next
        })
    }, [])

    const setApiKey = useCallback((key: string) => {
        apiKey.current = key
    }, [])

    return {
        marginLimit, setMarginLimit,
        watchSymbols, setWatchSymbol,
        accountAliases, mergeAccountAliases,
        accountTypes, setAccountType,
        setApiKey
    }
}
