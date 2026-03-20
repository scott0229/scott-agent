import React from 'react'
import { useState, useEffect, useMemo, useCallback } from 'react'
import ConnectionStatus from './components/ConnectionStatus'
import AccountOverview from './components/AccountOverview'
import OptionOrderForm from './components/OptionOrderForm'
import SettingsPanel from './components/SettingsPanel'
import PriceSyncDialog from './components/PriceSyncDialog'
import { useAccountStore } from './hooks/useAccountStore'
import { useTraderSettings } from './hooks/useTraderSettings'
import './assets/app.css'

const HIDDEN_ACCOUNTS_PREFIX = 'scott-trader-hidden-accounts'

function getHiddenAccountsKey(port: number): string {
  return `${HIDDEN_ACCOUNTS_PREFIX}-${port}`
}

function loadHiddenAccounts(port: number): Set<string> {
  try {
    const raw = localStorage.getItem(getHiddenAccountsKey(port))
    if (raw) return new Set(JSON.parse(raw))
  } catch {
    /* ignore */
  }
  return new Set()
}

function App(): React.JSX.Element {
  const [connected, setConnected] = useState(false)
  const [connectedPort, setConnectedPort] = useState(7497)
  const [activeTab, setActiveTab] = useState<'overview' | 'groups' | 'option'>('overview')
  const [showSettings, setShowSettings] = useState(false)
  const [hiddenAccounts, setHiddenAccounts] = useState<Set<string>>(() => loadHiddenAccounts(7497))
  const [showSync, setShowSync] = useState(false)
  const [uploadSymbols, setUploadSymbols] = useState<string[]>([])
  const [fetchingSymbols, setFetchingSymbols] = useState(false)
  const [accountGroupLabel, setAccountGroupLabel] = useState<string | null>(null)
  const [returnRates, setReturnRates] = useState<Record<string, number | null>>({})
  const [operationModes, setOperationModes] = useState<Record<string, string>>({})
  const {
    marginLimit,
    setMarginLimit,
    watchSymbols,
    setWatchSymbol,
    mergeAccountAliases,
    accountTypes,
    setAccountType,
    symbolOptionTypes,
    setSymbolOptionType,
    d1Target,
    setD1Target,
    symbolGroups,
    addSymbolGroup,
    deleteSymbolGroup,
    updateSymbolGroup,
    reorderSymbolGroups,
    refetchSettings,
    saveAllSettings
  } = useTraderSettings()

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

  // Reload hidden accounts when port changes
  useEffect(() => {
    setHiddenAccounts(loadHiddenAccounts(connectedPort))
  }, [connectedPort])

  const { accounts, positions, quotes, optionQuotes, openOrders, executions, loading, refresh } =
    useAccountStore(connected, connectedPort, mergeAccountAliases)

  // Stable key that only changes when the set of account IDs changes (not on every poll)
  const accountIdsKey = useMemo(
    () =>
      accounts
        .map((a) => a.accountId)
        .sort()
        .join(','),
    [accounts]
  )

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
              for (const [accountId, type] of Object.entries(res.accountTypes) as [string, string][]) {
                setAccountType(accountId, type)
              }
            }
            if (res.operationModes && Object.keys(res.operationModes).length > 0) {
              setOperationModes(res.operationModes)
            }
          })
          .catch(() => { })
        // Auto-fetch return rates (報酬率) from D1
        window.ibApi
          .getReturnRates(accountIds, d1Target)
          .then((res) => {
            if (res.returnRates && Object.keys(res.returnRates).length > 0) {
              setReturnRates(res.returnRates)
            }
          })
          .catch(() => { })
      })
      .catch(() => {
        setAccountGroupLabel(null)
      })
  }, [accountIdsKey, refetchSettings, d1Target, setAccountType])

  const toggleHiddenAccount = useCallback(
    (accountId: string) => {
      setHiddenAccounts((prev) => {
        const next = new Set(prev)
        if (next.has(accountId)) next.delete(accountId)
        else next.add(accountId)
        localStorage.setItem(getHiddenAccountsKey(connectedPort), JSON.stringify([...next]))
        return next
      })
    },
    [connectedPort]
  )

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
          {accountGroupLabel && <span className="account-group-badge">{accountGroupLabel}</span>}
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
            交易群組{symbolGroups.length > 0 ? ` (${symbolGroups.length})` : ''}
          </button>
        </nav>
        <div className="header-actions">
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
              executions={visibleExecutions}
              loading={loading}
              refresh={refresh}
              accountTypes={accountTypes}
              returnRates={returnRates}
              operationModes={operationModes}
              onSetAccountType={setAccountType}
              marginLimit={marginLimit}
              symbolGroups={symbolGroups}
              onAddSymbolGroup={addSymbolGroup}
              onDeleteSymbolGroup={deleteSymbolGroup}
              onUpdateSymbolGroup={updateSymbolGroup}
              onReorderSymbolGroups={reorderSymbolGroups}
              groupViewMode={activeTab === 'groups'}
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
        symbolOptionTypes={symbolOptionTypes}
        onSetSymbolOptionType={setSymbolOptionType}
        d1Target={d1Target}
        onSetD1Target={setD1Target}
        connected={connected}
        fetchingSymbols={fetchingSymbols}
        onSyncPrices={async () => {
          setFetchingSymbols(true)
          try {
            const symbols = await window.ibApi.getNeededSymbols(
              d1Target === 'production' ? 'production' : 'staging'
            )
            setUploadSymbols(symbols)
            setShowSync(true)
          } catch (err) {
            console.error('getNeededSymbols error:', err)
            alert('取得需要上傳的標的清單失敗')
          } finally {
            setFetchingSymbols(false)
          }
        }}
      />
      {showSync && (
        <PriceSyncDialog
          symbols={uploadSymbols}
          d1Target={d1Target}
          onClose={() => setShowSync(false)}
        />
      )}
    </div>
  )
}

export default App
