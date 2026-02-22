import { useState, useCallback, useEffect, useRef } from 'react'

const CLOUDFLARE_BASE = 'https://scott-agent.com'
const API_KEY_STORAGE = 'scott-trader-api-key'
const DEFAULT_API_KEY = 'R1TIoxXSri38FVn63eolduORz-NXUNyqoptyIx07'
const MARGIN_KEY = 'scott-trader-margin-limit'
const SYMBOLS_KEY = 'scott-trader-watch-symbols'
const ALIASES_KEY = 'scott-trader-account-aliases'
const TYPES_KEY = 'scott-trader-account-types'

function loadLocal() {
    let marginLimit = 1.3
    let watchSymbols: string[] = []
    let accountAliases: Record<string, string> = {}
    let accountTypes: Record<string, string> = {}
    try {
        const raw = localStorage.getItem(MARGIN_KEY)
        if (raw) marginLimit = parseFloat(raw) || 1.3
    } catch { /* ignore */ }
    try {
        watchSymbols = JSON.parse(localStorage.getItem(SYMBOLS_KEY) || '[]')
    } catch { /* ignore */ }
    try {
        accountAliases = JSON.parse(localStorage.getItem(ALIASES_KEY) || '{}')
    } catch { /* ignore */ }
    try {
        accountTypes = JSON.parse(localStorage.getItem(TYPES_KEY) || '{}')
    } catch { /* ignore */ }
    return { marginLimit, watchSymbols, accountAliases, accountTypes }
}

export function useTraderSettings() {
    const local = loadLocal()
    const [marginLimit, setMarginLimitState] = useState<number>(local.marginLimit)
    const [watchSymbols, setWatchSymbolsState] = useState<string[]>(local.watchSymbols)
    const [accountAliases, setAccountAliasesState] = useState<Record<string, string>>(local.accountAliases)
    const [accountTypes, setAccountTypesState] = useState<Record<string, string>>(local.accountTypes)
    const apiKey = useRef<string>(localStorage.getItem(API_KEY_STORAGE) || DEFAULT_API_KEY)
    const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

    // On mount: fetch from Cloudflare (Cloudflare wins)
    useEffect(() => {
        fetch(`${CLOUDFLARE_BASE}/api/trader-settings`)
            .then(r => r.json())
            .then((data: { settings?: Record<string, unknown> }) => {
                if (!data.settings) return
                if (typeof data.settings.margin_limit === 'number') {
                    setMarginLimitState(data.settings.margin_limit)
                    localStorage.setItem(MARGIN_KEY, String(data.settings.margin_limit))
                }
                if (Array.isArray(data.settings.watch_symbols)) {
                    setWatchSymbolsState(data.settings.watch_symbols as string[])
                    localStorage.setItem(SYMBOLS_KEY, JSON.stringify(data.settings.watch_symbols))
                }
                if (data.settings.account_aliases && typeof data.settings.account_aliases === 'object' && !Array.isArray(data.settings.account_aliases)) {
                    const aliases = data.settings.account_aliases as Record<string, string>
                    setAccountAliasesState(aliases)
                    localStorage.setItem(ALIASES_KEY, JSON.stringify(aliases))
                }
                if (data.settings.account_types && typeof data.settings.account_types === 'object' && !Array.isArray(data.settings.account_types)) {
                    const types = data.settings.account_types as Record<string, string>
                    setAccountTypesState(types)
                    localStorage.setItem(TYPES_KEY, JSON.stringify(types))
                }
            })
            .catch(() => { /* offline — use local */ })
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
        localStorage.setItem(MARGIN_KEY, String(v))
        debounceSync('margin_limit', v)
    }, [])

    const setWatchSymbol = useCallback((index: number, value: string) => {
        setWatchSymbolsState(prev => {
            const next = [...prev]
            next[index] = value
            localStorage.setItem(SYMBOLS_KEY, JSON.stringify(next))
            debounceSync('watch_symbols', next)
            return next
        })
    }, [])

    // Called when IB returns aliases (merges with existing, syncs to cloud)
    const mergeAccountAliases = useCallback((incoming: Record<string, string>) => {
        setAccountAliasesState(prev => {
            const merged = { ...prev, ...incoming }
            localStorage.setItem(ALIASES_KEY, JSON.stringify(merged))
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
            localStorage.setItem(TYPES_KEY, JSON.stringify(next))
            debounceSync('account_types', next)
            return next
        })
    }, [])

    const setApiKey = useCallback((key: string) => {
        apiKey.current = key
        localStorage.setItem(API_KEY_STORAGE, key)
    }, [])

    return {
        marginLimit, setMarginLimit,
        watchSymbols, setWatchSymbol,
        accountAliases, mergeAccountAliases,
        accountTypes, setAccountType,
        setApiKey
    }
}
