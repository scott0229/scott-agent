import React from 'react'
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import ConnectionStatus from './components/ConnectionStatus'
import AccountOverview from './components/AccountOverview'
import OptionOrderForm from './components/OptionOrderForm'
import SettingsPanel from './components/SettingsPanel'
import { useAccountStore } from './hooks/useAccountStore'
import { useTraderSettings } from './hooks/useTraderSettings'
import './assets/app.css'

const HIDDEN_ACCOUNTS_PREFIX = 'scott-trader-hidden-accounts'

// Lightweight US-Eastern wall clock for the header. Ticks every 15 s so the
// minute display stays accurate without rerendering more than needed.
function EtClock(): React.JSX.Element {
  const [now, setNow] = useState<Date>(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 15_000)
    return () => clearInterval(id)
  }, [])
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(now)
  const get = (t: string): string => parts.find((p) => p.type === t)?.value || ''
  return (
    <span className="et-clock" title="美東時間 (US Eastern)">
      <span className="et-clock-label">美東</span>
      {get('month')}-{get('day')} {get('hour')}:{get('minute')}
    </span>
  )
}

// Hidden accounts are GLOBAL (not per-port). Account ids are globally unique,
// and keying by port meant the hidden set didn't carry over when connecting
// via a different port (TWS vs Gateway, paper vs live) or on reopen.
function loadHiddenAccounts(): Set<string> {
  try {
    const raw = localStorage.getItem(HIDDEN_ACCOUNTS_PREFIX)
    if (raw) return new Set(JSON.parse(raw))
  } catch {
    /* ignore */
  }
  return new Set()
}

function saveHiddenAccounts(set: Set<string>): void {
  try {
    localStorage.setItem(HIDDEN_ACCOUNTS_PREFIX, JSON.stringify([...set]))
  } catch {
    /* ignore */
  }
}

function App(): React.JSX.Element {
  const [connected, setConnected] = useState(false)
  const [connectedPort, setConnectedPort] = useState(7497)
  const [activeTab, setActiveTab] = useState<'overview' | 'groups' | 'option'>('overview')
  const [showSettings, setShowSettings] = useState(false)
  const [hiddenAccounts, setHiddenAccounts] = useState<Set<string>>(() => loadHiddenAccounts())
  const [accountGroupLabel, setAccountGroupLabel] = useState<string | null>(null)
  const [returnRates, setReturnRates] = useState<Record<string, number | null>>({})
  const [operationModes, setOperationModes] = useState<Record<string, string>>({})
  const [initialCosts, setInitialCosts] = useState<Record<string, number>>({})
  const [optionGroups, setOptionGroups] = useState<Record<string, string>>({})
  const [reportNotes, setReportNotes] = useState<Record<string, string>>({})
  const {
    marginLimit,
    setMarginLimit,
    watchSymbols,
    setWatchSymbol,
    mergeAccountAliases,
    accountTypes,
    setAccountType,
    symbolPrefetch,
    setSymbolPrefetch,
    symbolGroups,
    addSymbolGroup,
    deleteSymbolGroup,
    updateSymbolGroup,
    reorderSymbolGroups,
    showOperationMode,
    setShowOperationMode,
    showAccountType,
    setShowAccountType,
    refetchSettings,
    saveAllSettings
  } = useTraderSettings()

  // d1Target was a user-facing toggle for staging vs production; we removed
  // the toggle in 2026-06 — trader is always production now.
  const d1Target: 'production' = 'production'

  useEffect(() => {
    window.ibApi.onConnectionStatus((state) => {
      setConnected(state.status === 'connected')
      if (state.status === 'connected') {
        setConnectedPort(state.port)
      }
    })

    // Check initial state
    window.ibApi.getConnectionState().then((state) => {
      setConnected(state.status === 'connected')
      if (state.status === 'connected') {
        setConnectedPort(state.port)
      }
    })
  }, [])


  const {
    accounts,
    positions,
    quotes,
    optionQuotes,
    openOrders,
    orderQuotes,
    executions,
    loading,
    refresh
  } = useAccountStore(connected, connectedPort, mergeAccountAliases)

  // Stable key that only changes when the set of account IDs changes (not on every poll)
  const accountIdsKey = useMemo(
    () =>
      accounts
        .map((a) => a.accountId)
        .sort()
        .join(','),
    [accounts]
  )

  // Header price pills: underlyings that have an OPTION position, ordered
  // QQQ → QLD → TQQQ → everything else alphabetically, capped at 5.
  const optionUnderlyings = useMemo(() => {
    const set = new Set<string>()
    for (const p of positions) {
      if (p.secType === 'OPT' && p.symbol) set.add(p.symbol)
    }
    const priority = ['QQQ', 'QLD', 'TQQQ']
    const rank = (s: string): number => {
      const i = priority.indexOf(s)
      return i === -1 ? priority.length : i
    }
    return Array.from(set).sort((a, b) => {
      const ra = rank(a)
      const rb = rank(b)
      return ra !== rb ? ra - rb : a.localeCompare(b)
    })
  }, [positions])

  // Auto-detect account group when accounts are loaded
  useEffect(() => {
    if (!accountIdsKey) {
      setAccountGroupLabel(null)
      return
    }
    const accountIds = accountIdsKey.split(',')
    window.ibApi
      .detectGroup(accountIds)
      .then((result) => {
        const yearSuffix = result.year ? ` (${result.year})` : ''
        setAccountGroupLabel(result.label ? result.label + yearSuffix : null)
        // Re-fetch settings for the detected group
        refetchSettings()
        // Auto-fetch account types from D1
        window.ibApi
          .getAccountTypes(accountIds, d1Target)
          .then((res) => {
            if (res.accountTypes && Object.keys(res.accountTypes).length > 0) {
              for (const [accountId, type] of Object.entries(res.accountTypes) as [
                string,
                string
              ][]) {
                setAccountType(accountId, type)
              }
            }
            if (res.operationModes && Object.keys(res.operationModes).length > 0) {
              setOperationModes(res.operationModes)
            }
          })
          .catch(() => {})
        // Auto-fetch return rates (報酬率) from D1
        window.ibApi
          .getReturnRates(accountIds, d1Target)
          .then((res) => {
            if (res.returnRates && Object.keys(res.returnRates).length > 0) {
              setReturnRates(res.returnRates)
            }
          })
          .catch(() => {})
        // Auto-fetch initial costs (初始成本) from D1
        window.ibApi
          .getInitialCosts(accountIds, d1Target)
          .then((res) => {
            if (res.initialCosts && Object.keys(res.initialCosts).length > 0) {
              setInitialCosts(res.initialCosts)
            }
          })
          .catch(() => {})
        // Auto-fetch option group_id tags (e.g. "QQQ-4") from D1
        window.ibApi
          .getOptionGroups(accountIds, d1Target)
          .then((res) => {
            if (res.optionGroups) {
              setOptionGroups(res.optionGroups)
            }
          })
          .catch(() => {})
        // Auto-fetch per-account USERS.report_note (daily-report notes)
        window.ibApi
          .getReportNotes(accountIds, d1Target)
          .then((res) => {
            if (res.reportNotes) {
              setReportNotes(res.reportNotes)
            }
          })
          .catch(() => {})
      })
      .catch(() => {
        setAccountGroupLabel(null)
      })
  }, [accountIdsKey, refetchSettings, d1Target, setAccountType])

  const toggleHiddenAccount = useCallback((accountId: string) => {
    setHiddenAccounts((prev) => {
      const next = new Set(prev)
      if (next.has(accountId)) next.delete(accountId)
      else next.add(accountId)
      saveHiddenAccounts(next)
      return next
    })
  }, [])

  const visibleAccounts = useMemo(
    () => accounts.filter((a) => !hiddenAccounts.has(a.accountId)),
    [accounts, hiddenAccounts]
  )

  const visiblePositions = useMemo(
    () => positions.filter((p) => !hiddenAccounts.has(p.account)),
    [positions, hiddenAccounts]
  )

  const visibleOpenOrders = useMemo(
    () => openOrders.filter((o) => !hiddenAccounts.has(o.account)),
    [openOrders, hiddenAccounts]
  )

  const visibleExecutions = useMemo(
    () => executions.filter((e) => !hiddenAccounts.has(e.account)),
    [executions, hiddenAccounts]
  )

  // Auto-update: subscribe to the main process's hourly poll and surface a
  // pill in the header when a newer version is available.
  const [updateInfo, setUpdateInfo] = useState<{
    version: string
    downloadUrl: string
    currentVersion: string
  } | null>(null)
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [updateError, setUpdateError] = useState<string | null>(null)
  useEffect(() => {
    // Pull whatever main has already cached (in case we mounted after the
    // initial startup poll fired).
    window.ibApi.getCachedUpdate().then(setUpdateInfo).catch(() => {})
    const off = window.ibApi.onUpdateAvailable((info) => setUpdateInfo(info))
    return off
  }, [])
  // Auto-open the update dialog the first time a newer version is detected
  // (typically right after launch) so the user is prompted to install instead
  // of having to notice the small pill. Only fires once per session — if the
  // user dismisses it, the header pill remains for manual access.
  const updatePromptedRef = useRef(false)
  useEffect(() => {
    if (updateInfo && !updatePromptedRef.current) {
      updatePromptedRef.current = true
      setUpdateError(null)
      setUpdateDialogOpen(true)
    }
  }, [updateInfo])
  const openUpdateDialog = useCallback(() => {
    if (!updateInfo) return
    setUpdateError(null)
    setUpdateDialogOpen(true)
  }, [updateInfo])
  const confirmInstallUpdate = useCallback(async () => {
    if (!updateInfo || installing) return
    setInstalling(true)
    setUpdateError(null)
    try {
      const res = await window.ibApi.installUpdate()
      if (!res.ok) {
        setUpdateError(res.error || '未知錯誤')
        setInstalling(false)
      }
      // On success the main process quits the app — no need to clear state.
    } catch (err) {
      setUpdateError(err instanceof Error ? err.message : String(err))
      setInstalling(false)
    }
  }, [updateInfo, installing])

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-left">
          <button className="settings-btn" title="設定" onClick={() => setShowSettings(true)}>
            <svg
              width="26"
              height="26"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </button>
          <EtClock />
          {optionUnderlyings
            .filter((sym) => quotes[sym] > 0)
            .slice(0, 5)
            .map((sym) => (
              <span key={sym} className="stock-price-pill" title={`${sym} 即時股價`}>
                <span className="stock-price-label">{sym}</span>
                {quotes[sym].toFixed(2)}
              </span>
            ))}
          {updateInfo && (
            <button
              type="button"
              className="update-available-pill"
              onClick={openUpdateDialog}
              title={`下載並安裝 ${updateInfo.version}`}
            >
              安裝新版 {updateInfo.version}
            </button>
          )}
        </div>
        <nav className="tab-nav-inline">
          <button
            className={`tab-btn ${activeTab === 'overview' ? 'active' : ''}`}
            onClick={() => setActiveTab('overview')}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect width="20" height="14" x="2" y="5" rx="2" />
              <path d="M2 10h20" />
            </svg>
            帳戶總覽
          </button>
          <button
            className={`tab-btn ${activeTab === 'groups' ? 'active' : ''}`}
            onClick={() => setActiveTab('groups')}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" />
              <circle cx="7.5" cy="7.5" r=".5" fill="currentColor" />
            </svg>
            批次交易
          </button>
        </nav>
        <div className="header-actions">
          {accountGroupLabel && <span className="account-group-badge">{accountGroupLabel}</span>}
          <ConnectionStatus />
        </div>
      </header>

      <main className="app-main">
        <div className="app-main-inner">
          {(activeTab === 'overview' || activeTab === 'groups') && (
            <AccountOverview
              connected={connected}
              accounts={visibleAccounts}
              positions={visiblePositions}
              quotes={quotes}
              optionQuotes={optionQuotes}
              openOrders={visibleOpenOrders}
              orderQuotes={orderQuotes}
              executions={visibleExecutions}
              loading={loading}
              refresh={refresh}
              accountTypes={accountTypes}
              returnRates={returnRates}
              operationModes={operationModes}
              initialCosts={initialCosts}
              optionGroups={optionGroups}
              reportNotes={reportNotes}
              onSetReportNote={(accountId, note) => {
                setReportNotes((prev) => ({
                  ...prev,
                  [accountId]: note
                }))
                window.ibApi
                  .setReportNote(accountId, note || null, d1Target)
                  .catch((err) => console.warn('setReportNote failed:', err))
              }}
              onSetAccountType={setAccountType}
              marginLimit={marginLimit}
              symbolGroups={symbolGroups}
              onAddSymbolGroup={addSymbolGroup}
              onDeleteSymbolGroup={deleteSymbolGroup}
              onUpdateSymbolGroup={updateSymbolGroup}
              onReorderSymbolGroups={reorderSymbolGroups}
              groupViewMode={activeTab === 'groups'}
              showOperationMode={showOperationMode}
              showAccountType={showAccountType}
              d1Target={d1Target}
            />
          )}
          {activeTab === 'option' && (
            <OptionOrderForm connected={connected} accounts={visibleAccounts} />
          )}
        </div>
      </main>
      <SettingsPanel
        open={showSettings}
        onClose={() => {
          saveAllSettings()
          setShowSettings(false)
        }}
        accounts={accounts}
        hiddenAccounts={hiddenAccounts}
        onToggleAccount={toggleHiddenAccount}
        marginLimit={marginLimit}
        onSetMarginLimit={setMarginLimit}
        watchSymbols={watchSymbols}
        onSetWatchSymbol={setWatchSymbol}
        symbolPrefetch={symbolPrefetch}
        onSetSymbolPrefetch={setSymbolPrefetch}
        showOperationMode={showOperationMode}
        onSetShowOperationMode={setShowOperationMode}
        showAccountType={showAccountType}
        onSetShowAccountType={setShowAccountType}
      />
      {updateDialogOpen && updateInfo && (
        <div
          className="roll-dialog-overlay"
          onClick={() => !installing && setUpdateDialogOpen(false)}
        >
          <div
            className="roll-dialog"
            style={{ width: 560 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="roll-dialog-header" style={{ gap: 10 }}>
              <span style={{ fontSize: 22, lineHeight: 1 }}>⬆️</span>
              <h3>有新版可下載</h3>
              <button
                className="roll-dialog-close"
                onClick={() => !installing && setUpdateDialogOpen(false)}
                disabled={installing}
              >
                ✕
              </button>
            </div>
            <div
              className="roll-dialog-body"
              style={{
                padding: '20px 24px',
                fontSize: 14,
                color: '#374151',
                lineHeight: 1.7
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <span
                  style={{
                    padding: '4px 12px',
                    background: '#f3f4f6',
                    borderRadius: 6,
                    fontFamily: 'monospace'
                  }}
                >
                  {updateInfo.currentVersion}
                </span>
                <span style={{ color: '#9ca3af' }}>→</span>
                <span
                  style={{
                    padding: '4px 12px',
                    background: 'rgba(245, 158, 11, 0.14)',
                    color: '#b45309',
                    border: '1px solid rgba(245, 158, 11, 0.45)',
                    borderRadius: 6,
                    fontFamily: 'monospace',
                    fontWeight: 600
                  }}
                >
                  {updateInfo.version}
                </span>
              </div>
              <div style={{ fontSize: 13, whiteSpace: 'nowrap' }}>
                按下「安裝」後 App 會自動下載並啟動安裝程序，目前視窗會關閉。
              </div>
              {updateError && (
                <div
                  style={{
                    marginTop: 12,
                    padding: '8px 12px',
                    background: '#fef2f2',
                    border: '1px solid #fecaca',
                    color: '#b91c1c',
                    borderRadius: 6,
                    fontSize: 13
                  }}
                >
                  更新失敗：{updateError}
                </div>
              )}
            </div>
            <div
              style={{
                padding: '12px 20px',
                display: 'flex',
                justifyContent: 'flex-end',
                gap: 8,
                borderTop: '1px solid var(--border-color)'
              }}
            >
              <button
                className="select-toggle-btn"
                onClick={() => setUpdateDialogOpen(false)}
                disabled={installing}
                style={{ minWidth: 80 }}
              >
                取消
              </button>
              <button
                className="select-toggle-btn"
                onClick={confirmInstallUpdate}
                disabled={installing}
                style={{
                  minWidth: 80,
                  background: '#2563eb',
                  color: '#fff',
                  borderColor: '#2563eb'
                }}
              >
                {installing ? '下載中...' : '安裝'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
