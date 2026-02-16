import { useState, useEffect } from 'react'
import ConnectionStatus from './components/ConnectionStatus'
import AccountOverview from './components/AccountOverview'
import BatchOrderForm from './components/BatchOrderForm'
import OptionOrderForm from './components/OptionOrderForm'
import './assets/app.css'

function App(): JSX.Element {
  const [connected, setConnected] = useState(false)
  const [activeTab, setActiveTab] = useState<'overview' | 'order'>('overview')
  const [orderSubTab, setOrderSubTab] = useState<'stock' | 'option'>('stock')

  useEffect(() => {
    window.ibApi.onConnectionStatus((state) => {
      setConnected(state.status === 'connected')
    })

    // Check initial state
    window.ibApi.getConnectionState().then((state) => {
      setConnected(state.status === 'connected')
    })
  }, [])

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-title">
          <span className="app-icon">📈</span>
          <h1>Scott Agent Trader</h1>
        </div>
        <ConnectionStatus />
      </header>

      <nav className="tab-nav">
        <button
          className={`tab-btn ${activeTab === 'overview' ? 'active' : ''}`}
          onClick={() => setActiveTab('overview')}
        >
          📊 帳戶總覽
        </button>
        <button
          className={`tab-btn ${activeTab === 'order' ? 'active' : ''}`}
          onClick={() => setActiveTab('order')}
        >
          📋 批次下單
        </button>
      </nav>

      <main className="app-main">
        {activeTab === 'overview' && <AccountOverview connected={connected} />}
        {activeTab === 'order' && (
          <div className="order-tab-content">
            <div className="sub-tab-nav">
              <button
                className={`sub-tab-btn ${orderSubTab === 'stock' ? 'active' : ''}`}
                onClick={() => setOrderSubTab('stock')}
              >
                📈 股票下單
              </button>
              <button
                className={`sub-tab-btn ${orderSubTab === 'option' ? 'active' : ''}`}
                onClick={() => setOrderSubTab('option')}
              >
                📑 期權下單
              </button>
            </div>
            {orderSubTab === 'stock' && <BatchOrderForm connected={connected} />}
            {orderSubTab === 'option' && <OptionOrderForm connected={connected} />}
          </div>
        )}
      </main>
    </div>
  )
}

export default App
