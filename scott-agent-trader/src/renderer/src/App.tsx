import { useState, useEffect } from 'react'
import ConnectionStatus from './components/ConnectionStatus'
import AccountOverview from './components/AccountOverview'
import BatchOrderForm from './components/BatchOrderForm'
import OptionOrderForm from './components/OptionOrderForm'
import { useAccountStore } from './hooks/useAccountStore'
import './assets/app.css'

function App(): JSX.Element {
  const [connected, setConnected] = useState(false)
  const [activeTab, setActiveTab] = useState<'overview' | 'stock' | 'option'>('overview')

  useEffect(() => {
    window.ibApi.onConnectionStatus((state) => {
      setConnected(state.status === 'connected')
    })

    // Check initial state
    window.ibApi.getConnectionState().then((state) => {
      setConnected(state.status === 'connected')
    })
  }, [])

  const { accounts, positions, quotes, loading, refresh } = useAccountStore(connected)

  return (
    <div className="app">
      <header className="app-header">
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
            accounts={accounts}
            positions={positions}
            quotes={quotes}
            loading={loading}
          />
        )}
        {activeTab === 'stock' && <BatchOrderForm connected={connected} accounts={accounts} positions={positions} />}
        {activeTab === 'option' && <OptionOrderForm connected={connected} accounts={accounts} />}
      </main>
    </div>
  )
}

export default App
