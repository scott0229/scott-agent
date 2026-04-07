import React from 'react'
import { useState, useEffect, useMemo, useCallback } from 'react'
import type { AccountData, PositionData } from '../hooks/useAccountStore'

interface ClosePositionDialogProps {
  open: boolean
  onClose: () => void
  selectedPositions: PositionData[]
  accounts: AccountData[]
  positions: PositionData[]
  quotes: Record<string, number>
}

interface ClosePreview {
  accountId: string
  alias: string
  sells: { symbol: string; qty: number; price: number; value: number; avgCost: number }[]
  totalSellValue: number
}

export default function ClosePositionDialog({
  open,
  onClose,
  selectedPositions,
  accounts,
  quotes
}: ClosePositionDialogProps): React.JSX.Element | null {
  const [submitting, setSubmitting] = useState(false)

  // Per-symbol sell state
  const [sellPrices, setSellPrices] = useState<Record<string, string>>({})
  const [sellQuotes, setSellQuotes] = useState<
    Record<string, { bid: number; ask: number; last: number }>
  >({})
  // sellQtyOverrides keyed by "symbol:accountId"
  const [sellQtyOverrides, setSellQtyOverrides] = useState<Record<string, number>>({})

  // Derive unique source symbols
  const sourceSymbols = useMemo(() => {
    const syms = new Set<string>()
    for (const pos of selectedPositions) {
      syms.add(pos.symbol)
    }
    return Array.from(syms).sort()
  }, [selectedPositions])

  // Group selected positions by account + symbol
  const accountSymbolPositions = useMemo(() => {
    const map = new Map<string, Map<string, { qty: number; avgCost: number }>>()
    for (const pos of selectedPositions) {
      if (!map.has(pos.account)) map.set(pos.account, new Map())
      const symMap = map.get(pos.account)!
      const existing = symMap.get(pos.symbol)
      if (existing) {
        const totalQty = existing.qty + pos.quantity
        existing.avgCost =
          totalQty > 0
            ? (existing.avgCost * existing.qty + pos.avgCost * pos.quantity) / totalQty
            : 0
        existing.qty = totalQty
      } else {
        symMap.set(pos.symbol, { qty: pos.quantity, avgCost: pos.avgCost })
      }
    }
    return map
  }, [selectedPositions])

  // Fetch sell quotes for all source symbols + auto-refresh
  useEffect(() => {
    if (sourceSymbols.length === 0) return
    const fetchAll = async (): Promise<void> => {
      for (const sym of sourceSymbols) {
        try {
          const quote = await window.ibApi.getStockQuote(sym)
          setSellQuotes((prev) => ({ ...prev, [sym]: quote }))
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
  }, [sourceSymbols])

  // Auto-fill sell prices from quotes
  useEffect(() => {
    for (const sym of sourceSymbols) {
      const lastPrice = quotes[sym] || 0
      if (lastPrice > 0 && !sellPrices[sym]) {
        setSellPrices((prev) => ({ ...prev, [sym]: lastPrice.toFixed(2) }))
      }
    }
  }, [sourceSymbols, quotes]) // eslint-disable-line react-hooks/exhaustive-deps

  // Calculate preview for each account (sell only)
  const previews = useMemo((): ClosePreview[] => {
    const result: ClosePreview[] = []

    for (const [accountId, symMap] of accountSymbolPositions) {
      const acct = accounts.find((a) => a.accountId === accountId)
      const sells: ClosePreview['sells'] = []
      let totalSellValue = 0

      for (const [symbol, posInfo] of symMap) {
        const overrideKey = `${symbol}:${accountId}`
        const qty =
          sellQtyOverrides[overrideKey] !== undefined ? sellQtyOverrides[overrideKey] : posInfo.qty
        const price = parseFloat(sellPrices[symbol] || '') || quotes[symbol] || posInfo.avgCost
        const value = qty * price
        sells.push({ symbol, qty, price, value, avgCost: posInfo.avgCost })
        totalSellValue += value
      }

      result.push({
        accountId,
        alias: acct?.alias || accountId,
        sells: sells.sort((a, b) => a.symbol.localeCompare(b.symbol)),
        totalSellValue
      })
    }

    return result.sort((a, b) => {
      const acctA = accounts.find((x) => x.accountId === a.accountId)
      const acctB = accounts.find((x) => x.accountId === b.accountId)
      return (acctB?.netLiquidation || 0) - (acctA?.netLiquidation || 0)
    })
  }, [accountSymbolPositions, accounts, sellPrices, quotes, sellQtyOverrides])

  const totalSellQty = previews.reduce(
    (s, p) => s + p.sells.reduce((ss, sell) => ss + sell.qty, 0),
    0
  )

  const handleSubmit = useCallback(async () => {
    if (previews.length === 0) return
    setSubmitting(true)

    try {
      // Place sell orders per source symbol
      for (const sym of sourceSymbols) {
        const sellAllocations: Record<string, number> = {}
        let totalQtyForSymbol = 0
        for (const p of previews) {
          const sellInfo = p.sells.find((s) => s.symbol === sym)
          if (sellInfo && sellInfo.qty > 0) {
            sellAllocations[p.accountId] = sellInfo.qty
            totalQtyForSymbol += sellInfo.qty
          }
        }
        if (Object.keys(sellAllocations).length > 0) {
          const sellRequest = {
            symbol: sym.toUpperCase(),
            action: 'SELL' as const,
            orderType: 'LMT' as const,
            limitPrice: parseFloat(sellPrices[sym] || '0'),
            totalQuantity: totalQtyForSymbol
          }
          await window.ibApi.placeBatchOrders(sellRequest, sellAllocations)
        }
      }

      setSellPrices({})
      setSellQuotes({})
      setSellQtyOverrides({})
      onClose()
    } catch (err) {
      console.error('Close position order failed:', err)
      alert('平倉下單失敗: ' + String(err))
    } finally {
      setSubmitting(false)
    }
  }, [previews, sourceSymbols, sellPrices, onClose])

  const handleClose = useCallback(() => {
    setSellPrices({})
    setSellQuotes({})
    setSellQtyOverrides({})
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
          <h2>股票平倉</h2>
          <button className="settings-close-btn" onClick={handleClose}>
            ✕
          </button>
        </div>
        <div className="stock-order-dialog-body">
          {/* Unified table */}
          {displayPreviews.length > 0 && (
            <div className="allocation-section">
              <table className="allocation-table">
                <thead>
                  <tr>
                    <th style={{ width: '30px' }}></th>
                    <th style={{ textAlign: 'left', width: '100px' }}>帳號</th>
                    <th style={{ textAlign: 'left' }}>標的</th>
                    <th style={{ width: '150px' }}>報價</th>
                    <th style={{ width: '100px' }}>限價</th>
                    <th style={{ width: '100px', textAlign: 'center' }}>數量</th>
                    <th style={{ width: '80px' }}>盈虧</th>
                  </tr>
                </thead>
                {(() => {
                  let globalRowIdx = 0
                  return sourceSymbols.map((sym, cIdx) => {
                    const quote = sellQuotes[sym]
                    const symPreviews = displayPreviews.filter((p) =>
                      p.sells.some((s) => s.symbol === sym)
                    )
                    const allRows: React.ReactNode[] = []
                    symPreviews.forEach((p) => {
                      const acct = accounts.find((a) => a.accountId === p.accountId)
                      if (!acct) return
                      const symSells = p.sells.filter((s) => s.symbol === sym)
                      const rowCount = symSells.length
                      symSells.forEach((sell, idx) => {
                        const overrideKey = `${sell.symbol}:${p.accountId}`
                        globalRowIdx++
                        allRows.push(
                          <tr key={`${p.accountId}-${sell.symbol}`} style={{ height: '32px' }}>
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
                              <span style={{ color: '#8b1a1a', fontWeight: 'bold' }}>-</span>{' '}
                              <span style={{ fontWeight: 'normal', fontSize: 12 }}>
                                {sell.symbol}
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
                                value={sellPrices[sell.symbol] || ''}
                                onChange={(e) =>
                                  setSellPrices((prev) => ({
                                    ...prev,
                                    [sell.symbol]: e.target.value
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
                                value={sell.qty}
                                onChange={(e) => {
                                  const val = parseInt(e.target.value) || 0
                                  setSellQtyOverrides((prev) => ({
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
                                const sp = parseFloat(sellPrices[sell.symbol] || '0')
                                const pnl = (sp - sell.avgCost) * sell.qty
                                if (pnl === 0) return { width: '80px' }
                                return pnl >= 0
                                  ? { width: '80px', background: '#0d7a35', color: '#fff' }
                                  : { width: '80px', background: '#dc2626', color: '#fff' }
                              })()}
                            >
                              {(() => {
                                const sp = parseFloat(sellPrices[sell.symbol] || '0')
                                const pnl = (sp - sell.avgCost) * sell.qty
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
                        key={sym}
                        style={
                          cIdx < sourceSymbols.length - 1
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
          <button className="btn btn-secondary" onClick={handleClose}>
            取消
          </button>
          <button
            className="btn btn-danger"
            disabled={submitting || totalSellQty === 0 || Object.values(sellPrices).some((p) => !p)}
            onClick={handleSubmit}
          >
            {submitting ? '下單中...' : `確認平倉 (${totalSellQty})`}
          </button>
        </div>
      </div>
    </div>
  )
}
