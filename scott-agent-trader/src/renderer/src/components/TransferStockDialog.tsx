import React from 'react'
import { useState, useEffect, useMemo, useCallback } from 'react'
import type { AccountData, PositionData } from '../hooks/useAccountStore'

interface TransferStockDialogProps {
  open: boolean
  onClose: () => void
  selectedPositions: PositionData[]
  accounts: AccountData[]
  quotes: Record<string, number>
  onTransferComplete?: (
    soldPositions: { account: string; symbol: string; shares: number; targetShares: number }[],
    targetSymbol: string
  ) => void
}

interface TransferPreview {
  accountId: string
  alias: string
  sells: { symbol: string; qty: number; price: number; value: number }[]
  totalSellValue: number
  buyQty: number
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

export default function TransferStockDialog({
  open,
  onClose,
  selectedPositions,
  accounts,
  quotes,
  onTransferComplete
}: TransferStockDialogProps): React.JSX.Element | null {
  const [targetSymbol, setTargetSymbol] = useState('')
  const [buyTif, setBuyTif] = useState<'DAY' | 'GTC'>('DAY')
  const [buyPrice, setBuyPrice] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [orderResults, setOrderResults] = useState<OrderResult[]>([])
  const [step, setStep] = useState<'preview' | 'confirm' | 'done'>('preview')
  const [confirmedPreviews, setConfirmedPreviews] = useState<TransferPreview[]>([])
  const [confirmedTargetSymbol, setConfirmedTargetSymbol] = useState('')

  // Per-symbol sell state
  const [sellPrices, setSellPrices] = useState<Record<string, string>>({})
  const [sellTifs, setSellTifs] = useState<Record<string, 'DAY' | 'GTC'>>({})
  const [sellOutsideRths, setSellOutsideRths] = useState<Record<string, boolean>>({})
  const [sellQuotes, setSellQuotes] = useState<
    Record<string, { bid: number; ask: number; last: number }>
  >({})
  // sellQtyOverrides keyed by "symbol:accountId"
  const [sellQtyOverrides, setSellQtyOverrides] = useState<Record<string, number>>({})

  const [buyOutsideRth, setBuyOutsideRth] = useState(false)
  const [buyQuote, setBuyQuote] = useState<{ bid: number; ask: number; last: number } | null>(null)

  // TIF dropdown open states (per-symbol for sell, single for buy)
  const [sellTifOpen, setSellTifOpen] = useState<string | null>(null)
  const [buyTifOpen, setBuyTifOpen] = useState(false)
  const [cashStrategy, setCashStrategy] = useState<'sell_only' | 'zero_cash'>('sell_only')

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
    // Map<accountId, Map<symbol, { qty, avgCost }>>
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
      setBuyTifOpen(false)
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

  // Fetch target quote on symbol change + auto-refresh
  useEffect(() => {
    const trimmed = targetSymbol.trim().toUpperCase()
    if (!trimmed) {
      setBuyQuote(null)
      return
    }
    let isFirst = true
    const fetchQuote = async (): Promise<void> => {
      try {
        const quote = await window.ibApi.getStockQuote(trimmed)
        setBuyQuote(quote)
        if (isFirst && quote.last > 0) {
          setBuyPrice(quote.last.toFixed(2))
          isFirst = false
        }
      } catch {
        setBuyQuote(null)
      }
    }
    const timer = setTimeout(fetchQuote, 500)
    const interval = setInterval(fetchQuote, 5000)
    return () => {
      clearTimeout(timer)
      clearInterval(interval)
    }
  }, [targetSymbol])

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

  // Calculate preview for each account
  const previews = useMemo((): TransferPreview[] => {
    const buyPriceNum = parseFloat(buyPrice) || 0
    const result: TransferPreview[] = []

    for (const [accountId, symMap] of accountSymbolPositions) {
      const acct = accounts.find((a) => a.accountId === accountId)
      const sells: TransferPreview['sells'] = []
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

      const cashAdjust = cashStrategy === 'zero_cash' ? acct?.totalCashValue || 0 : 0
      const buyQty =
        buyPriceNum > 0 ? Math.max(0, Math.floor((totalSellValue + cashAdjust) / buyPriceNum)) : 0
      result.push({
        accountId,
        alias: acct?.alias || accountId,
        sells: sells.sort((a, b) => a.symbol.localeCompare(b.symbol)),
        totalSellValue,
        buyQty
      })
    }

    return result.sort((a, b) => {
      const acctA = accounts.find((x) => x.accountId === a.accountId)
      const acctB = accounts.find((x) => x.accountId === b.accountId)
      return (acctB?.netLiquidation || 0) - (acctA?.netLiquidation || 0)
    })
  }, [
    accountSymbolPositions,
    accounts,
    sellPrices,
    buyPrice,
    quotes,
    sellQtyOverrides,
    cashStrategy
  ])

  const totalBuyQty = previews.reduce((s, p) => s + p.buyQty, 0)

  const handleSubmit = useCallback(async () => {
    if (!targetSymbol.trim() || previews.length === 0) return
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

      // Place buy orders
      const buyAllocations: Record<string, number> = {}
      for (const p of previews) {
        if (p.buyQty > 0) buyAllocations[p.accountId] = p.buyQty
      }
      if (Object.keys(buyAllocations).length > 0) {
        const buyRequest = {
          symbol: targetSymbol.trim().toUpperCase(),
          action: 'BUY' as const,
          orderType: 'LMT' as const,
          limitPrice: parseFloat(buyPrice),
          totalQuantity: totalBuyQty,
          outsideRth: buyOutsideRth,
          tif: buyTif
        }
        const buyResults = await window.ibApi.placeBatchOrders(buyRequest, buyAllocations)
        allResults.push(
          ...buyResults.map((r: OrderResult) => ({
            ...r,
            symbol: targetSymbol.trim().toUpperCase()
          }))
        )
      }

      setOrderResults(allResults)
      const soldPos = confirmedPreviews.flatMap((p) =>
        p.sells.map((s) => ({
          account: p.accountId,
          symbol: s.symbol,
          shares: s.qty,
          targetShares: p.buyQty
        }))
      )
      onTransferComplete?.(soldPos, targetSymbol.trim().toUpperCase())
      setStep('done')
    } catch (err) {
      console.error('Transfer order failed:', err)
      alert('轉倉下單失敗: ' + String(err))
    } finally {
      setSubmitting(false)
    }
  }, [
    targetSymbol,
    previews,
    sourceSymbols,
    sellPrices,
    sellTifs,
    sellOutsideRths,
    buyPrice,
    totalBuyQty,
    buyOutsideRth,
    buyTif
  ])

  const handleClose = useCallback(() => {
    setTargetSymbol('')
    setSellPrices({})
    setSellTifs({})
    setSellOutsideRths({})
    setSellQuotes({})
    setSellQtyOverrides({})
    setBuyPrice('')
    setBuyTif('DAY')
    setBuyOutsideRth(false)
    setBuyQuote(null)
    setOrderResults([])
    setStep('preview')
    setConfirmedPreviews([])
    setConfirmedTargetSymbol('')
    setSubmitting(false)
    setSellTifOpen(null)
    setBuyTifOpen(false)
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
          <h2>股票轉倉</h2>
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
                      <span className="quote-label">Last</span>
                      <span className="quote-last" style={{ color: '#1a3a6b' }}>
                        {quote.last.toFixed(2)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )
          })}

          {/* Buy row: target symbol */}
          <div className="order-form" style={{ marginTop: '8px' }}>
            <div className="form-row">
              <div className="form-group" style={{ flex: '0 0 auto' }}>
                <span
                  style={{ fontWeight: 600, fontSize: '13px', color: '#1a6b3a', padding: '6px 0' }}
                >
                  買入
                </span>
              </div>
              <div className="form-group">
                <input
                  type="text"
                  value={targetSymbol}
                  onChange={(e) => setTargetSymbol(e.target.value)}
                  placeholder="股票代碼"
                  style={{ textTransform: 'uppercase' }}
                  className="input-field"
                  disabled={step !== 'preview'}
                />
              </div>
              <div className="form-group">
                <input
                  type="number"
                  value={buyPrice}
                  onChange={(e) => setBuyPrice(e.target.value)}
                  placeholder="限價"
                  step="0.01"
                  className="input-field"
                  disabled={step !== 'preview'}
                />
              </div>
              <div className="form-group" style={{ flex: '0 0 auto' }}>
                {renderTifDropdown(
                  null,
                  buyTif,
                  setBuyTif,
                  buyOutsideRth,
                  setBuyOutsideRth,
                  buyTifOpen,
                  setBuyTifOpen
                )}
              </div>
              {targetSymbol.trim() && buyQuote && (
                <div className="quote-display" style={{ flex: '0 0 auto', fontSize: 13 }}>
                  <span className="quote-bid">{buyQuote.bid.toFixed(2)}</span>
                  <span className="quote-separator">|</span>
                  <span className="quote-ask">{buyQuote.ask.toFixed(2)}</span>
                  <span className="quote-separator">|</span>
                  <span className="quote-label">Last</span>
                  <span className="quote-last" style={{ color: '#1a3a6b' }}>
                    {buyQuote.last.toFixed(2)}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Cash strategy */}
          <div className="order-form">
            <div
              className="form-row"
              style={{ flexWrap: 'nowrap', alignItems: 'center', gap: '16px' }}
            >
              <span style={{ fontWeight: 600, fontSize: '13px', flexShrink: 0 }}>現金</span>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  cursor: 'pointer',
                  fontSize: '13px',
                  whiteSpace: 'nowrap',
                  flexShrink: 0
                }}
              >
                <input
                  type="radio"
                  name="cashStrategy"
                  value="sell_only"
                  checked={cashStrategy === 'sell_only'}
                  onChange={() => setCashStrategy('sell_only')}
                  disabled={step !== 'preview'}
                />
                僅用賣出所得
              </label>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  cursor: 'pointer',
                  fontSize: '13px',
                  whiteSpace: 'nowrap',
                  flexShrink: 0
                }}
              >
                <input
                  type="radio"
                  name="cashStrategy"
                  value="zero_cash"
                  checked={cashStrategy === 'zero_cash'}
                  onChange={() => setCashStrategy('zero_cash')}
                  disabled={step !== 'preview'}
                />
                買入後現金歸零 (可能是動用或償還)
              </label>
            </div>
          </div>

          {/* Preview table */}
          {(step === 'preview' ? previews : confirmedPreviews).length > 0 && (
            <div className="allocation-section">
              <table className="allocation-table">
                <thead>
                  <tr>
                    <th style={{ width: '22%', textAlign: 'left' }}>帳號</th>
                    <th style={{ width: '12%' }}>淨值</th>
                    <th style={{ width: '12%' }}>現金</th>
                    <th style={{ width: '7%' }}>方向</th>
                    <th style={{ width: '8%' }}>標的</th>
                    <th style={{ width: '10%' }}>價格</th>
                    <th style={{ width: '12%' }}>數量</th>
                    {step === 'done' && <th style={{ width: '12%' }}>狀態</th>}
                  </tr>
                </thead>
                <>
                  {(step === 'preview' ? previews : confirmedPreviews).map((p) => {
                    const acct = accounts.find((a) => a.accountId === p.accountId)
                    if (!acct) return null
                    const displayTargetSymbol =
                      step === 'preview' ? targetSymbol.toUpperCase() : confirmedTargetSymbol
                    const rowCount = p.sells.length + 1 // sells + buy
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
                        <tr key={`${p.accountId}-buy`} style={{ backgroundColor: '#fffde7' }}>
                          <td style={{ color: '#1a6b3a', fontWeight: 'bold' }}>買入</td>
                          <td>{displayTargetSymbol || '-'}</td>
                          <td>{buyPrice || '-'}</td>
                          <td>{p.buyQty.toLocaleString()}</td>
                          {step === 'done' && (
                            <td style={{ fontSize: '11px' }}>
                              {orderResults.find(
                                (r) => r.account === p.accountId && r.symbol === displayTargetSymbol
                              )?.status || '-'}
                            </td>
                          )}
                        </tr>
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
                disabled={
                  !targetSymbol.trim() ||
                  totalBuyQty === 0 ||
                  Object.values(sellPrices).some((p) => !p) ||
                  !buyPrice
                }
                onClick={() => {
                  setConfirmedPreviews(previews)
                  setConfirmedTargetSymbol(targetSymbol.trim().toUpperCase())
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
                    : `確認轉倉 (賣${confirmedSourceSymbols.join(',')} → 買${confirmedTargetSymbol} ${confirmedPreviews.reduce((s, p) => s + p.buyQty, 0).toLocaleString()}股)`}
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
