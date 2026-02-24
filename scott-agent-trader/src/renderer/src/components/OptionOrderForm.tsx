import React from 'react'
import { useState, useEffect, useCallback, useMemo } from 'react'
import OptionChainTable from './OptionChainTable'
import CustomSelect from './CustomSelect'
import type { AccountData } from '../hooks/useAccountStore'

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
  accounts: AccountData[]
}

export default function OptionOrderForm({
  connected,
  accounts
}: OptionOrderFormProps): React.JSX.Element {
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

  const [orderResults, setOrderResults] = useState<OrderResult[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [outsideRth, setOutsideRth] = useState(false)

  // Listen for order status updates
  useEffect(() => {
    const unsubscribe = window.ibApi.onOrderStatus((update: OrderResult) => {
      setOrderResults((prev) =>
        prev.map((r) =>
          r.orderId === update.orderId
            ? { ...r, ...update, account: r.account, symbol: r.symbol }
            : r
        )
      )
    })

    return () => {
      unsubscribe()
    }
  }, [])

  // Merge all expirations and strikes across all exchanges
  const availableExpirations = useMemo(() => {
    const set = new Set<string>()
    chainParams.forEach((p) => p.expirations.forEach((e) => set.add(e)))
    return Array.from(set).sort()
  }, [chainParams])

  const availableStrikes = useMemo(() => {
    const set = new Set<number>()
    chainParams.forEach((p) => p.strikes.forEach((s) => set.add(s)))
    return Array.from(set).sort((a, b) => a - b)
  }, [chainParams])

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
    selectedUser === 'ALL'
      ? sortedAccounts
      : sortedAccounts.filter((a) => a.accountId === selectedUser)
  const allocations: Record<string, number> = {}
  for (const acct of targetAccounts) {
    if (qty > 0) allocations[acct.accountId] = qty
  }
  const totalAllocated = Object.values(allocations).reduce((sum, q) => sum + q, 0)

  const handleSubmit = useCallback(async () => {
    if (selectedStrike === null || selectedRight === null || !selectedExpiry) return

    setSubmitting(true)
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
        exchange: 'SMART',
        outsideRth
      }

      const results = await window.ibApi.placeOptionBatchOrders(request, allocations)
      setOrderResults(results)
    } catch (err: unknown) {
      console.error('Option batch order failed:', err)
    } finally {
      setSubmitting(false)
    }
  }, [
    symbol,
    action,
    limitPrice,
    selectedExpiry,
    selectedStrike,
    selectedRight,
    allocations,
    totalAllocated,
    outsideRth
  ])

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
              {loadingChain ? '查詢中...' : '查詢期權鏈'}
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
                    ...availableExpirations.map((exp) => {
                      const y = parseInt(exp.substring(0, 4))
                      const m = parseInt(exp.substring(4, 6)) - 1
                      const d = parseInt(exp.substring(6, 8))
                      const expiryDate = new Date(y, m, d)
                      const today = new Date()
                      today.setHours(0, 0, 0, 0)
                      const diffDays = Math.round(
                        (expiryDate.getTime() - today.getTime()) / 86400000
                      )
                      const months = [
                        'Jan',
                        'Feb',
                        'Mar',
                        'Apr',
                        'May',
                        'Jun',
                        'Jul',
                        'Aug',
                        'Sep',
                        'Oct',
                        'Nov',
                        'Dec'
                      ]
                      const formatted = `${months[m]} ${d} '${String(y).slice(2)}`
                      return {
                        value: exp,
                        label: `${formatted} (${diffDays}天)`
                      }
                    })
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
                      label: acct.alias || acct.accountId
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
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '13px',
              cursor: 'pointer',
              marginTop: '8px'
            }}
          >
            <input
              type="checkbox"
              checked={outsideRth}
              onChange={(e) => setOutsideRth(e.target.checked)}
            />
            允許盤前盤後
          </label>

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
                  {orderResults.length > 0 ? (
                    '下單結果'
                  ) : (
                    <>
                      確定要 <strong>{action === 'BUY' ? '買入' : '賣出'}</strong>{' '}
                      <strong>{contractDesc}</strong> 共 <strong>{qty}</strong> 口 x{' '}
                      <strong>{targetAccounts.length}</strong> 個帳戶， 限價:{' '}
                      <strong>{limitPrice}</strong>？
                    </>
                  )}
                </div>
                <table className="allocation-table">
                  <thead>
                    <tr>
                      <th style={{ width: '1%', whiteSpace: 'nowrap' }}></th>
                      <th style={{ width: '25%' }}>帳戶</th>
                      <th style={{ width: '30%' }}>合約</th>
                      <th style={{ width: '10%' }}>數量</th>
                      <th style={{ width: '20%' }}>狀態</th>
                      {orderResults.length > 0 && <th style={{ width: '8%' }}>操作</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {targetAccounts.map((acct, index) => {
                      const result = orderResults.find((r) => r.account === acct.accountId)
                      const canCancel =
                        result && !['Filled', 'Cancelled', 'Inactive'].includes(result.status)
                      return (
                        <tr key={acct.accountId}>
                          <td>{index + 1}.</td>
                          <td style={{ fontWeight: 'bold' }}>{acct.alias || acct.accountId}</td>
                          <td>{contractDesc}</td>
                          <td style={{ color: '#1a3a6b' }}>{qty}</td>
                          <td>
                            {result ? (
                              <span className={`status-${result.status.toLowerCase()}`}>
                                {result.status}{' '}
                                {result.filled > 0
                                  ? `(${result.filled}/${result.filled + result.remaining})`
                                  : ''}
                              </span>
                            ) : orderResults.length > 0 ? (
                              '-'
                            ) : (
                              ''
                            )}
                          </td>
                          {orderResults.length > 0 && (
                            <td>
                              {canCancel && (
                                <button
                                  className="btn btn-secondary"
                                  style={{ padding: '2px 8px', fontSize: '12px' }}
                                  onClick={() => window.ibApi.cancelOrder(result.orderId)}
                                >
                                  取消
                                </button>
                              )}
                            </td>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                <div className="confirm-buttons">
                  {orderResults.length === 0 && (
                    <>
                      <button
                        onClick={handleSubmit}
                        className="btn btn-danger"
                        disabled={submitting}
                      >
                        {submitting ? '下單中...' : '✅ 確認下單'}
                      </button>
                      <button onClick={() => setShowConfirm(false)} className="btn btn-secondary">
                        取消
                      </button>
                    </>
                  )}
                  {orderResults.length > 0 && (
                    <button
                      onClick={() => {
                        setShowConfirm(false)
                        setOrderResults([])
                        setSelectedUser('ALL')
                        setQuantity('')
                      }}
                      className="btn btn-secondary"
                    >
                      重新下單
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
