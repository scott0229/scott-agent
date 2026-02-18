import { useState, useEffect, useMemo, useCallback } from 'react'
import ConnectionStatus from './components/ConnectionStatus'
import AccountOverview from './components/AccountOverview'
import BatchOrderForm from './components/BatchOrderForm'
import OptionOrderForm from './components/OptionOrderForm'
import SettingsPanel from './components/SettingsPanel'
import { useAccountStore } from './hooks/useAccountStore'
import './assets/app.css'

const HIDDEN_ACCOUNTS_PREFIX = 'scott-trader-hidden-accounts'

function getHiddenAccountsKey(port: number): string {
  return `${HIDDEN_ACCOUNTS_PREFIX}-${port}`
}

function loadHiddenAccounts(port: number): Set<string> {
  try {
    const raw = localStorage.getItem(getHiddenAccountsKey(port))
    if (raw) return new Set(JSON.parse(raw))
  } catch { /* ignore */ }
  return new Set()
}

function App(): JSX.Element {
  const [connected, setConnected] = useState(false)
  const [connectedPort, setConnectedPort] = useState(7497)
  const [activeTab, setActiveTab] = useState<'overview' | 'stock' | 'option'>('overview')
  const [showSettings, setShowSettings] = useState(false)
  const [hiddenAccounts, setHiddenAccounts] = useState<Set<string>>(() => loadHiddenAccounts(7497))

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

  const { accounts, positions, quotes, loading, refresh } = useAccountStore(connected, connectedPort)

  const toggleHiddenAccount = useCallback((accountId: string) => {
    setHiddenAccounts((prev) => {
      const next = new Set(prev)
      if (next.has(accountId)) next.delete(accountId)
      else next.add(accountId)
      localStorage.setItem(getHiddenAccountsKey(connectedPort), JSON.stringify([...next]))
      return next
    })
  }, [connectedPort])

  const visibleAccounts = useMemo(
    () => accounts.filter((a) => !hiddenAccounts.has(a.accountId)),
    [accounts, hiddenAccounts]
  )

  const visiblePositions = useMemo(
    () => positions.filter((p) => !hiddenAccounts.has(p.account)),
    [positions, hiddenAccounts]
  )

  return (
    <div className="app">
      <header className="app-header">
        <button className="settings-btn" title="設定" onClick={() => setShowSettings(true)}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </button>
        <nav className="tab-nav-inline">
          <button
            className={`tab-btn ${activeTab === 'overview' ? 'active' : ''}`}
            onClick={() => setActiveTab('overview')}
          >
            帳戶總覽
          </button>
          <button
            className={`tab-btn ${activeTab === 'stock' ? 'active' : ''}`}
            onClick={() => setActiveTab('stock')}
          >
            股票下單
          </button>
          <button
            className={`tab-btn ${activeTab === 'option' ? 'active' : ''}`}
            onClick={() => setActiveTab('option')}
          >
            期權下單
          </button>
        </nav>
        <div className="header-actions">
          <ConnectionStatus onRefresh={refresh} />
        </div>
      </header>

      <main className="app-main">
        {activeTab === 'overview' && (
          <AccountOverview
            connected={connected}
            accounts={visibleAccounts}
            positions={visiblePositions}
            quotes={quotes}
            loading={loading}
          />
        )}
        {activeTab === 'stock' && (
          <BatchOrderForm connected={connected} accounts={visibleAccounts} positions={visiblePositions} />
        )}
        {activeTab === 'option' && <OptionOrderForm connected={connected} accounts={visibleAccounts} />}
      </main>

      <SettingsPanel
        open={showSettings}
        onClose={() => setShowSettings(false)}
        accounts={accounts}
        hiddenAccounts={hiddenAccounts}
        onToggleAccount={toggleHiddenAccount}
      />
    </div>
  )
}

export default App
