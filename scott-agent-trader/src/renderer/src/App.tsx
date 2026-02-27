import React from 'react'
import { useState, useEffect, useMemo, useCallback } from 'react'
import ConnectionStatus from './components/ConnectionStatus'
import AccountOverview from './components/AccountOverview'
import OptionOrderForm from './components/OptionOrderForm'
import SettingsPanel from './components/SettingsPanel'
import UploadProgressDialog from './components/UploadProgressDialog'
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
  const [activeTab, setActiveTab] = useState<'overview' | 'option'>('overview')
  const [showSettings, setShowSettings] = useState(false)
  const [hiddenAccounts, setHiddenAccounts] = useState<Set<string>>(() => loadHiddenAccounts(7497))
  const [showUpload, setShowUpload] = useState(false)
  const [accountGroupLabel, setAccountGroupLabel] = useState<string | null>(null)
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

  // Auto-detect account group when accounts are loaded
  useEffect(() => {
    if (accounts.length === 0) {
      setAccountGroupLabel(null)
      return
    }
    const accountIds = accounts.map((a) => a.accountId)
    window.ibApi
      .detectGroup(accountIds)
      .then((result) => {
        const yearSuffix = result.year ? ` (${result.year})` : ''
        setAccountGroupLabel(result.label ? result.label + yearSuffix : null)
      })
      .catch(() => {
        setAccountGroupLabel(null)
      })
  }, [accounts])

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
          <button
            className="upload-prices-btn"
            title="上傳可交易標的過去一年股價到雲端"
            disabled={!connected || watchSymbols.filter(Boolean).length === 0}
            onClick={() => setShowUpload(true)}
          >
            ☁ 上傳股價
          </button>
          {accountGroupLabel && (
            <span className="account-group-badge">{accountGroupLabel}</span>
          )}
        </div>
        <nav className="tab-nav-inline">
          <button
            className={`tab-btn ${activeTab === 'overview' ? 'active' : ''}`}
            onClick={() => setActiveTab('overview')}
          >
            帳戶總覽
          </button>
        </nav>
        <div className="header-actions">
          <ConnectionStatus />
        </div>
      </header>

      <main className="app-main">
        <div className="app-main-inner">
          {activeTab === 'overview' && (
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
              onSetAccountType={setAccountType}
              marginLimit={marginLimit}
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
      />
      {showUpload && (
        <UploadProgressDialog
          symbols={watchSymbols.filter(Boolean)}
          d1Target={d1Target}
          onClose={() => setShowUpload(false)}
        />
      )}
    </div>
  )
}

export default App
