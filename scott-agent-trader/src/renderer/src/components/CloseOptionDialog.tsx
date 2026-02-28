import React from 'react'
import { useState, useEffect, useMemo, useCallback } from 'react'
import type { AccountData, PositionData } from '../hooks/useAccountStore'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function formatOptionLabel(
  symbol: string,
  expiry?: string,
  strike?: number,
  right?: string
): string {
  if (!expiry || strike === undefined || !right) return symbol
  const yy = expiry.slice(2, 4)
  const m = MONTHS[parseInt(expiry.slice(4, 6), 10) - 1] || expiry.slice(4, 6)
  const d = parseInt(expiry.slice(6, 8), 10)
  const r = right === 'C' || right === 'CALL' ? 'C' : 'P'
  return `${symbol} ${m}${d}'${yy} ${strike}${r}`
}

// Unique key for an option contract
function optionKey(pos: PositionData): string {
  return `${pos.symbol}|${pos.expiry || ''}|${pos.strike || ''}|${pos.right || ''}`
}

interface CloseOptionDialogProps {
  open: boolean
  onClose: () => void
  selectedPositions: PositionData[]
  accounts: AccountData[]
  positions: PositionData[]
}

interface CloseOptionPreview {
  accountId: string
  alias: string
  orders: {
    optKey: string
    label: string
    symbol: string
    expiry: string
    strike: number
    right: 'C' | 'P'
    action: 'BUY' | 'SELL'
    qty: number
    price: number
    value: number
  }[]
  totalValue: number
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

export default function CloseOptionDialog({
  open,
  onClose,
  selectedPositions,
  accounts,
  positions: _positions
}: CloseOptionDialogProps): React.JSX.Element | null {
  const [submitting, setSubmitting] = useState(false)
  const [orderResults, setOrderResults] = useState<OrderResult[]>([])
  const [step, setStep] = useState<'preview' | 'confirm' | 'done'>('preview')
  const [confirmedPreviews, setConfirmedPreviews] = useState<CloseOptionPreview[]>([])

  // Per-contract price inputs, keyed by optionKey
  const [prices, setPrices] = useState<Record<string, string>>({})
  // Per-contract TIF
  const [tifs, setTifs] = useState<Record<string, 'DAY' | 'GTC'>>({})
  const [outsideRths, setOutsideRths] = useState<Record<string, boolean>>({})
  // Quotes for option contracts
  const [optQuotes, setOptQuotes] = useState<
    Record<string, { bid: number; ask: number; last: number }>
  >({})
  // Quantity overrides keyed by "optKey:accountId"
  const [qtyOverrides, setQtyOverrides] = useState<Record<string, number>>({})
  // TIF dropdown open
  const [tifOpen, setTifOpen] = useState<string | null>(null)

  // Derive unique option contracts from selected positions
  const uniqueContracts = useMemo(() => {
    const map = new Map<
      string,
      { symbol: string; expiry: string; strike: number; right: string; label: string }
    >()
    for (const pos of selectedPositions) {
      if (pos.secType !== 'OPT') continue
      const key = optionKey(pos)
      if (!map.has(key)) {
        map.set(key, {
          symbol: pos.symbol,
          expiry: pos.expiry || '',
          strike: pos.strike || 0,
          right: pos.right || '',
          label: formatOptionLabel(pos.symbol, pos.expiry, pos.strike, pos.right)
        })
      }
    }
    return Array.from(map.entries())
  }, [selectedPositions])

  // Group selected positions by account + optionKey
  const accountOptionPositions = useMemo(() => {
    const map = new Map<string, Map<string, { qty: number; avgCost: number }>>()
    for (const pos of selectedPositions) {
      if (pos.secType !== 'OPT') continue
      if (!map.has(pos.account)) map.set(pos.account, new Map())
      const oMap = map.get(pos.account)!
      const key = optionKey(pos)
      const existing = oMap.get(key)
      if (existing) {
        existing.qty += pos.quantity
      } else {
        oMap.set(key, { qty: pos.quantity, avgCost: pos.avgCost })
      }
    }
    return map
  }, [selectedPositions])

  // Close TIF dropdowns on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent): void => {
      const target = e.target as HTMLElement
      if (target.closest('.tif-dropdown')) return
      setTifOpen(null)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Fetch option quotes + auto-refresh
  useEffect(() => {
    if (uniqueContracts.length === 0) return
    const fetchAll = async (): Promise<void> => {
      for (const [, c] of uniqueContracts) {
        try {
          const contracts = [
            {
              symbol: c.symbol,
              expiry: c.expiry,
              strike: c.strike,
              right: c.right
            }
          ]
          const result = await window.ibApi.getOptionQuotes(contracts)
          // getOptionQuotes returns Record<key, price> — we need bid/ask/last
          // Try getStockQuote-like approach or use the option greeks
          // For simplicity, use the returned price as mid/last
          const key = optionKey({
            account: '',
            symbol: c.symbol,
            secType: 'OPT',
            quantity: 0,
            avgCost: 0,
            expiry: c.expiry,
            strike: c.strike,
            right: c.right
          })
          const priceVal = (Object.values(result)[0] as number) || 0
          setOptQuotes((prev) => ({
            ...prev,
            [key]: { bid: priceVal, ask: priceVal, last: priceVal }
          }))
        } catch {
          // ignore
        }
      }
    }
    const timer = setTimeout(fetchAll, 300)
    const interval = setInterval(fetchAll, 5000)
    return () => {
      clearTimeout(timer)
      clearInterval(interval)
    }
  }, [uniqueContracts])

  // Auto-fill prices from quotes
  useEffect(() => {
    for (const [key] of uniqueContracts) {
      const quote = optQuotes[key]
      if (quote && quote.last > 0 && !prices[key]) {
        setPrices((prev) => ({ ...prev, [key]: quote.last.toFixed(2) }))
      }
    }
  }, [uniqueContracts, optQuotes]) // eslint-disable-line react-hooks/exhaustive-deps

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

  // Calculate preview
  const previews = useMemo((): CloseOptionPreview[] => {
    const result: CloseOptionPreview[] = []

    for (const [accountId, oMap] of accountOptionPositions) {
      const acct = accounts.find((a) => a.accountId === accountId)
      const orders: CloseOptionPreview['orders'] = []
      let totalValue = 0

      for (const [key, posInfo] of oMap) {
        const contract = uniqueContracts.find(([k]) => k === key)
        if (!contract) continue
        const [, c] = contract

        const overrideKey = `${key}:${accountId}`
        const qty =
          qtyOverrides[overrideKey] !== undefined
            ? qtyOverrides[overrideKey]
            : Math.abs(posInfo.qty)
        const price = parseFloat(prices[key] || '') || optQuotes[key]?.last || 0 || posInfo.avgCost
        const value = qty * price * 100 // Option multiplier
        const action: 'BUY' | 'SELL' = posInfo.qty < 0 ? 'BUY' : 'SELL'

        orders.push({
          optKey: key,
          label: c.label,
          symbol: c.symbol,
          expiry: c.expiry,
          strike: c.strike,
          right: (c.right === 'C' || c.right === 'CALL' ? 'C' : 'P') as 'C' | 'P',
          action,
          qty,
          price,
          value
        })
        totalValue += value
      }

      result.push({
        accountId,
        alias: acct?.alias || accountId,
        orders: orders.sort((a, b) => a.label.localeCompare(b.label)),
        totalValue
      })
    }

    return result.sort((a, b) => {
      const acctA = accounts.find((x) => x.accountId === a.accountId)
      const acctB = accounts.find((x) => x.accountId === b.accountId)
      return (acctB?.netLiquidation || 0) - (acctA?.netLiquidation || 0)
    })
  }, [accountOptionPositions, accounts, prices, optQuotes, qtyOverrides, uniqueContracts])

  const totalQty = previews.reduce((s, p) => s + p.orders.reduce((ss, o) => ss + o.qty, 0), 0)

  const handleSubmit = useCallback(async () => {
    if (previews.length === 0) return
    setSubmitting(true)

    try {
      const allResults: OrderResult[] = []

      // Place orders per unique option contract
      for (const [key, c] of uniqueContracts) {
        const allocations: Record<string, number> = {}
        let totalQtyForContract = 0
        // Determine action from the first preview that has this contract
        let action: 'BUY' | 'SELL' = 'SELL'

        for (const p of previews) {
          const orderInfo = p.orders.find((o) => o.optKey === key)
          if (orderInfo && orderInfo.qty > 0) {
            allocations[p.accountId] = orderInfo.qty
            totalQtyForContract += orderInfo.qty
            action = orderInfo.action
          }
        }

        if (Object.keys(allocations).length > 0) {
          const request = {
            symbol: c.symbol.toUpperCase(),
            action,
            orderType: 'LMT' as const,
            limitPrice: parseFloat(prices[key] || '0'),
            totalQuantity: totalQtyForContract,
            expiry: c.expiry,
            strike: c.strike,
            right: (c.right === 'C' || c.right === 'CALL' ? 'C' : 'P') as 'C' | 'P',
            outsideRth: outsideRths[key] || false
          }
          const results = await window.ibApi.placeOptionBatchOrders(request, allocations)
          allResults.push(
            ...results.map((r: OrderResult) => ({
              ...r,
              symbol: c.label
            }))
          )
        }
      }

      setOrderResults(allResults)
      setStep('done')
    } catch (err) {
      console.error('Close option order failed:', err)
      alert('期權平倉下單失敗: ' + String(err))
    } finally {
      setSubmitting(false)
    }
  }, [previews, uniqueContracts, prices, outsideRths])

  const handleClose = useCallback(() => {
    setStep('preview')
    setOrderResults([])
    setPrices({})
    setTifs({})
    setOutsideRths({})
    setOptQuotes({})
    setQtyOverrides({})
    setSubmitting(false)
    setConfirmedPreviews([])
    onClose()
  }, [onClose])

  // TIF dropdown renderer
  const renderTifDropdown = (
    _key: string,
    tif: 'DAY' | 'GTC',
    outsideRth: boolean,
    isOpen: boolean,
    setTif: (v: 'DAY' | 'GTC') => void,
    setOutsideRthVal: (v: boolean) => void,
    setOpen: (v: boolean) => void
  ): React.JSX.Element => (
    <div className="tif-dropdown">
      <button
        type="button"
        className={`tif-dropdown-trigger${outsideRth ? ' has-extras' : ''}`}
        onClick={() => setOpen(!isOpen)}
      >
        {tif}
        <span className="tif-dropdown-arrow">▾</span>
      </button>
      {isOpen && (
        <div className="tif-dropdown-menu">
          <div
            className={`tif-dropdown-option${tif === 'DAY' ? ' selected' : ''}`}
            onClick={() => {
              setTif('DAY')
              setOpen(false)
            }}
          >
            DAY
          </div>
          <div
            className={`tif-dropdown-option${tif === 'GTC' ? ' selected' : ''}`}
            onClick={() => {
              setTif('GTC')
              setOpen(false)
            }}
          >
            GTC
          </div>
          <div
            className="tif-dropdown-checkbox"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setOutsideRthVal(!outsideRth)
            }}
          >
            <input type="checkbox" checked={outsideRth} readOnly />
            非常規時間
          </div>
        </div>
      )}
    </div>
  )

  if (!open) return null

  const displayPreviews = step === 'preview' ? previews : confirmedPreviews

  return (
    <div className="stock-order-dialog-overlay" onClick={handleClose}>
      <div
        className="stock-order-dialog"
        style={{ maxWidth: '900px' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="stock-order-dialog-header">
          <h2>期權平倉</h2>
          <button className="settings-close-btn" onClick={handleClose}>
            ✕
          </button>
        </div>
        <div className="stock-order-dialog-body">
          {/* Per-contract price/TIF row */}
          {uniqueContracts.map(([key, c]) => {
            const quote = optQuotes[key]
            const tif = tifs[key] || 'DAY'
            const outsideRth = outsideRths[key] || false
            // Determine action from first position
            const firstPos = selectedPositions.find(
              (p) => p.secType === 'OPT' && optionKey(p) === key
            )
            const action = firstPos && firstPos.quantity < 0 ? '買入' : '賣出'
            const actionColor = firstPos && firstPos.quantity < 0 ? '#1a6b3a' : '#8b1a1a'

            return (
              <div
                key={key}
                className="order-form"
                style={{ marginBottom: '20px' }}
              >
                <div
                  style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}
                >
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <span style={{ display: 'inline-flex', gap: '8px', alignItems: 'center', width: '220px' }}>
                      <span style={{ fontWeight: 600, fontSize: '13px', color: actionColor }}>{action}</span>
                      <span style={{ fontWeight: 600, fontSize: '13px' }}>{c.label}</span>
                    </span>
                    <span className="roll-order-label">限價</span>
                    <input
                      type="number"
                      value={prices[key] || ''}
                      onChange={(e) =>
                        setPrices((prev) => ({
                          ...prev,
                          [key]: e.target.value
                        }))
                      }
                      className="input-field"
                      style={{ width: '90px' }}
                      step="0.01"
                      placeholder="0.00"
                    />
                    {renderTifDropdown(
                      key,
                      tif,
                      outsideRth,
                      tifOpen === key,
                      (v) => setTifs((prev) => ({ ...prev, [key]: v })),
                      (v) => setOutsideRths((prev) => ({ ...prev, [key]: v })),
                      (v) => setTifOpen(v ? key : null)
                    )}
                  </div>
                  {quote && (
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center', fontSize: 13, flex: '0 0 auto' }}>
                      <span className="roll-order-value roll-order-bid">{quote.bid.toFixed(2)}</span>
                      <span className="quote-separator">|</span>
                      <span className="roll-order-value roll-order-ask">{quote.ask.toFixed(2)}</span>
                      <span className="quote-separator">|</span>
                      <span className="roll-order-label">中間價</span>
                      <span className="roll-order-value roll-order-mid">
                        {quote.bid > 0 && quote.ask > 0
                          ? ((quote.bid + quote.ask) / 2).toFixed(2)
                          : quote.last.toFixed(2)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )
          })}

          {/* Preview table */}
          {displayPreviews.length > 0 && (
            <div className="allocation-section">
              <table className="allocation-table">
                <thead>
                  <tr>
                    <th style={{ width: '22%', textAlign: 'left' }}>帳號</th>
                    <th style={{ width: '10%' }}>淨值</th>
                    <th style={{ width: '10%' }}>現金</th>
                    <th style={{ width: '8%' }}>方向</th>
                    <th style={{ width: '18%' }}>期權</th>
                    <th style={{ width: '10%' }}>價格</th>
                    <th style={{ width: '10%' }}>數量</th>
                    {step === 'done' && <th style={{ width: '10%' }}>狀態</th>}
                  </tr>
                </thead>
                <>
                  {displayPreviews.map((p) => {
                    const acct = accounts.find((a) => a.accountId === p.accountId)
                    if (!acct) return null
                    const rowCount = p.orders.length
                    const isLast = displayPreviews.indexOf(p) === displayPreviews.length - 1
                    return (
                      <tbody
                        key={p.accountId}
                        style={isLast ? undefined : { borderBottom: '2px solid #e5e7eb' }}
                      >
                        {p.orders.map((order, idx) => {
                          const orderResult = orderResults.find(
                            (r) => r.account === p.accountId && r.symbol === order.label
                          )
                          const overrideKey = `${order.optKey}:${p.accountId}`
                          return (
                            <tr key={`${p.accountId}-${order.optKey}`} style={{ height: '44px' }}>
                              {idx === 0 && (
                                <>
                                  <td
                                    rowSpan={rowCount}
                                    style={{
                                      fontWeight: 'bold',
                                      textAlign: 'left',
                                      borderBottom: '1px solid #b0b0b0'
                                    }}
                                  >
                                    {p.alias}
                                  </td>
                                  <td
                                    rowSpan={rowCount}
                                    style={{ borderBottom: '1px solid #b0b0b0' }}
                                  >
                                    {acct.netLiquidation.toLocaleString('en-US', {
                                      maximumFractionDigits: 0
                                    })}
                                  </td>
                                  <td
                                    rowSpan={rowCount}
                                    style={{
                                      borderBottom: '1px solid #b0b0b0',
                                      ...(acct.totalCashValue < 0 ? { color: '#8b1a1a' } : {})
                                    }}
                                  >
                                    {acct.totalCashValue.toLocaleString('en-US', {
                                      maximumFractionDigits: 0
                                    })}
                                  </td>
                                </>
                              )}
                              <td
                                style={{
                                  color: order.action === 'BUY' ? '#1a6b3a' : '#8b1a1a',
                                  fontWeight: 'bold'
                                }}
                              >
                                {order.action === 'BUY' ? '買入' : '賣出'}
                              </td>
                              <td
                                style={{
                                  fontSize: '0.93em',
                                  paddingTop: '8px',
                                  paddingBottom: '8px'
                                }}
                              >
                                {order.label}
                              </td>
                              <td style={{ paddingTop: '8px', paddingBottom: '8px' }}>
                                {prices[order.optKey] || '-'}
                              </td>
                              <td>
                                {step === 'preview' ? (
                                  <input
                                    type="number"
                                    value={order.qty}
                                    onChange={(e) => {
                                      const val = parseInt(e.target.value) || 0
                                      setQtyOverrides((prev) => ({
                                        ...prev,
                                        [overrideKey]: val
                                      }))
                                    }}
                                    className="input-field"
                                    style={{ width: '70px', textAlign: 'center' }}
                                  />
                                ) : (
                                  order.qty.toLocaleString()
                                )}
                              </td>
                              {step === 'done' && (
                                <td style={{ fontSize: '11px' }}>
                                  {orderResult ? orderResult.status : '-'}
                                </td>
                              )}
                            </tr>
                          )
                        })}
                      </tbody>
                    )
                  })}
                </>
              </table>
            </div>
          )}

          {/* Action buttons */}
          <div className="confirm-buttons" style={{ marginTop: '16px' }}>
            {step === 'preview' && (
              <button
                className="btn btn-primary"
                disabled={totalQty === 0 || Object.values(prices).some((p) => !p)}
                onClick={() => {
                  setConfirmedPreviews(previews)
                  setStep('confirm')
                }}
              >
                預覽下單
              </button>
            )}
            {step === 'confirm' && (
              <>
                <button className="btn btn-danger" disabled={submitting} onClick={handleSubmit}>
                  {submitting ? '下單中...' : '確認平倉'}
                </button>
                <button
                  className="btn btn-secondary"
                  disabled={submitting}
                  onClick={() => setStep('preview')}
                >
                  返回修改
                </button>
              </>
            )}
            {step === 'done' && (
              <button className="btn btn-secondary" onClick={handleClose}>
                關閉
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
