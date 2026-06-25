import { useState, useCallback, useEffect, useRef } from 'react'
import {
  collectTraderPrefs,
  hydrateTraderPrefs,
  hasUserPrefs,
  onPrefChange
} from '../lib/prefsSync'
import { posKeysFromLegs, type GroupLeg } from '../lib/groupLegs'

export type { GroupLeg }

// How long after a local symbol_groups write to ignore refetched values, so a
// stale D1 read-replica can't overwrite a fresh local edit (e.g. the post-roll
// posKey swap). Comfortably longer than replication lag.
const GROUP_WRITE_GUARD_MS = 15000

export interface SymbolGroup {
  id: string
  name: string
  symbol: string
  // Legacy membership: contract identities (no quantity). Now DERIVED from
  // `legs` (dual-written) for back-compat so an older app instance still
  // reads the group. New code should read `legs` for manual groups.
  posKeys: string[]
  // Quantity-allocation membership for MANUAL groups: each leg is a claim of
  // a signed quantity on an (account, contract). Lets two groups split one
  // aggregated IB position. Auto groups (autoParams) have no legs.
  legs?: GroupLeg[]
  createdAt: number
  completedDate?: string // YYYY-MM-DD format, marks "今日已完成操作"
  // Free-form note shown above the batch-card body, edited inline.
  note?: string
  autoParams?: {
    symbols: string[]
    right?: string // legacy 'STK' | 'C' | 'P' | ''
    rights?: string[]
    accounts?: string[]
  }
  // 展期觀察: up to 3 observed roll targets (each a "B" leg). The "A" leg is the
  // group's current option; the card shows one A→B row per target with live
  // bid/ask/mid. Legacy single-object values are still accepted on read.
  rollWatch?:
    | Array<{ expiry: string; strike: number; right: 'C' | 'P' }>
    | { expiry: string; strike: number; right: 'C' | 'P' }
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
  const [d1Target, setD1TargetState] = useState<'staging' | 'production'>('production')
  const [symbolGroups, setSymbolGroupsState] = useState<SymbolGroup[]>([])
  const [showOperationMode, setShowOperationModeState] = useState<boolean>(true)
  const [showAccountType, setShowAccountTypeState] = useState<boolean>(true)
  // Bumped when risk/observe prefs are hydrated from D1, so synchronous
  // consumers (e.g. the observe-rule chunks) re-read the freshly-synced values.
  const [prefsVersion, setPrefsVersion] = useState(0)
  const fetchedRef = useRef(false)
  const settingsLoadedRef = useRef(false)
  const d1TargetRef = useRef(d1Target)
  // Timestamp of the last LOCAL symbol_groups write. Used to ignore a refetch
  // that would otherwise clobber a just-made local edit with stale data (see
  // applySettings). The window must comfortably exceed D1's read-replica
  // replication lag so a getSettings firing right after a putSettings can't
  // read the pre-write value and overwrite the local one.
  const lastGroupWriteRef = useRef(0)

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
      setSymbolPrefetchState(data.settings.symbol_prefetch as Record<string, boolean>)
    }
    // NOTE: We intentionally do NOT read data.settings.d1_target here. The app
    // is production-only now; honouring a stored 'staging' value would flip the
    // live target to staging and refetch STALE staging data — overwriting the
    // real production settings (this caused deleted symbol_groups to reappear).
    // Don't clobber a just-edited local symbol_groups with a refetch. Group
    // edits — especially the post-roll posKey swap — persist to D1, but a
    // getSettings that fires right after (on reconnect / group re-detection)
    // can read a STALE D1 replica and overwrite the fix, permanently emptying
    // the batch ("無匹配持倉") since nothing re-applies it once the roll's
    // pendingRollUpdate has cleared. Skip the overwrite within a short window
    // of a local write; genuine remote edits resync once the window elapses.
    if (Array.isArray(data.settings.symbol_groups)) {
      const sinceWrite = Date.now() - lastGroupWriteRef.current
      if (sinceWrite > GROUP_WRITE_GUARD_MS) {
        const msg = {
          sinceLastLocalWriteMs: sinceWrite,
          count: (data.settings.symbol_groups as SymbolGroup[]).length
        }
        console.log('[settings] applying refetched symbol_groups', msg)
        window.ibApi.debugLog('[settings] applying symbol_groups ' + JSON.stringify(msg))
        setSymbolGroupsState(data.settings.symbol_groups as SymbolGroup[])
      } else {
        const msg = { sinceLastLocalWriteMs: sinceWrite }
        console.log('[settings] SKIPPED refetched symbol_groups (recent local write)', msg)
        window.ibApi.debugLog('[settings] skipped symbol_groups ' + JSON.stringify(msg))
      }
    }
    if (typeof data.settings.show_operation_mode === 'boolean') {
      setShowOperationModeState(data.settings.show_operation_mode)
    }
    if (typeof data.settings.show_account_type === 'boolean') {
      setShowAccountTypeState(data.settings.show_account_type)
    }
    // Risk thresholds + observe rules: D1 is the source of truth. If present,
    // hydrate localStorage from it and force consumers to re-read. If absent
    // but THIS device has user-tuned values, seed D1 from them (one-time
    // migration; guarded so a fresh/empty device never wipes the synced blob).
    const tp = data.settings.trader_prefs
    if (tp && typeof tp === 'object' && !Array.isArray(tp)) {
      if (hydrateTraderPrefs(tp as Record<string, unknown>)) {
        setPrefsVersion((v) => v + 1)
      }
    } else if (hasUserPrefs()) {
      window.ibApi
        .putSettings('trader_prefs', collectTraderPrefs(), d1TargetRef.current)
        .catch(() => {})
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

  // Push risk/observe prefs to D1 whenever a setter fires, debounced so rapid
  // edits coalesce. Guarded by settingsLoadedRef so we never overwrite real D1
  // data with empty defaults before the initial load completes.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const off = onPrefChange(() => {
      if (!settingsLoadedRef.current) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        window.ibApi
          .putSettings('trader_prefs', collectTraderPrefs(), d1TargetRef.current)
          .catch(() => {})
      }, 800)
    })
    return () => {
      if (timer) clearTimeout(timer)
      off()
    }
  }, [])

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
    window.ibApi.putSettings('show_operation_mode', showOperationMode, d1Target).catch(() => {})
    window.ibApi.putSettings('show_account_type', showAccountType, d1Target).catch(() => {})
  }, [marginLimit, watchSymbols, accountAliases, accountTypes, symbolPrefetch, d1Target, showOperationMode, showAccountType])

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

  // Dual-write: when a (manual) group carries `legs`, keep `posKeys` in sync
  // so an older app instance still reads the group correctly.
  const normalizeGroup = (g: SymbolGroup): SymbolGroup =>
    g.legs ? { ...g, posKeys: posKeysFromLegs(g.legs) } : g

  const addSymbolGroup = useCallback((group: SymbolGroup) => {
    lastGroupWriteRef.current = Date.now()
    setSymbolGroupsState((prev) => {
      const next = [...prev, normalizeGroup(group)]
      window.ibApi.putSettings('symbol_groups', next, d1TargetRef.current).catch(() => {})
      return next
    })
  }, [])

  const deleteSymbolGroup = useCallback((groupId: string) => {
    lastGroupWriteRef.current = Date.now()
    setSymbolGroupsState((prev) => {
      const next = prev.filter((g) => g.id !== groupId)
      window.ibApi.putSettings('symbol_groups', next, d1TargetRef.current).catch(() => {})
      return next
    })
  }, [])

  const updateSymbolGroup = useCallback((updated: SymbolGroup) => {
    lastGroupWriteRef.current = Date.now()
    setSymbolGroupsState((prev) => {
      const norm = normalizeGroup(updated)
      const next = prev.map((g) => (g.id === norm.id ? norm : g))
      window.ibApi.putSettings('symbol_groups', next, d1TargetRef.current).catch(() => {})
      return next
    })
  }, [])

  const reorderSymbolGroups = useCallback((reordered: SymbolGroup[]) => {
    lastGroupWriteRef.current = Date.now()
    const next = reordered.map(normalizeGroup)
    setSymbolGroupsState(next)
    window.ibApi.putSettings('symbol_groups', next, d1TargetRef.current).catch(() => {})
  }, [])

  const setShowOperationMode = useCallback((v: boolean) => setShowOperationModeState(v), [])
  const setShowAccountType = useCallback((v: boolean) => setShowAccountTypeState(v), [])

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
    showOperationMode,
    setShowOperationMode,
    showAccountType,
    setShowAccountType,
    prefsVersion,

    refetchSettings,
    saveAllSettings
  }
}
