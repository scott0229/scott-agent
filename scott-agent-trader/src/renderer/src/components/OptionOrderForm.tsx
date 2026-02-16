import { useState, useEffect, useCallback } from 'react'
import OptionChainTable from './OptionChainTable'
import CustomSelect from './CustomSelect'

interface AccountData {
  accountId: string
  netLiquidation: number
  availableFunds: number
}

interface OrderResult {
  orderId: number
  account: string
  status: string
  filled: number
  remaining: number
  avgFillPrice: number
  symbol: string
}

interface OptionChainParams {
  exchange: string
  underlyingConId: number
  tradingClass: string
  multiplier: string
  expirations: string[]
  strikes: number[]
}

interface OptionGreek {
  strike: number
  right: 'C' | 'P'
  expiry: string
  bid: number
  ask: number
  last: number
  delta: number
  gamma: number
  theta: number
  vega: number
  impliedVol: number
  openInterest: number
}

interface OptionOrderFormProps {
  connected: boolean
}

export default function OptionOrderForm({ connected }: OptionOrderFormProps): JSX.Element {
  // Search state
  const [symbol, setSymbol] = useState('')
  const [chainParams, setChainParams] = useState<OptionChainParams[]>([])
  const [selectedExpiry, setSelectedExpiry] = useState('')

  const [greeks, setGreeks] = useState<OptionGreek[]>([])
  const [loadingChain, setLoadingChain] = useState(false)
  const [loadingGreeks, setLoadingGreeks] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  // Selection state
  const [selectedStrike, setSelectedStrike] = useState<number | null>(null)
  const [selectedRight, setSelectedRight] = useState<'C' | 'P' | null>(null)

  // Order state
  const [action, setAction] = useState<'BUY' | 'SELL'>('SELL')
  const [limitPrice, setLimitPrice] = useState('')
  const [quantity, setQuantity] = useState('')
  const [selectedUser, setSelectedUser] = useState('ALL')

  const [accounts, setAccounts] = useState<AccountData[]>([])
  const [orderResults, setOrderResults] = useState<OrderResult[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  // Fetch accounts when connected
  useEffect(() => {
    if (connected) {
      window.ibApi.getAccountSummary().then((data) => {
        setAccounts(data)
      })
    } else {
      setAccounts([])
    }
  }, [connected])

  // Listen for order status updates
  useEffect(() => {
    window.ibApi.onOrderStatus((update: OrderResult) => {
      setOrderResults((prev) =>
        prev.map((r) =>
          r.orderId === update.orderId
            ? { ...r, ...update, account: r.account, symbol: r.symbol }
            : r
        )
      )
    })

    return () => {
      window.ibApi.removeAllListeners()
    }
  }, [])

  // Get available expirations from SMART exchange params
  const currentParams = chainParams.find((p) => p.exchange === 'SMART') || chainParams[0]
  const availableExpirations = currentParams?.expirations || []
  const availableStrikes = currentParams?.strikes || []

  // Search for option chain
  const handleSearch = useCallback(async () => {
    if (!symbol.trim()) return
    setLoadingChain(true)
    setChainParams([])
    setGreeks([])
    setSelectedExpiry('')
    setSelectedStrike(null)
    setSelectedRight(null)
    setErrorMsg('')

    console.log('[OptionOrderForm] Searching option chain for:', symbol.toUpperCase())
    try {
      const params = await window.ibApi.getOptionChain(symbol.toUpperCase())
      console.log('[OptionOrderForm] Got option chain params:', params?.length, 'exchanges')
      setChainParams(params)

      if (params.length === 0) {
        setErrorMsg('未找到期權鏈資料')
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('Failed to load option chain:', err)
      setErrorMsg(`查詢失敗: ${message}`)
    } finally {
      setLoadingChain(false)
    }
  }, [symbol])

  // Load greeks when expiry is selected
  const handleExpiryChange = useCallback(
    async (expiry: string) => {
      setSelectedExpiry(expiry)
      setSelectedStrike(null)
      setSelectedRight(null)
      setGreeks([])

      if (!expiry || availableStrikes.length === 0) return

      setLoadingGreeks(true)
      try {
        const strikesToLoad =
          availableStrikes.length > 30
            ? availableStrikes.slice(
              Math.max(0, Math.floor(availableStrikes.length / 2) - 15),
              Math.min(availableStrikes.length, Math.floor(availableStrikes.length / 2) + 15)
            )
            : availableStrikes

        const data = await window.ibApi.getOptionGreeks(
          symbol.toUpperCase(),
          expiry,
          strikesToLoad,
          'SMART'
        )
        setGreeks(data)
      } catch (err: unknown) {
        console.error('Failed to load option greeks:', err)
      } finally {
        setLoadingGreeks(false)
      }
    },
    [symbol, availableStrikes]
  )

  const handleContractSelect = useCallback(
    (strike: number, right: 'C' | 'P') => {
      setSelectedStrike(strike)
      setSelectedRight(right)
      // Pre-fill limit price from the ask price of the selected option
      const option = greeks.find((g) => g.strike === strike && g.right === right)
      if (option) {
        if (action === 'BUY') {
          setLimitPrice(option.ask > 0 ? option.ask.toFixed(2) : '')
        } else {
          setLimitPrice(option.bid > 0 ? option.bid.toFixed(2) : '')
        }
      }
    },
    [greeks, action]
  )

  // Build allocations based on selected user
  const qty = parseInt(quantity || '0', 10) || 0
  const sortedAccounts = [...accounts].sort((a, b) => b.netLiquidation - a.netLiquidation)
  const targetAccounts =
    selectedUser === 'ALL' ? sortedAccounts : sortedAccounts.filter((a) => a.accountId === selectedUser)
  const allocations: Record<string, number> = {}
  for (const acct of targetAccounts) {
    if (qty > 0) allocations[acct.accountId] = qty
  }
  const totalAllocated = Object.values(allocations).reduce((sum, q) => sum + q, 0)

  const handleSubmit = useCallback(async () => {
    if (selectedStrike === null || selectedRight === null || !selectedExpiry) return

    setSubmitting(true)
    setShowConfirm(false)
    try {
      const request = {
        symbol: symbol.toUpperCase(),
        action,
        orderType: 'LMT' as const,
        limitPrice: parseFloat(limitPrice),
        totalQuantity: totalAllocated,
        expiry: selectedExpiry,
        strike: selectedStrike,
        right: selectedRight,
        exchange: 'SMART'
      }

      const results = await window.ibApi.placeOptionBatchOrders(request, allocations)
      setOrderResults(results)
    } catch (err: unknown) {
      console.error('Option batch order failed:', err)
    } finally {
      setSubmitting(false)
    }
  }, [symbol, action, limitPrice, selectedExpiry, selectedStrike, selectedRight, allocations, totalAllocated])

  const contractDesc =
    selectedStrike !== null && selectedRight !== null && selectedExpiry
      ? `${symbol.toUpperCase()} ${selectedExpiry} ${selectedStrike} ${selectedRight === 'C' ? 'CALL' : 'PUT'}`
      : ''

  if (!connected) {
    return (
      <div className="panel">
        <div className="empty-state">請先連線到 TWS / IB Gateway</div>
      </div>
    )
  }

  return (
    <div className="panel">
      {/* Search Bar */}
      <div className="option-search">
        <div className="form-row">
          <div className="form-group">
            <label>標的代碼</label>
            <input
              type="text"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              className="input-field"
            />
          </div>
          <div className="form-group" style={{ justifyContent: 'flex-end' }}>
            <button
              onClick={handleSearch}
              className="btn btn-connect"
              disabled={loadingChain || !symbol.trim()}
            >
              {loadingChain ? '查詢中...' : '🔍 查詢期權鏈'}
            </button>
          </div>

          {errorMsg && <div className="error-banner">{errorMsg}</div>}

          {availableExpirations.length > 0 && (
            <>
              <div className="form-group">
                <label>到期日</label>
                <CustomSelect
                  value={selectedExpiry}
                  onChange={handleExpiryChange}
                  options={[
                    { value: '', label: '選擇到期日' },
                    ...availableExpirations.map((exp) => ({
                      value: exp,
                      label: exp
                    }))
                  ]}
                />
              </div>
            </>
          )}
        </div>
      </div>

      {/* Option Chain Table */}
      {loadingGreeks ? (
        <div className="empty-state">載入期權報價中...</div>
      ) : (
        <OptionChainTable
          greeks={greeks}
          selectedStrike={selectedStrike}
          selectedRight={selectedRight}
          onSelect={handleContractSelect}
        />
      )}

      {/* Selected Contract & Order Form */}
      {selectedStrike !== null && selectedRight !== null && (
        <div className="option-order-section">
          <div className="selected-contract">
            <span className="contract-label">已選擇合約：</span>
            <span
              className={`contract-desc ${selectedRight === 'C' ? 'contract-call' : 'contract-put'}`}
            >
              {contractDesc}
            </span>
          </div>

          <div className="order-form">
            <div className="form-row">
              <div className="form-group">
                <label>方向</label>
                <CustomSelect
                  value={action}
                  onChange={(v) => setAction(v as 'BUY' | 'SELL')}
                  options={[
                    { value: 'BUY', label: '買入' },
                    { value: 'SELL', label: '賣出' }
                  ]}
                />
              </div>
              <div className="form-group">
                <label>限價</label>
                <input
                  type="number"
                  value={limitPrice}
                  onChange={(e) => setLimitPrice(e.target.value)}
                  step="0.01"
                  className="input-field"
                />
              </div>
              <div className="form-group">
                <label>口數</label>
                <input
                  type="number"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  min="0"
                  className="input-field input-small"
                />
              </div>
              <div className="form-group">
                <label>用戶</label>
                <CustomSelect
                  value={selectedUser}
                  onChange={setSelectedUser}
                  options={[
                    { value: 'ALL', label: '全部用戶' },
                    ...sortedAccounts.map((acct) => ({
                      value: acct.accountId,
                      label: acct.accountId
                    }))
                  ]}
                />
              </div>
            </div>
            {/* Bid / Ask display for selected option */}
            {(() => {
              const selectedGreek = greeks.find(
                (g) => g.strike === selectedStrike && g.right === selectedRight
              )
              if (!selectedGreek) return null
              return (
                <div className="quote-display">
                  <span className="quote-label">BID:</span>
                  <span className="quote-bid">{selectedGreek.bid.toFixed(2)}</span>
                  <span className="quote-separator">|</span>
                  <span className="quote-label">ASK:</span>
                  <span className="quote-ask">{selectedGreek.ask.toFixed(2)}</span>
                  <span className="quote-separator">|</span>
                  <span className="quote-label">LAST:</span>
                  <span className="quote-last">{selectedGreek.last.toFixed(2)}</span>
                </div>
              )
            })()}
          </div>

          {/* Submit */}
          <div className="order-actions">
            {!showConfirm ? (
              <button
                onClick={() => setShowConfirm(true)}
                className="btn btn-primary"
                disabled={qty === 0 || submitting}
              >
                預覽下單
              </button>
            ) : (
              <div className="confirm-section">
                <div className="confirm-summary">
                  確定要 <strong>{action === 'BUY' ? '買入' : '賣出'}</strong>{' '}
                  <strong>{contractDesc}</strong> 共{' '}
                  <strong>{qty}</strong> 口 x{' '}
                  <strong>{targetAccounts.length}</strong> 個帳戶，
                  限價: <strong>${limitPrice}</strong>？
                </div>
                <div className="confirm-buttons">
                  <button onClick={handleSubmit} className="btn btn-danger" disabled={submitting}>
                    {submitting ? '下單中...' : '✅ 確認下單'}
                  </button>
                  <button onClick={() => setShowConfirm(false)} className="btn btn-secondary">
                    取消
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Order Results */}
          {orderResults.length > 0 && (
            <div className="order-results">
              <h3>下單結果</h3>
              <table className="results-table">
                <thead>
                  <tr>
                    <th>訂單 ID</th>
                    <th>帳戶</th>
                    <th>合約</th>
                    <th>狀態</th>
                    <th>已成交</th>
                    <th>均價</th>
                  </tr>
                </thead>
                <tbody>
                  {orderResults.map((result) => (
                    <tr key={result.orderId}>
                      <td>{result.orderId}</td>
                      <td>{result.account}</td>
                      <td>{result.symbol}</td>
                      <td className={`status-${result.status.toLowerCase()}`}>{result.status}</td>
                      <td>
                        {result.filled} / {result.filled + result.remaining}
                      </td>
                      <td>
                        {result.avgFillPrice > 0 ? `$${result.avgFillPrice.toFixed(2)}` : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
