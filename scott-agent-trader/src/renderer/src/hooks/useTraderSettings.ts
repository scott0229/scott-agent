import { useState, useCallback, useEffect, useRef } from 'react'

export interface SymbolGroup {
  id: string
  name: string
  symbol: string
  posKeys: string[]
  createdAt: number
}

declare global {
  interface Window {
    ibApi: {
      getSettings: (d1Target?: string) => Promise<{ settings?: Record<string, unknown> }>
      putSettings: (key: string, value: unknown, d1Target?: string) => Promise<any>
      [key: string]: any
    }
  }
}

export function useTraderSettings() {
  const [marginLimit, setMarginLimitState] = useState<number>(1.3)
  const [watchSymbols, setWatchSymbolsState] = useState<string[]>([])
  const [accountAliases, setAccountAliasesState] = useState<Record<string, string>>({})
  const [accountTypes, setAccountTypesState] = useState<Record<string, string>>({})
  const [symbolPrefetch, setSymbolPrefetchState] = useState<Record<string, boolean>>({})
  const [d1Target, setD1TargetState] = useState<'staging' | 'production'>('staging')
  const [symbolGroups, setSymbolGroupsState] = useState<SymbolGroup[]>([])
  const fetchedRef = useRef(false)
  const settingsLoadedRef = useRef(false)
  const d1TargetRef = useRef(d1Target)

  const applySettings = useCallback((data: { settings?: Record<string, unknown> }) => {
    if (!data.settings) return
    settingsLoadedRef.current = true
    if (typeof data.settings.margin_limit === 'number') {
      setMarginLimitState(data.settings.margin_limit)
    }
    if (Array.isArray(data.settings.watch_symbols)) {
      setWatchSymbolsState(data.settings.watch_symbols as string[])
    }
    if (
      data.settings.account_aliases &&
      typeof data.settings.account_aliases === 'object' &&
      !Array.isArray(data.settings.account_aliases)
    ) {
      setAccountAliasesState(data.settings.account_aliases as Record<string, string>)
    }
    if (
      data.settings.account_types &&
      typeof data.settings.account_types === 'object' &&
      !Array.isArray(data.settings.account_types)
    ) {
      setAccountTypesState(data.settings.account_types as Record<string, string>)
    }
    if (
      data.settings.symbol_prefetch &&
      typeof data.settings.symbol_prefetch === 'object' &&
      !Array.isArray(data.settings.symbol_prefetch)
    ) {
      setSymbolPrefetchState(
        data.settings.symbol_prefetch as Record<string, boolean>
      )
    }
    if (data.settings.d1_target === 'staging' || data.settings.d1_target === 'production') {
      setD1TargetState(data.settings.d1_target)
    }
    if (Array.isArray(data.settings.symbol_groups)) {
      setSymbolGroupsState(data.settings.symbol_groups as SymbolGroup[])
    }
  }, [])

  // On mount: fetch settings via IPC (proxied through main process to bypass CORS)
  useEffect(() => {
    if (fetchedRef.current) return
    fetchedRef.current = true
    window.ibApi
      .getSettings(d1Target)
      .then(applySettings)
      .catch(() => {
        /* offline — use defaults */
      })
  }, [applySettings, d1Target])

  // Re-fetch settings (called after group detection so we load the correct group's settings)
  const refetchSettings = useCallback(() => {
    window.ibApi
      .getSettings(d1Target)
      .then(applySettings)
      .catch(() => {})
  }, [applySettings, d1Target])

  // Save ALL settings to cloud at once (called when settings panel closes)
  // Guard: only save if settings were successfully loaded to prevent overwriting real data with empty defaults
  const saveAllSettings = useCallback(() => {
    if (!settingsLoadedRef.current) {
      console.warn('[Settings] Skipping save — settings not yet loaded')
      return
    }
    window.ibApi.putSettings('margin_limit', marginLimit, d1Target).catch(() => {})
    window.ibApi.putSettings('watch_symbols', watchSymbols, d1Target).catch(() => {})
    window.ibApi.putSettings('account_aliases', accountAliases, d1Target).catch(() => {})
    window.ibApi.putSettings('account_types', accountTypes, d1Target).catch(() => {})
    window.ibApi.putSettings('symbol_prefetch', symbolPrefetch, d1Target).catch(() => {})
    window.ibApi.putSettings('d1_target', d1Target, d1Target).catch(() => {})
  }, [marginLimit, watchSymbols, accountAliases, accountTypes, symbolPrefetch, d1Target])

  const setMarginLimit = useCallback((v: number) => {
    setMarginLimitState(v)
  }, [])

  const setWatchSymbol = useCallback((index: number, value: string) => {
    setWatchSymbolsState((prev) => {
      const next = [...prev]
      next[index] = value
      return next
    })
  }, [])

  // Called when IB returns aliases (merges with existing, syncs to cloud immediately)
  const mergeAccountAliases = useCallback((incoming: Record<string, string>) => {
    setAccountAliasesState((prev) => {
      const merged = { ...prev, ...incoming }
      // Auto-sync aliases since they come from IB, not from user settings panel
      window.ibApi.putSettings('account_aliases', merged, d1TargetRef.current).catch(() => {})
      return merged
    })
  }, [])

  const setAccountType = useCallback((accountId: string, type: string) => {
    setAccountTypesState((prev) => {
      const next = { ...prev }
      if (type) {
        next[accountId] = type
      } else {
        delete next[accountId]
      }
      window.ibApi.putSettings('account_types', next, d1TargetRef.current).catch(() => {})
      return next
    })
  }, [])

  const setSymbolPrefetch = useCallback((symbol: string, enabled: boolean) => {
    setSymbolPrefetchState((prev) => {
      const next = { ...prev, [symbol]: enabled }
      window.ibApi.putSettings('symbol_prefetch', next, d1TargetRef.current).catch(() => {})
      return next
    })
  }, [])

  const setD1Target = useCallback((v: 'staging' | 'production') => {
    setD1TargetState(v)
    d1TargetRef.current = v
    window.ibApi.putSettings('d1_target', v, v).catch(() => {})
  }, [])

  const addSymbolGroup = useCallback((group: SymbolGroup) => {
    setSymbolGroupsState((prev) => {
      const next = [...prev, group]
      window.ibApi.putSettings('symbol_groups', next, d1TargetRef.current).catch(() => {})
      return next
    })
  }, [])

  const deleteSymbolGroup = useCallback((groupId: string) => {
    setSymbolGroupsState((prev) => {
      const next = prev.filter((g) => g.id !== groupId)
      window.ibApi.putSettings('symbol_groups', next, d1TargetRef.current).catch(() => {})
      return next
    })
  }, [])

  const updateSymbolGroup = useCallback((updated: SymbolGroup) => {
    setSymbolGroupsState((prev) => {
      const next = prev.map((g) => (g.id === updated.id ? updated : g))
      window.ibApi.putSettings('symbol_groups', next, d1TargetRef.current).catch(() => {})
      return next
    })
  }, [])

  const reorderSymbolGroups = useCallback((reordered: SymbolGroup[]) => {
    setSymbolGroupsState(reordered)
    window.ibApi.putSettings('symbol_groups', reordered, d1TargetRef.current).catch(() => {})
  }, [])

  return {
    marginLimit,
    setMarginLimit,
    watchSymbols,
    setWatchSymbol,
    accountAliases,
    mergeAccountAliases,
    accountTypes,
    setAccountType,
    symbolPrefetch,
    setSymbolPrefetch,
    d1Target,
    setD1Target,
    symbolGroups,
    addSymbolGroup,
    deleteSymbolGroup,
    updateSymbolGroup,
    reorderSymbolGroups,

    refetchSettings,
    saveAllSettings
  }
}
