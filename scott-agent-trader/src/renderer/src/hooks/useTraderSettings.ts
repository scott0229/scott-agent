import { useState, useCallback, useEffect, useRef } from 'react'

declare global {
  interface Window {
    ibApi: {
      getSettings: () => Promise<{ settings?: Record<string, unknown> }>
      putSettings: (key: string, value: unknown) => Promise<any>
      [key: string]: any
    }
  }
}

export function useTraderSettings() {
  const [marginLimit, setMarginLimitState] = useState<number>(1.3)
  const [watchSymbols, setWatchSymbolsState] = useState<string[]>([])
  const [accountAliases, setAccountAliasesState] = useState<Record<string, string>>({})
  const [accountTypes, setAccountTypesState] = useState<Record<string, string>>({})
  const [symbolOptionTypes, setSymbolOptionTypesState] = useState<
    Record<string, { cc: boolean; pp: boolean }>
  >({})
  const [d1Target, setD1TargetState] = useState<'staging' | 'production'>('staging')
  const fetchedRef = useRef(false)

  const applySettings = useCallback((data: { settings?: Record<string, unknown> }) => {
    if (!data.settings) return
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
      data.settings.symbol_option_types &&
      typeof data.settings.symbol_option_types === 'object' &&
      !Array.isArray(data.settings.symbol_option_types)
    ) {
      setSymbolOptionTypesState(
        data.settings.symbol_option_types as Record<string, { cc: boolean; pp: boolean }>
      )
    }
    if (
      data.settings.d1_target === 'staging' ||
      data.settings.d1_target === 'production'
    ) {
      setD1TargetState(data.settings.d1_target)
    }
  }, [])

  // On mount: fetch settings via IPC (proxied through main process to bypass CORS)
  useEffect(() => {
    if (fetchedRef.current) return
    fetchedRef.current = true
    window.ibApi
      .getSettings()
      .then(applySettings)
      .catch(() => {
        /* offline — use defaults */
      })
  }, [applySettings])

  // Re-fetch settings (called after group detection so we load the correct group's settings)
  const refetchSettings = useCallback(() => {
    window.ibApi
      .getSettings()
      .then(applySettings)
      .catch(() => {})
  }, [applySettings])

  // Save ALL settings to cloud at once (called when settings panel closes)
  const saveAllSettings = useCallback(() => {
    window.ibApi.putSettings('margin_limit', marginLimit).catch(() => {})
    window.ibApi.putSettings('watch_symbols', watchSymbols).catch(() => {})
    window.ibApi.putSettings('account_aliases', accountAliases).catch(() => {})
    window.ibApi.putSettings('account_types', accountTypes).catch(() => {})
    window.ibApi.putSettings('symbol_option_types', symbolOptionTypes).catch(() => {})
    window.ibApi.putSettings('d1_target', d1Target).catch(() => {})
  }, [marginLimit, watchSymbols, accountAliases, accountTypes, symbolOptionTypes, d1Target])

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
      window.ibApi.putSettings('account_aliases', merged).catch(() => {})
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
      window.ibApi.putSettings('account_types', next).catch(() => {})
      return next
    })
  }, [])

  const setSymbolOptionType = useCallback((symbol: string, type: 'cc' | 'pp', enabled: boolean) => {
    setSymbolOptionTypesState((prev) => {
      const current = prev[symbol] || { cc: true, pp: true }
      const next = { ...prev, [symbol]: { ...current, [type]: enabled } }
      window.ibApi.putSettings('symbol_option_types', next).catch(() => {})
      return next
    })
  }, [])

  const setD1Target = useCallback((v: 'staging' | 'production') => {
    setD1TargetState(v)
    window.ibApi.putSettings('d1_target', v).catch(() => {})
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
    symbolOptionTypes,
    setSymbolOptionType,
    d1Target,
    setD1Target,

    refetchSettings,
    saveAllSettings
  }
}

