import React from 'react'
import { useState, useEffect, useMemo, useRef } from 'react'

import type { AccountData } from '../hooks/useAccountStore'
import { useOptionChain, formatExpiry, formatPrice } from '../hooks/useOptionChain'
import OptionChainTable from './OptionChainTable'

interface OptionOrderDialogProps {
  open: boolean
  onClose: () => void
  accounts: AccountData[]
  /** Pre-fill symbol when opened from a context (e.g. clicking a symbol) */
  initialSymbol?: string
  /** Pre-fill account when opened from a context */
  initialAccountId?: string
  /** Pre-fill right (CALL/PUT) when opened from a context */
  initialRight?: 'C' | 'P'
}

export default function OptionOrderDialog({
  open,
  onClose,
  accounts: allAccounts,
  initialSymbol = 'QQQ',
  initialAccountId,
  initialRight
}: OptionOrderDialogProps): React.JSX.Element | null {
  // ── Filter accounts if initialAccountId is provided ──────────────────────
  const accounts = useMemo(() => {
    if (!initialAccountId) return allAccounts
    return allAccounts.filter((a) => a.accountId === initialAccountId)
  }, [allAccounts, initialAccountId])

  // ── Symbol ──────────────────────────────────────────────────────────────
  const [symbol, setSymbol] = useState(initialSymbol)
  const [symbolInput, setSymbolInput] = useState(initialSymbol)

  // ── Shared option chain hook ────────────────────────────────────────────
  const chain = useOptionChain({ symbol })

  // ── Order selection ──────────────────────────────────────────────────────
  const [selExpiry, setSelExpiry] = useState('')
  const [selStrike, setSelStrike] = useState<number | null>(null)
  const [selRight, setSelRight] = useState<'C' | 'P' | null>(initialRight || null)
  const [action, setAction] = useState<'BUY' | 'SELL'>('SELL')
  const [actionDropdownOpen, setActionDropdownOpen] = useState(false)

  // ── Limit price ──────────────────────────────────────────────────────────
  const [limitPrice, setLimitPrice] = useState('')
  const [limitDropdownOpen, setLimitDropdownOpen] = useState(false)
  const limitInputRef = useRef<HTMLInputElement>(null)
  const limitDropdownRef = useRef<HTMLDivElement>(null)
  const userEditedPriceRef = useRef(false)
  const dialogBodyRef = useRef<HTMLDivElement>(null)

  // ── Account quantities ───────────────────────────────────────────────────
  const [qtys, setQtys] = useState<Record<string, string>>({})
  const [checkedAccounts, setCheckedAccounts] = useState<Record<string, boolean>>({})
  const [orderStatuses, setOrderStatuses] = useState<Record<string, string>>({})

  // ── Submit ───────────────────────────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false)
  const [orderSubmitted, setOrderSubmitted] = useState(false)

  // ── Master Quantity ──────────────────────────────────────────────────────
  const [masterQty, setMasterQty] = useState('')

  // ── Reset on open ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return
    const sym = initialSymbol
    setSymbol(sym)
    setSymbolInput(sym)
    setSelExpiry('')
    setSelStrike(null)
    setSelRight(initialRight || null)
    setLimitPrice('')
    setLimitDropdownOpen(false)
    chain.setErrorMsg('')
    setAction('SELL')
    const initQty: Record<string, string> = {}
    const initChecked: Record<string, boolean> = {}
    accounts.forEach((a) => {
      initQty[a.accountId] = ''
      if (accounts.length === 1) initChecked[a.accountId] = true
    })
    setQtys(initQty)
    setMasterQty('')
    setCheckedAccounts(initChecked)
    setOrderStatuses({})
    setOrderSubmitted(false)
    userEditedPriceRef.current = false
    if (sym) {
      chain.fetchChain(sym)
    } else {
      chain.resetChain()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // ── Selected greek ────────────────────────────────────────────────────────
  const selGreek = useMemo(() => {
    if (!selExpiry || selStrike === null || selRight === null) return undefined
    return chain.allGreeks.find(
      (g) => g.expiry === selExpiry && g.strike === selStrike && g.right === selRight
    )
  }, [chain.allGreeks, selExpiry, selStrike, selRight])

  // ── Auto-fill mid price when selection changes ────────────────────────────
  useEffect(() => {
    if (userEditedPriceRef.current) return
    if (selGreek && selGreek.bid > 0 && selGreek.ask > 0) {
      setLimitPrice(((selGreek.bid + selGreek.ask) / 2).toFixed(2))
      userEditedPriceRef.current = true
    }
  }, [selExpiry, selStrike, selRight, selGreek])

  // ── Scroll limit dropdown to mid on open ─────────────────────────────────
  useEffect(() => {
    if (limitDropdownOpen && limitDropdownRef.current && selGreek) {
      const midVal = ((selGreek.bid + selGreek.ask) / 2).toFixed(2)
      const midEl = limitDropdownRef.current.querySelector(
        `[data-price="${midVal}"]`
      ) as HTMLElement | null
      if (midEl) midEl.scrollIntoView({ block: 'center' })
    }
  }, [limitDropdownOpen, selGreek])

  // ── Close limit dropdown on outside click ─────────────────────────────────
  useEffect(() => {
    if (!limitDropdownOpen) return
    const handler = (e: MouseEvent): void => {
      if (limitInputRef.current && !limitInputRef.current.contains(e.target as Node)) {
        setLimitDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [limitDropdownOpen])

  const canSubmit =
    selExpiry &&
    selStrike !== null &&
    selRight !== null &&
    limitPrice &&
    Object.entries(qtys).some(([, q]) => q !== '' && parseInt(q) > 0)

  if (!open) return null

  const handleSelect = (expiry: string, strike: number, right: 'C' | 'P'): void => {
    userEditedPriceRef.current = false
    setSelExpiry(expiry)
    setSelStrike(strike)
    setSelRight(right)
  }

  const handleSubmit = async (): Promise<void> => {
    if (!selExpiry || selStrike === null || selRight === null || !limitPrice) return
    const accountQuantities: Record<string, number> = {}
    Object.entries(qtys).forEach(([acctId, q]) => {
      if (checkedAccounts[acctId] !== true) return
      const n = parseInt(q)
      if (!isNaN(n) && n > 0) accountQuantities[acctId] = n
    })
    if (Object.keys(accountQuantities).length === 0) return
    setSubmitting(true)
    // Mark submitting accounts
    const pending: Record<string, string> = {}
    Object.keys(accountQuantities).forEach((id) => {
      pending[id] = '送出中...'
    })
    setOrderStatuses((prev) => ({ ...prev, ...pending }))
    try {
      const results = await window.ibApi.placeOptionBatchOrders(
        {
          symbol,
          expiry: selExpiry,
          strike: selStrike,
          right: selRight,
          action,
          orderType: 'LMT',
          limitPrice: parseFloat(limitPrice),
          outsideRth: true
        },
        accountQuantities
      )
      const statusMap: Record<string, string> = {}
      results.forEach((r) => {
        statusMap[r.account] = '已送出'
      })
      setOrderStatuses((prev) => ({ ...prev, ...statusMap }))
    } catch {
      const errMap: Record<string, string> = {}
      Object.keys(accountQuantities).forEach((id) => {
        errMap[id] = '失敗'
      })
      setOrderStatuses((prev) => ({ ...prev, ...errMap }))
    } finally {
      setSubmitting(false)
      setOrderSubmitted(true)
    }
  }

  const sortedAccounts = [...accounts].sort(
    (a, b) => (b.netLiquidation || 0) - (a.netLiquidation || 0)
  )
  const getAlias = (acctId: string): string =>
    accounts.find((a) => a.accountId === acctId)?.alias || acctId

  return (
    <div className="roll-dialog-overlay" onMouseDown={onClose}>
      <div
        className="roll-dialog"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="roll-dialog-header">
          <h3>{initialAccountId ? `期權下單 ${getAlias(initialAccountId)}` : '期權下單'}</h3>
          <button className="roll-dialog-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="roll-dialog-body" ref={dialogBodyRef}>
          {/* Symbol + Action + Filters — single combined row */}
          <div className="roll-selectors-row" style={{ marginBottom: 8, gap: 8 }}>
            <input
              className="roll-order-input"
              style={{ width: 80, textTransform: 'uppercase', textAlign: 'center' }}
              value={symbolInput}
              onChange={(e) => setSymbolInput(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  setSymbol(symbolInput)
                  chain.fetchChain(symbolInput)
                }
              }}
              placeholder="標的"
            />
            <button
              className="roll-expiry-dropdown-btn"
              onClick={() => {
                setSymbol(symbolInput)
                chain.fetchChain(symbolInput)
              }}
              disabled={chain.loadingChain}
            >
              {chain.loadingChain ? '載入中...' : '查詢'}
            </button>

            <div className="roll-expiry-selector">
              <button
                className="roll-expiry-dropdown-btn"
                onClick={() => setActionDropdownOpen((v) => !v)}
                style={{
                  fontWeight: 600,
                  color: action === 'BUY' ? '#15803d' : '#b91c1c',
                  background: action === 'BUY' ? '#dcfce7' : '#fee2e2',
                  borderColor: action === 'BUY' ? '#86efac' : '#fca5a5'
                }}
              >
                {action === 'BUY' ? '買入' : '賣出'} ▾
              </button>
              {actionDropdownOpen && (
                <>
                  <div
                    className="roll-expiry-backdrop"
                    onClick={(e) => {
                      e.stopPropagation()
                      setActionDropdownOpen(false)
                    }}
                  />
                  <div className="roll-expiry-dropdown" style={{ minWidth: 80 }}>
                    <div
                      className={`roll-expiry-option${action === 'BUY' ? ' checked' : ''}`}
                      onClick={() => {
                        setAction('BUY')
                        setActionDropdownOpen(false)
                      }}
                      style={{
                        cursor: 'pointer',
                        padding: '6px 12px',
                        fontWeight: 600,
                        color: '#15803d'
                      }}
                    >
                      買入
                    </div>
                    <div
                      className={`roll-expiry-option${action === 'SELL' ? ' checked' : ''}`}
                      onClick={() => {
                        setAction('SELL')
                        setActionDropdownOpen(false)
                      }}
                      style={{
                        cursor: 'pointer',
                        padding: '6px 12px',
                        fontWeight: 600,
                        color: '#b91c1c'
                      }}
                    >
                      賣出
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Filter buttons pushed to the right */}
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
              {chain.dataReady && chain.availableExpirations.length > 0 ? (
                <div className="roll-expiry-selector">
                  <button
                    className="roll-expiry-dropdown-btn"
                    onClick={() => chain.setExpiryDropdownOpen((v) => !v)}
                  >
                    {chain.selectedExpirations.length > 0
                      ? formatExpiry(chain.selectedExpirations[0])
                      : '最後交易日'}{' '}
                    ▾
                  </button>
                  {chain.expiryDropdownOpen && (
                    <>
                      <div
                        className="roll-expiry-backdrop"
                        onClick={(e) => {
                          e.stopPropagation()
                          chain.setExpiryDropdownOpen(false)
                        }}
                      />
                      <div className="roll-expiry-dropdown" style={{ right: 0, left: 'auto' }}>
                        {chain.availableExpirations.map((exp) => (
                          <div
                            key={exp}
                            className={`roll-expiry-option ${chain.selectedExpirations.includes(exp) ? 'checked' : ''}`}
                            onClick={() => chain.toggleExpiry(exp)}
                          >
                            {formatExpiry(exp)}
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <button className="roll-expiry-dropdown-btn" disabled style={{ opacity: 0.5 }}>
                  載入中…
                </button>
              )}
              {chain.dataReady && chain.availableStrikes.length > 0 && (
                <div className="roll-expiry-selector">
                  <button
                    className="roll-expiry-dropdown-btn"
                    onClick={() => {
                      chain.strikeScrolledRef.current = false
                      chain.setStrikeDropdownOpen((v) => !v)
                    }}
                  >
                    行使價 ▾
                  </button>
                  {chain.strikeDropdownOpen && (
                    <>
                      <div
                        className="roll-expiry-backdrop"
                        onClick={(e) => {
                          e.stopPropagation()
                          chain.setStrikeDropdownOpen(false)
                        }}
                      />
                      <div
                        className="roll-expiry-dropdown"
                        ref={(el) => {
                          ;(
                            chain.strikeDropdownRef as React.MutableRefObject<HTMLDivElement | null>
                          ).current = el
                          if (
                            el &&
                            !chain.strikeScrolledRef.current &&
                            chain.selectedStrikes.length > 0
                          ) {
                            chain.strikeScrolledRef.current = true
                            const sortedSel = [...chain.selectedStrikes].sort((a, b) => a - b)
                            const firstIdx = chain.availableStrikes.indexOf(sortedSel[0])
                            if (firstIdx > 0) {
                              const label = el.children[firstIdx] as HTMLElement
                              if (label) el.scrollTop = label.offsetTop
                            }
                          }
                        }}
                        style={{ right: 0, left: 'auto' }}
                      >
                        {chain.availableStrikes.map((strike) => (
                          <label
                            key={strike}
                            className={`roll-expiry-option ${chain.selectedStrikes.includes(strike) ? 'checked' : ''}`}
                          >
                            <input
                              type="checkbox"
                              checked={chain.selectedStrikes.includes(strike)}
                              onChange={() => chain.toggleStrike(strike)}
                            />
                            {strike}
                          </label>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
              {chain.stockPrice !== null && (
                <span className="roll-stock-price" style={{ marginRight: 8 }}>
                  股價 {chain.stockPrice.toFixed(2)}
                </span>
              )}
              <button
                className="roll-expiry-dropdown-btn"
                onClick={() => chain.setChainHidden((v) => !v)}
              >
                {chain.chainHidden ? '顯示期權鏈 ▼' : '隱藏期權鏈 ▲'}
              </button>
            </div>
          </div>

          {chain.errorMsg && <div className="roll-dialog-error">{chain.errorMsg}</div>}

          {/* Option chain */}
          {(chain.loadingChain || chain.chainParams.length > 0) && !chain.chainHidden && (
            <OptionChainTable
              loading={chain.loadingChain}
              displayExpirations={chain.displayExpirations}
              displayStrikes={chain.displayStrikes}
              greeksByExpiry={chain.greeksByExpiry}
              selectedExpiry={selExpiry}
              selectedStrike={selStrike}
              selectedRight={selRight}
              onSelect={handleSelect}
            />
          )}

          {/* Limit price row */}
          <div className="roll-order-section">
            {selExpiry && selStrike !== null && selRight !== null && (
              <>
                <span
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 13,
                    color: '#333',
                    fontWeight: 500,
                    whiteSpace: 'nowrap'
                  }}
                >
                  {action === 'BUY' ? (
                    <span style={{ color: '#15803d', fontWeight: 600 }}>買</span>
                  ) : (
                    <span style={{ color: '#b91c1c', fontWeight: 600 }}>賣</span>
                  )}
                  <span style={{ whiteSpace: 'nowrap' }}>
                    {symbol} {formatExpiry(selExpiry)} {selStrike}{' '}
                    {selRight === 'C' ? 'CALL' : 'PUT'}
                  </span>
                </span>
                <span
                  style={{
                    width: 1,
                    height: 16,
                    background: '#ccc',
                    flexShrink: 0,
                    margin: '0 6px'
                  }}
                />
              </>
            )}
            <span className="roll-order-label" style={{ whiteSpace: 'nowrap' }}>
              買
            </span>
            <span className="roll-order-value roll-order-bid" style={{ whiteSpace: 'nowrap' }}>
              {selGreek ? formatPrice(selGreek.bid) : '-'}
            </span>
            <span
              style={{ width: 1, height: 16, background: '#ccc', flexShrink: 0, margin: '0 6px' }}
            />
            <span className="roll-order-label" style={{ whiteSpace: 'nowrap' }}>
              賣
            </span>
            <span className="roll-order-value roll-order-ask" style={{ whiteSpace: 'nowrap' }}>
              {selGreek ? formatPrice(selGreek.ask) : '-'}
            </span>
            <span
              style={{ width: 1, height: 16, background: '#ccc', flexShrink: 0, margin: '0 6px' }}
            />
            <span className="roll-order-label" style={{ whiteSpace: 'nowrap' }}>
              中間
            </span>{' '}
            <span className="roll-order-value roll-order-mid" style={{ whiteSpace: 'nowrap' }}>
              {selGreek && selGreek.bid > 0 && selGreek.ask > 0
                ? ((selGreek.bid + selGreek.ask) / 2).toFixed(2)
                : '-'}
            </span>
            {selExpiry && selStrike !== null && selRight !== null && (
              <>
                <span
                  style={{
                    width: 1,
                    height: 16,
                    background: '#ccc',
                    flexShrink: 0,
                    margin: '0 6px'
                  }}
                />
                <span style={{ marginRight: 'auto' }} />
                <span className="roll-order-label" style={{ whiteSpace: 'nowrap' }}>
                  限價
                </span>
                <div className="roll-limit-wrapper" ref={limitInputRef}>
                  <input
                    type="text"
                    className="roll-order-input"
                    style={{ width: 55, padding: '2px 6px' }}
                    value={limitPrice}
                    onChange={(e) => {
                      userEditedPriceRef.current = true
                      setLimitPrice(e.target.value)
                    }}
                    placeholder="0.00"
                  />
                </div>

                <span style={{ marginLeft: 12, whiteSpace: 'nowrap' }} className="roll-order-label">
                  口數
                </span>
                <div className="roll-limit-wrapper">
                  <input
                    type="number"
                    min={0}
                    className="roll-order-input"
                    style={{ width: 45, padding: '2px 6px' }}
                    value={masterQty}
                    onChange={(e) => {
                      setMasterQty(e.target.value)
                      const newQtys = { ...qtys }
                      sortedAccounts.forEach((a) => {
                        newQtys[a.accountId] = e.target.value
                      })
                      setQtys(newQtys)
                    }}
                    placeholder=""
                  />
                </div>
                <div style={{ width: 12, flexShrink: 0 }}></div>
              </>
            )}
          </div>

          {/* Account quantity table */}
          {!initialAccountId && (
            <div className="roll-dialog-table-wrapper">
              <table className="roll-dialog-table roll-positions-table">
                <thead>
                  <tr>
                    <th style={{ width: 30 }}></th>
                    <th style={{ width: 200 }}>帳戶</th>
                    <th style={{ width: 90, textAlign: 'center' }}>現金</th>
                    <th style={{ width: 90, textAlign: 'center' }}>成本基礎</th>
                    <th style={{ textAlign: 'center', width: 90 }}>口數</th>
                    <th style={{ textAlign: 'center', width: 70 }}>狀態</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedAccounts.map((acct) => {
                    const qty = qtys[acct.accountId] ?? ''
                    return (
                      <tr key={acct.accountId} style={{ height: 36 }}>
                        <td style={{ textAlign: 'center', width: '30px' }}>
                          <input
                            type="checkbox"
                            checked={checkedAccounts[acct.accountId] === true}
                            onChange={(e) =>
                              setCheckedAccounts((prev) => ({
                                ...prev,
                                [acct.accountId]: e.target.checked
                              }))
                            }
                            style={{ cursor: 'pointer' }}
                          />
                        </td>
                        <td
                          style={{
                            fontWeight: 'bold',
                            overflow: 'visible',
                            whiteSpace: 'nowrap',
                            cursor: 'pointer'
                          }}
                          onClick={() =>
                            setCheckedAccounts((prev) => ({
                              ...prev,
                              [acct.accountId]: !prev[acct.accountId]
                            }))
                          }
                        >
                          {getAlias(acct.accountId)}
                        </td>
                        <td
                          style={{
                            fontSize: 13,
                            whiteSpace: 'nowrap',
                            textAlign: 'center',
                            color: acct.totalCashValue < 0 ? '#8b1a1a' : undefined
                          }}
                        >
                          {acct.totalCashValue.toLocaleString('en-US', {
                            maximumFractionDigits: 0
                          })}
                        </td>
                        <td style={{ fontSize: 13, whiteSpace: 'nowrap', textAlign: 'center' }}>
                          {(() => {
                            const price = parseFloat(limitPrice)
                            if (!price || price <= 0) return '-'
                            const cost = price * 100
                            return action === 'SELL' ? (-cost).toFixed(2) : cost.toFixed(2)
                          })()}
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          {checkedAccounts[acct.accountId] === true && (
                            <input
                              type="number"
                              min={0}
                              value={qty}
                              onChange={(e) =>
                                setQtys((prev) => ({ ...prev, [acct.accountId]: e.target.value }))
                              }
                              className="input-field input-small"
                              style={{ height: 24, padding: '2px 8px', textAlign: 'center' }}
                            />
                          )}
                        </td>
                        <td
                          style={{
                            textAlign: 'center',
                            fontSize: 12,
                            fontWeight: 500,
                            color:
                              orderStatuses[acct.accountId] === '已送出'
                                ? '#15803d'
                                : orderStatuses[acct.accountId] === '失敗'
                                  ? '#b91c1c'
                                  : orderStatuses[acct.accountId] === '送出中...'
                                    ? '#b45309'
                                    : '#666'
                          }}
                        >
                          {orderStatuses[acct.accountId] || ''}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="roll-dialog-footer"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: initialAccountId ? 'space-between' : 'flex-end'
          }}
        >
          {initialAccountId && orderStatuses[initialAccountId] && (
            <span
              style={{
                fontSize: 13,
                fontWeight: 600,
                color:
                  orderStatuses[initialAccountId] === '已送出'
                    ? '#15803d'
                    : orderStatuses[initialAccountId] === '失敗'
                      ? '#b91c1c'
                      : orderStatuses[initialAccountId] === '送出中...'
                        ? '#b45309'
                        : '#666'
              }}
            >
              狀態: {orderStatuses[initialAccountId]}
            </span>
          )}
          <div style={{ display: 'flex', gap: '8px', marginLeft: 'auto' }}>
            <button
              className="roll-dialog-cancel"
              onClick={() => {
                setSelExpiry('')
                setSelStrike(null)
                setSelRight(null)
                setLimitPrice('')
                const initQty: Record<string, string> = {}
                accounts.forEach((a) => {
                  initQty[a.accountId] = ''
                })
                setQtys(initQty)
                setCheckedAccounts({})
                setOrderStatuses({})
                setOrderSubmitted(false)
              }}
            >
              取消
            </button>
            <button
              className="roll-dialog-confirm"
              disabled={orderSubmitted ? false : !canSubmit || submitting}
              onClick={
                orderSubmitted
                  ? () => {
                      setSelExpiry('')
                      setSelStrike(null)
                      setSelRight(null)
                      setLimitPrice('')
                      const initQty: Record<string, string> = {}
                      accounts.forEach((a) => {
                        initQty[a.accountId] = ''
                      })
                      setQtys(initQty)
                      setCheckedAccounts({})
                      setOrderStatuses({})
                      setOrderSubmitted(false)
                    }
                  : handleSubmit
              }
            >
              {submitting
                ? '下單中...'
                : orderSubmitted
                  ? '重新下單'
                  : selExpiry && selStrike !== null && selRight !== null
                    ? `確認下單 (${action === 'BUY' ? '買' : '賣'}) ${symbol} ${formatExpiry(selExpiry)} ${selStrike}${selRight === 'C' ? 'C' : 'P'}`
                    : '確認下單'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
