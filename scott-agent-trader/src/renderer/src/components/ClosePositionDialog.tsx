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
  sells: { symbol: string; qty: number; price: number; value: number }[]
  totalSellValue: number
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

export default function ClosePositionDialog({
  open,
  onClose,
  selectedPositions,
  accounts,
  positions,
  quotes
}: ClosePositionDialogProps): React.JSX.Element | null {
  const [submitting, setSubmitting] = useState(false)
  const [orderResults, setOrderResults] = useState<OrderResult[]>([])
  const [step, setStep] = useState<'preview' | 'confirm' | 'done'>('preview')
  const [confirmedPreviews, setConfirmedPreviews] = useState<ClosePreview[]>([])

  // Per-symbol sell state
  const [sellPrices, setSellPrices] = useState<Record<string, string>>({})
  const [sellTifs, setSellTifs] = useState<Record<string, 'DAY' | 'GTC'>>({})
  const [sellOutsideRths, setSellOutsideRths] = useState<Record<string, boolean>>({})
  const [sellQuotes, setSellQuotes] = useState<
    Record<string, { bid: number; ask: number; last: number }>
  >({})
  // sellQtyOverrides keyed by "symbol:accountId"
  const [sellQtyOverrides, setSellQtyOverrides] = useState<Record<string, number>>({})

  // TIF dropdown open states (per-symbol for sell)
  const [sellTifOpen, setSellTifOpen] = useState<string | null>(null)

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

  // Close TIF dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent): void => {
      const target = e.target as HTMLElement
      if (target.closest('.tif-dropdown')) return
      setSellTifOpen(null)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

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

  // Calculate preview for each account (sell only, no buy)
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
        sells.push({ symbol, qty, price, value })
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
      const allResults: OrderResult[] = []

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
            totalQuantity: totalQtyForSymbol,
            outsideRth: sellOutsideRths[sym] || false,
            tif: sellTifs[sym] || 'DAY'
          }
          const sellResults = await window.ibApi.placeBatchOrders(sellRequest, sellAllocations)
          allResults.push(...sellResults.map((r: OrderResult) => ({ ...r, symbol: sym })))
        }
      }

      setOrderResults(allResults)
      setStep('done')
    } catch (err) {
      console.error('Close position order failed:', err)
      alert('平倉下單失敗: ' + String(err))
    } finally {
      setSubmitting(false)
    }
  }, [previews, sourceSymbols, sellPrices, sellTifs, sellOutsideRths])

  const handleClose = useCallback(() => {
    setSellPrices({})
    setSellTifs({})
    setSellOutsideRths({})
    setSellQuotes({})
    setSellQtyOverrides({})
    setOrderResults([])
    setStep('preview')
    setConfirmedPreviews([])
    setSubmitting(false)
    setSellTifOpen(null)
    onClose()
  }, [onClose])

  if (!open) return null

  const renderTifDropdown = (
    _sym: string | null,
    tif: 'DAY' | 'GTC',
    setTif: (v: 'DAY' | 'GTC') => void,
    outsideRth: boolean,
    setOutsideRth: (v: boolean) => void,
    isOpen: boolean,
    setIsOpen: (v: boolean) => void
  ): React.JSX.Element => (
    <div
      className="tif-dropdown"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className={`tif-dropdown-trigger${outsideRth ? ' has-extras' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        disabled={step !== 'preview'}
      >
        {outsideRth ? <span className="tif-indicator" /> : null}
        {tif}
        <span className="tif-dropdown-arrow">▾</span>
      </button>
      {isOpen && (
        <div className="tif-dropdown-menu">
          <div
            className={`tif-dropdown-item${tif === 'DAY' ? ' active' : ''}`}
            onClick={() => {
              setTif('DAY')
            }}
          >
            DAY
          </div>
          <div
            className={`tif-dropdown-item${tif === 'GTC' ? ' active' : ''}`}
            onClick={() => {
              setTif('GTC')
            }}
          >
            GTC
          </div>
          <div className="tif-dropdown-separator" />
          <div
            className="tif-dropdown-checkbox"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setOutsideRth(!outsideRth)
            }}
          >
            <input type="checkbox" checked={outsideRth} readOnly />
            非常規時間
          </div>
        </div>
      )}
    </div>
  )

  const confirmedSourceSymbols =
    step === 'preview'
      ? sourceSymbols
      : [...new Set(confirmedPreviews.flatMap((p) => p.sells.map((s) => s.symbol)))]

  return (
    <div className="stock-order-dialog-overlay" onClick={handleClose}>
      <div className="stock-order-dialog transfer-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="stock-order-dialog-header">
          <h2>股票平倉</h2>
          <button className="settings-close-btn" onClick={handleClose}>
            ✕
          </button>
        </div>
        <div className="stock-order-dialog-body">
          {/* Sell rows: one per source symbol */}
          {sourceSymbols.map((sym) => {
            const quote = sellQuotes[sym]
            return (
              <div
                className="order-form"
                key={`sell-${sym}`}
                style={sym !== sourceSymbols[0] ? { marginTop: '8px' } : undefined}
              >
                <div className="form-row">
                  <div className="form-group" style={{ flex: '0 0 auto' }}>
                    <span
                      style={{
                        fontWeight: 600,
                        fontSize: '13px',
                        color: '#8b1a1a',
                        padding: '6px 0'
                      }}
                    >
                      賣出
                    </span>
                  </div>
                  <div className="form-group" style={{ flex: '0 0 80px' }}>
                    <input
                      type="text"
                      value={sym}
                      className="input-field"
                      disabled
                      style={{ textTransform: 'uppercase' }}
                    />
                  </div>
                  <div className="form-group">
                    <input
                      type="number"
                      value={sellPrices[sym] || ''}
                      onChange={(e) =>
                        setSellPrices((prev) => ({ ...prev, [sym]: e.target.value }))
                      }
                      placeholder="限價"
                      step="0.01"
                      className="input-field"
                      disabled={step !== 'preview'}
                    />
                  </div>
                  <div className="form-group" style={{ flex: '0 0 auto' }}>
                    {renderTifDropdown(
                      sym,
                      sellTifs[sym] || 'DAY',
                      (v) => setSellTifs((prev) => ({ ...prev, [sym]: v })),
                      sellOutsideRths[sym] || false,
                      (v) => setSellOutsideRths((prev) => ({ ...prev, [sym]: v })),
                      sellTifOpen === sym,
                      (v) => setSellTifOpen(v ? sym : null)
                    )}
                  </div>
                  {quote && (
                    <div className="quote-display" style={{ flex: '0 0 auto', fontSize: 13 }}>
                      <span className="quote-bid">{quote.bid.toFixed(2)}</span>
                      <span className="quote-separator">|</span>
                      <span className="quote-ask">{quote.ask.toFixed(2)}</span>
                      <span className="quote-separator">|</span>
                      <span className="quote-label" style={{ fontWeight: 400 }}>最後價</span>
                      <span className="quote-last" style={{ color: '#1d4ed8' }}>
                        {quote.last.toFixed(2)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )
          })}

          {/* Preview table (sell only, no buy row) */}
          {(step === 'preview' ? previews : confirmedPreviews).length > 0 && (
            <div className="allocation-section">
              <table className="allocation-table">
                <thead>
                  <tr>
                    <th style={{ width: '22%', textAlign: 'left' }}>帳號</th>
                    <th style={{ width: '10%' }}>淨值</th>
                    <th style={{ width: '10%' }}>現金</th>
                    <th style={{ width: '10%' }}>新潛在融資</th>
                    <th style={{ width: '7%' }}>方向</th>
                    <th style={{ width: '8%' }}>標的</th>
                    <th style={{ width: '10%' }}>價格</th>
                    <th style={{ width: '10%' }}>數量</th>
                    {step === 'done' && <th style={{ width: '10%' }}>狀態</th>}
                  </tr>
                </thead>
                <>
                  {(step === 'preview' ? previews : confirmedPreviews).map((p) => {
                    const acct = accounts.find((a) => a.accountId === p.accountId)
                    if (!acct) return null
                    const rowCount = p.sells.length
                    const isLast =
                      (step === 'preview' ? previews : confirmedPreviews).indexOf(p) ===
                      (step === 'preview' ? previews : confirmedPreviews).length - 1
                    return (
                      <tbody
                        key={p.accountId}
                        style={isLast ? undefined : { borderBottom: '2px solid #e5e7eb' }}
                      >
                        {p.sells.map((sell, idx) => {
                          const sellResult = orderResults.find(
                            (r) => r.account === p.accountId && r.symbol === sell.symbol
                          )
                          const overrideKey = `${sell.symbol}:${p.accountId}`
                          return (
                            <tr key={`${p.accountId}-sell-${sell.symbol}`}>
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
                                  {(() => {
                                    if (acct.netLiquidation <= 0)
                                      return (
                                        <td
                                          rowSpan={rowCount}
                                          style={{ borderBottom: '1px solid #b0b0b0' }}
                                        >
                                          無融資
                                        </td>
                                      )
                                    const putCost = positions
                                      .filter(
                                        (pos) =>
                                          pos.account === acct.accountId &&
                                          pos.secType === 'OPT' &&
                                          (pos.right === 'P' || pos.right === 'PUT') &&
                                          pos.quantity < 0
                                      )
                                      .reduce(
                                        (sum, pos) =>
                                          sum + (pos.strike || 0) * 100 * Math.abs(pos.quantity),
                                        0
                                      )
                                    const newGPV = Math.max(
                                      0,
                                      acct.grossPositionValue - p.totalSellValue
                                    )
                                    const newLeverage = (newGPV + putCost) / acct.netLiquidation
                                    return (
                                      <td
                                        rowSpan={rowCount}
                                        style={{ borderBottom: '1px solid #b0b0b0' }}
                                      >
                                        {newLeverage > 0 ? newLeverage.toFixed(2) : '無融資'}
                                      </td>
                                    )
                                  })()}
                                </>
                              )}
                              <td style={{ color: '#8b1a1a', fontWeight: 'bold' }}>賣出</td>
                              <td>{sell.symbol}</td>
                              <td>{sellPrices[sell.symbol] || '-'}</td>
                              <td>
                                {step === 'preview' ? (
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
                                    style={{ width: '80px', textAlign: 'center' }}
                                  />
                                ) : (
                                  sell.qty.toLocaleString()
                                )}
                              </td>
                              {step === 'done' && (
                                <td style={{ fontSize: '11px' }}>
                                  {sellResult ? sellResult.status : '-'}
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

          {/* Actions */}
          <div className="confirm-buttons" style={{ marginTop: '16px' }}>
            {step === 'preview' && (
              <button
                className="btn btn-primary"
                disabled={totalSellQty === 0 || Object.values(sellPrices).some((p) => !p)}
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
                  {submitting
                    ? '下單中...'
                    : `確認平倉 (賣出 ${confirmedSourceSymbols.join(', ')}，金額 $${confirmedPreviews.reduce((s, p) => s + p.totalSellValue, 0).toLocaleString('en-US', { maximumFractionDigits: 0 })})`}
                </button>
                <button className="btn btn-secondary" onClick={() => setStep('preview')}>
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
