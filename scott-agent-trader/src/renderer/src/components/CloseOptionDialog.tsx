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
    avgCost: number
  }[]
  totalValue: number
}

export default function CloseOptionDialog({
  open,
  onClose,
  selectedPositions,
  accounts
}: CloseOptionDialogProps): React.JSX.Element | null {
  const [submitting, setSubmitting] = useState(false)

  // Per-contract price inputs, keyed by optionKey
  const [prices, setPrices] = useState<Record<string, string>>({})
  // Quotes for option contracts
  const [optQuotes, setOptQuotes] = useState<
    Record<string, { bid: number; ask: number; last: number }>
  >({})
  // Quantity overrides keyed by "optKey:accountId"
  const [qtyOverrides, setQtyOverrides] = useState<Record<string, number>>({})
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
          value,
          avgCost: posInfo.avgCost
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
            right: (c.right === 'C' || c.right === 'CALL' ? 'C' : 'P') as 'C' | 'P'
          }
          await window.ibApi.placeOptionBatchOrders(request, allocations)
        }
      }

      setPrices({})
      setOptQuotes({})
      setQtyOverrides({})
      onClose()
    } catch (err) {
      console.error('Close option order failed:', err)
      alert('期權平倉下單失敗: ' + String(err))
    } finally {
      setSubmitting(false)
    }
  }, [previews, uniqueContracts, prices, onClose])

  const handleClose = useCallback(() => {
    setPrices({})
    setOptQuotes({})
    setQtyOverrides({})
    setSubmitting(false)
    onClose()
  }, [onClose])

  if (!open) return null

  const displayPreviews = previews

  return (
    <div className="stock-order-dialog-overlay" onClick={handleClose}>
      <div
        className="stock-order-dialog"
        style={{ maxWidth: '760px' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="stock-order-dialog-header">
          <h2>期權平倉</h2>
          <button className="settings-close-btn" onClick={handleClose}>
            ✕
          </button>
        </div>
        <div className="stock-order-dialog-body">
          {/* Unified table with quotes + positions */}
          {displayPreviews.length > 0 && (
            <div className="allocation-section">
              <table className="allocation-table">
                <thead>
                  <tr>
                    <th style={{ width: '30px' }}></th>
                    <th style={{ textAlign: 'left', width: '100px' }}>帳號</th>
                    <th style={{ textAlign: 'left' }}>標的</th>
                    <th>報價</th>
                    <th>限價</th>
                    <th style={{ width: '90px', textAlign: 'center' }}>數量</th>
                    <th style={{ width: '80px' }}>盈虧</th>
                  </tr>
                </thead>
                {(() => {
                  let globalRowIdx = 0
                  return uniqueContracts.map(([key], cIdx) => {
                    const quote = optQuotes[key]
                    const contractPreviews = displayPreviews.filter((p) =>
                      p.orders.some((o) => o.optKey === key)
                    )
                    const allRows: React.ReactNode[] = []
                    contractPreviews.forEach((p) => {
                      const acct = accounts.find((a) => a.accountId === p.accountId)
                      if (!acct) return
                      const contractOrders = p.orders.filter((o) => o.optKey === key)
                      const rowCount = contractOrders.length
                      contractOrders.forEach((order, idx) => {
                        const overrideKey = `${order.optKey}:${p.accountId}`
                        globalRowIdx++
                        allRows.push(
                          <tr key={`${p.accountId}-${order.optKey}`} style={{ height: '32px' }}>
                            {idx === 0 && (
                              <>
                                <td
                                  rowSpan={rowCount}
                                  style={{
                                    textAlign: 'right',
                                    borderBottom: '1px solid #b0b0b0',
                                    fontSize: 12
                                  }}
                                >
                                  {`${globalRowIdx}.`}
                                </td>
                                <td
                                  rowSpan={rowCount}
                                  style={{
                                    fontWeight: 'normal',
                                    textAlign: 'left',
                                    borderBottom: '1px solid #b0b0b0',
                                    paddingLeft: '4px'
                                  }}
                                >
                                  {p.alias}
                                </td>
                              </>
                            )}
                            <td
                              style={{
                                textAlign: 'left',
                                fontWeight: 'bold',
                                whiteSpace: 'nowrap'
                              }}
                            >
                              <span
                                style={{
                                  color: order.action === 'BUY' ? '#1a6b3a' : '#8b1a1a',
                                  fontWeight: 'bold'
                                }}
                              >
                                {order.action === 'BUY' ? '+' : '-'}
                              </span>{' '}
                              <span style={{ fontWeight: 'normal', fontSize: 12 }}>
                                {order.label}
                              </span>
                            </td>
                            <td
                              style={{
                                fontFamily: "'SF Mono','Consolas',monospace",
                                fontSize: 13,
                                whiteSpace: 'nowrap'
                              }}
                            >
                              <span style={{ color: '#15803d' }}>
                                {quote ? quote.bid.toFixed(2) : '-'}
                              </span>
                              {' / '}
                              <span style={{ color: '#b91c1c' }}>
                                {quote ? quote.ask.toFixed(2) : '-'}
                              </span>
                              {' / '}
                              <span
                                style={{
                                  background: '#fff9db',
                                  padding: '1px 6px',
                                  borderRadius: 3,
                                  color: '#1d4ed8'
                                }}
                              >
                                {quote && quote.bid > 0 && quote.ask > 0
                                  ? ((quote.bid + quote.ask) / 2).toFixed(2)
                                  : quote
                                    ? quote.last.toFixed(2)
                                    : '-'}
                              </span>
                            </td>
                            <td style={{ padding: '4px 6px', textAlign: 'center' }}>
                              <input
                                type="number"
                                value={prices[order.optKey] || ''}
                                onChange={(e) =>
                                  setPrices((prev) => ({
                                    ...prev,
                                    [order.optKey]: e.target.value
                                  }))
                                }
                                className="input-field"
                                style={{
                                  width: '70px',
                                  textAlign: 'center',
                                  fontFamily: "'SF Mono','Consolas',monospace",
                                  fontSize: 13
                                }}
                                step="0.01"
                                placeholder="0.00"
                              />
                            </td>
                            <td style={{ textAlign: 'center' }}>
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
                            </td>
                            <td
                              style={(() => {
                                const sp = parseFloat(prices[order.optKey] || '0') * 100
                                const pnl =
                                  order.action === 'SELL'
                                    ? (sp - order.avgCost) * order.qty
                                    : (order.avgCost - sp) * order.qty
                                if (pnl === 0) return { width: '80px' }
                                return pnl >= 0
                                  ? { width: '80px', background: '#0d7a35', color: '#fff' }
                                  : { width: '80px', background: '#dc2626', color: '#fff' }
                              })()}
                            >
                              {(() => {
                                const sp = parseFloat(prices[order.optKey] || '0') * 100
                                const pnl =
                                  order.action === 'SELL'
                                    ? (sp - order.avgCost) * order.qty
                                    : (order.avgCost - sp) * order.qty
                                return pnl !== 0
                                  ? pnl.toLocaleString('en-US', { maximumFractionDigits: 0 })
                                  : '-'
                              })()}
                            </td>
                          </tr>
                        )
                      })
                    })
                    return (
                      <tbody
                        key={key}
                        style={
                          cIdx < uniqueContracts.length - 1
                            ? { borderBottom: '2px solid #e5e7eb' }
                            : undefined
                        }
                      >
                        {allRows}
                      </tbody>
                    )
                  })
                })()}
              </table>
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div
          className="stock-order-dialog-footer confirm-buttons"
          style={{
            padding: '16px 20px',
            borderTop: '1px solid var(--border-color)',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '12px',
            background: 'var(--bg-primary)',
            borderRadius: '0 0 12px 12px'
          }}
        >
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            disabled={submitting}
          >
            取消
          </button>

          <button
            className="btn btn-danger"
            disabled={submitting || totalQty === 0 || Object.values(prices).some((p) => !p)}
            onClick={handleSubmit}
          >
            {submitting ? '下單中...' : `確認平倉 (${totalQty})`}
          </button>
        </div>
      </div>
    </div>
  )
}
