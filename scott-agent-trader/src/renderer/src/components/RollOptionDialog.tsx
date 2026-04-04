import React from 'react'
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'

import type { AccountData, PositionData } from '../hooks/useAccountStore'
import {
  useOptionChain,
  formatExpiry,
  mergeGreek
} from '../hooks/useOptionChain'
import type { OptionGreek } from '../hooks/useOptionChain'
import OptionChainTable from './OptionChainTable'

interface RollOptionDialogProps {
  open: boolean
  onClose: () => void
  selectedPositions: PositionData[]
  accounts: AccountData[]
  onRollComplete?: (
    rolledPositions: PositionData[],
    target: { expiry: string; strike: number; right: 'C' | 'P' }
  ) => void
  initialTarget?: { expiry: string; strike: number; right: 'C' | 'P' }
}

function midPrice(greek: OptionGreek | undefined): number | null {
  if (!greek) return null
  if (greek.bid > 0 && greek.ask > 0) return (greek.bid + greek.ask) / 2
  if (greek.last > 0) return greek.last
  return null
}

export default function RollOptionDialog({
  open,
  onClose,
  selectedPositions,
  accounts,
  onRollComplete,
  initialTarget
}: RollOptionDialogProps): React.JSX.Element | null {
  // Snapshot positions on open so parent re-renders don't cause re-fetches
  const snappedPositions = useRef<PositionData[]>([])
  const snappedAccounts = useRef<AccountData[]>([])

  // Snapshot on open
  useEffect(() => {
    if (open) {
      snappedPositions.current = selectedPositions
      snappedAccounts.current = accounts
    }
  }, [open]) // only on open change

  // Use snapped data
  const positions = open ? snappedPositions.current : []
  const accts = open ? snappedAccounts.current : []

  // Derive common properties
  const symbol = positions[0]?.symbol || ''

  // Unique current expiry/strike combos - stable via ref
  const currentCombosKey = positions
    .map((p) => `${p.expiry}_${p.strike}`)
    .sort()
    .join(',')

  const currentCombos = useMemo(() => {
    const map = new Map<string, { expiry: string; strike: number }>()
    positions.forEach((p) => {
      const key = `${p.expiry}_${p.strike}`
      if (!map.has(key)) {
        map.set(key, { expiry: p.expiry || '', strike: p.strike || 0 })
      }
    })
    return Array.from(map.values())
  }, [currentCombosKey])

  const getAlias = useCallback(
    (accountId: string): string => {
      const acct = accts.find((a) => a.accountId === accountId)
      return acct?.alias || accountId
    },
    [accts]
  )

  // Available expirations (only after current positions' expiry)
  const maxCurrentExpiry = useMemo(
    () => currentCombos.reduce((max, c) => (c.expiry > max ? c.expiry : max), ''),
    [currentCombos]
  )

  // ── Shared option chain hook ────────────────────────────────────────────
  const expiryFilter = useCallback(
    (expiry: string) => expiry >= maxCurrentExpiry,
    [maxCurrentExpiry]
  )

  const chain = useOptionChain({
    symbol,
    expiryFilter,
    cancelSubscriptionsOnCleanup: true
  })

  // ── Roll-specific state ─────────────────────────────────────────────────
  const [targetExpiry, setTargetExpiry] = useState('')
  const [targetStrike, setTargetStrike] = useState<number | null>(null)
  const [targetRight, setTargetRight] = useState<'C' | 'P' | null>(null)

  const [currentGreeks, setCurrentGreeks] = useState<OptionGreek[]>([])
  const [greeksFetched, setGreeksFetched] = useState(false)

  const [limitPrice, setLimitPrice] = useState('')
  const limitInputRef = useRef<HTMLInputElement>(null)
  const userEditedPriceRef = useRef(false)
  const [submitting, setSubmitting] = useState(false)

  // ── Reset on open ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!open || !symbol) return

    setTargetExpiry('')
    setTargetStrike(null)
    setTargetRight(null)
    setCurrentGreeks([])
    setGreeksFetched(false)
    setLimitPrice('')
    userEditedPriceRef.current = false

    chain.fetchChain(symbol)
  }, [open, symbol])

  // Auto-select initial target expiry if provided
  useEffect(() => {
    if (chain.availableExpirations.length > 0 && chain.selectedExpirations.length === 0) {
      if (initialTarget && chain.availableExpirations.includes(initialTarget.expiry)) {
        chain.setSelectedExpirations([initialTarget.expiry])
      }
    }
  }, [chain.availableExpirations, initialTarget])

  // Scroll strike dropdown to first checked item on open
  useEffect(() => {
    if (chain.strikeDropdownOpen && chain.strikeDropdownRef.current) {
      // Save dialog body scroll position before scrollIntoView
      const dialogBody = chain.strikeDropdownRef.current.closest('.roll-dialog-body')
      const savedScroll = dialogBody?.scrollTop ?? 0
      const firstChecked = chain.strikeDropdownRef.current.querySelector('.roll-expiry-option.checked')
      if (firstChecked) {
        firstChecked.scrollIntoView({ block: 'nearest' })
      }
      // Restore dialog body scroll position (scrollIntoView affects all ancestors)
      if (dialogBody) dialogBody.scrollTop = savedScroll
    }
  }, [chain.strikeDropdownOpen])

  // ── Fetch current position greeks ──────────────────────────────────────
  const fetchKey = useMemo(() => {
    if (chain.displayExpirations.length === 0 || chain.displayStrikes.length === 0) return ''
    return `${symbol}_${chain.displayExpirations.join(',')}_${chain.displayStrikes.join(',')}_${currentCombosKey}`
  }, [symbol, chain.displayExpirations, chain.displayStrikes, currentCombosKey])

  useEffect(() => {
    if (!fetchKey || greeksFetched) return
    setGreeksFetched(true)

    const currentExpiries = [...new Set(currentCombos.map((c) => c.expiry))]
    currentExpiries.forEach((exp) => {
      const strikesForExp = currentCombos.filter((c) => c.expiry === exp).map((c) => c.strike)
      window.ibApi
        .getOptionGreeks(symbol, exp, strikesForExp)
        .then((greeks) => {
          if (greeks.length === 0) return
          setCurrentGreeks((prev) => {
            const incoming = new Map<string, OptionGreek>(
              greeks.map((g) => [`${g.expiry}_${g.strike}_${g.right}`, g])
            )
            const existingKeys = new Set(prev.map((g) => `${g.expiry}_${g.strike}_${g.right}`))
            const updated = prev.map((g) => {
              const n = incoming.get(`${g.expiry}_${g.strike}_${g.right}`)
              return n ? mergeGreek(g, n) : g
            })
            const newEntries = greeks.filter(
              (g) => !existingKeys.has(`${g.expiry}_${g.strike}_${g.right}`)
            )
            return newEntries.length > 0 ? [...updated, ...newEntries] : updated
          })
        })
        .catch(() => { })
    })
  }, [fetchKey, greeksFetched])

  // ── Refresh current position greeks every 2s ───────────────────────────
  useEffect(() => {
    if (!symbol || currentCombos.length === 0) return
    const currentExpiries = [...new Set(currentCombos.map((c) => c.expiry))]
    if (currentExpiries.length === 0) return

    let cancelled = false

    const refresh = async (): Promise<void> => {
      const promises: Promise<void>[] = []
      for (const exp of currentExpiries) {
        const strikesForExp = currentCombos.filter((c) => c.expiry === exp).map((c) => c.strike)
        promises.push(
          window.ibApi
            .getOptionGreeks(symbol, exp, strikesForExp)
            .then((greeks) => {
              const filtered = greeks.filter((g) => strikesForExp.includes(g.strike))
              if (cancelled || filtered.length === 0) return
              setCurrentGreeks((prev) => {
                const incoming = new Map<string, OptionGreek>(
                  filtered.map((g) => [`${g.expiry}_${g.strike}_${g.right}`, g])
                )
                const existingKeys = new Set(prev.map((g) => `${g.expiry}_${g.strike}_${g.right}`))
                const updated = prev.map((g) => {
                  const n = incoming.get(`${g.expiry}_${g.strike}_${g.right}`)
                  return n ? mergeGreek(g, n) : g
                })
                const newEntries = filtered.filter(
                  (g) => !existingKeys.has(`${g.expiry}_${g.strike}_${g.right}`)
                )
                return newEntries.length > 0 ? [...updated, ...newEntries] : updated
              })
            })
            .catch(() => { })
        )
      }
      await Promise.all(promises)
    }

    const interval = setInterval(() => {
      void refresh()
    }, 2000)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [symbol, currentCombos])

  const handleSelect = useCallback((expiry: string, strike: number, right: 'C' | 'P') => {
    userEditedPriceRef.current = false
    setTargetExpiry(expiry)
    setTargetStrike(strike)
    setTargetRight(right)
  }, [])

  const findCurrentGreek = useCallback(
    (pos: PositionData): OptionGreek | undefined => {
      const pr = pos.right === 'C' || pos.right === 'CALL' ? 'C' : 'P'
      return currentGreeks.find(
        (g) => g.expiry === pos.expiry && g.strike === pos.strike && g.right === pr
      )
    },
    [currentGreeks]
  )

  const targetGreek = useMemo(() => {
    if (!targetExpiry || targetStrike === null || targetRight === null) return undefined
    return chain.allGreeks.find(
      (g) => g.expiry === targetExpiry && g.strike === targetStrike && g.right === targetRight
    )
  }, [chain.allGreeks, targetExpiry, targetStrike, targetRight])

  // Compute spread prices (net credit/debit for the roll)
  const spreadPrices = useMemo(() => {
    if (!targetGreek || positions.length === 0) return null
    const pos0 = positions[0]
    const curGreek = findCurrentGreek(pos0)
    if (!curGreek) return null
    const isShort = pos0.quantity < 0
    const spreadBid = isShort
      ? curGreek.ask - targetGreek.bid
      : targetGreek.ask - curGreek.bid
    const spreadAsk = isShort
      ? curGreek.bid - targetGreek.ask
      : targetGreek.bid - curGreek.ask
    const spreadMid = (spreadBid + spreadAsk) / 2
    return { bid: spreadBid, ask: spreadAsk, mid: spreadMid }
  }, [targetGreek, positions, findCurrentGreek])

  // Auto-populate limit price with mid price whenever target selection changes
  useEffect(() => {
    if (userEditedPriceRef.current) return
    if (spreadPrices) {
      setLimitPrice(spreadPrices.mid.toFixed(2))
    }
  }, [spreadPrices])

  // Auto-select best target contract once greeks load
  useEffect(() => {
    if (chain.allGreeks.length === 0 || targetExpiry || targetStrike !== null) return
    const pos0 = positions[0]
    if (!pos0) return

    if (initialTarget) {
      setTargetExpiry(initialTarget.expiry)
      setTargetStrike(initialTarget.strike)
      setTargetRight(initialTarget.right)
      return
    }

    const right = pos0.right === 'C' || pos0.right === 'CALL' ? 'C' : 'P'
    const expiry = chain.displayExpirations[0]
    if (!expiry) return
    const candidates = chain.allGreeks.filter((g) => g.expiry === expiry && g.right === right)
    if (candidates.length === 0) return
    const currentStrike = pos0.strike ?? 0
    const best = candidates.reduce((a, b) =>
      Math.abs(a.strike - currentStrike) <= Math.abs(b.strike - currentStrike) ? a : b
    )
    setTargetExpiry(best.expiry)
    setTargetStrike(best.strike)
    setTargetRight(best.right as 'C' | 'P')
  }, [chain.allGreeks, targetExpiry, targetStrike, positions, chain.displayExpirations, initialTarget])

  if (!open) return null

  const targetMid = midPrice(targetGreek)

  return (
    <div className="roll-dialog-overlay" onClick={onClose}>
      <div className="roll-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="roll-dialog-header">
          <h3>{symbol} 批次展期</h3>
          <button className="roll-dialog-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="roll-dialog-body">
          {chain.errorMsg && <div className="roll-dialog-error">{chain.errorMsg}</div>}

          {/* Selectors row */}
          {chain.dataReady && (chain.availableExpirations.length > 0 || chain.availableStrikes.length > 0) ? (
            <div className="roll-selectors-row">
              {/* Expiry date selector */}
              {chain.availableExpirations.length > 0 && (
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
                        onClick={() => chain.setExpiryDropdownOpen(false)}
                      />
                      <div className="roll-expiry-dropdown">
                        {chain.availableExpirations.map((exp) => (
                          <div
                            key={exp}
                            className={`roll-expiry-option ${chain.selectedExpirations.includes(exp) ? 'checked' : ''}`}
                            onClick={() => {
                              chain.toggleExpiry(exp)
                              chain.setExpiryDropdownOpen(false)
                            }}
                          >
                            {formatExpiry(exp)}
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Strike selector */}
              {chain.availableStrikes.length > 0 && (
                <div className="roll-expiry-selector">
                  <button
                    className="roll-expiry-dropdown-btn"
                    onClick={() => chain.setStrikeDropdownOpen((v) => !v)}
                  >
                    行使價 ▾
                  </button>
                  {chain.strikeDropdownOpen && (
                    <>
                      <div
                        className="roll-expiry-backdrop"
                        onClick={() => chain.setStrikeDropdownOpen(false)}
                      />
                      <div className="roll-expiry-dropdown" ref={chain.strikeDropdownRef}>
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
              {chain.stockPrice !== null && chain.stockPriceSymbolRef.current === symbol && (
                <span className="roll-stock-price" style={{ marginLeft: 'auto', marginRight: 8 }}>
                  {symbol} 股價 {chain.stockPrice.toFixed(2)}
                </span>
              )}

              <button
                className="roll-expiry-dropdown-btn"
                onClick={() => chain.setChainHidden((v) => !v)}
              >
                {chain.chainHidden ? '顯示期權鏈 ▼' : '隱藏期權鏈 ▲'}
              </button>
            </div>
          ) : (
            <div className="roll-selectors-row" style={{ opacity: 0.5 }}>
              <button className="roll-expiry-dropdown-btn" disabled>載入中…</button>
            </div>
          )}

          {/* Multi-expiry option chain */}
          {!chain.chainHidden && (
            <OptionChainTable
              loading={!chain.dataReady}
              displayExpirations={chain.displayExpirations}
              displayStrikes={chain.displayStrikes}
              greeksByExpiry={chain.greeksByExpiry}
              selectedExpiry={targetExpiry}
              selectedStrike={targetStrike}
              selectedRight={targetRight}
              onSelect={handleSelect}
            />
          )}

          {/* Order entry section */}
          <div className="roll-order-section" style={{ flexDirection: 'column', gap: '6px', alignItems: 'stretch' }}>
            {/* Row 1: Roll direction */}
            {targetExpiry && targetStrike !== null && targetRight !== null && positions.length > 0 && (() => {
              const curExp = positions[0].expiry || ''
              const daysDiff = curExp && targetExpiry
                ? Math.round((new Date(targetExpiry.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')).getTime() - new Date(curExp.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')).getTime()) / 86400000)
                : null
              const curRight = positions[0].right === 'C' || positions[0].right === 'CALL' ? 'C' : 'P'
              return (
                <div style={{ display: 'flex', alignItems: 'center', fontSize: 13, gap: '6px', color: '#333' }}>
                  <span>展期{daysDiff !== null ? `${daysDiff}天` : ''}</span>
                  <span>
                    {symbol} {formatExpiry(curExp)}{' '}
                    {Number.isInteger(Number(positions[0].strike)) ? Number(positions[0].strike) : (Number(positions[0].strike) || 0).toFixed(1)}{curRight}
                  </span>
                  <span>→</span>
                  <span>
                    {symbol} {formatExpiry(targetExpiry)}{' '}
                    {Number.isInteger(Number(targetStrike)) ? Number(targetStrike) : Number(targetStrike).toFixed(1)}{targetRight}
                  </span>
                </div>
              )
            })()}
            {/* Row 2: Spread prices + limit */}
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center', fontSize: 13 }}>
              <span className="roll-order-label">買價</span>
              <span className="roll-order-value roll-order-bid">
                {spreadPrices ? spreadPrices.bid.toFixed(2) : '-'}
              </span>
              <span style={{ width: 1, height: 16, background: '#ccc', flexShrink: 0, margin: '0 6px' }} />
              <span className="roll-order-label">賣價</span>
              <span className="roll-order-value roll-order-ask">
                {spreadPrices ? spreadPrices.ask.toFixed(2) : '-'}
              </span>
              <span style={{ width: 1, height: 16, background: '#ccc', flexShrink: 0, margin: '0 6px' }} />
              <span style={{ background: '#fff9db', padding: '2px 8px', borderRadius: 4 }}>
                <span className="roll-order-label">中間價</span>{' '}
                <span className="roll-order-value roll-order-mid">
                  {spreadPrices ? spreadPrices.mid.toFixed(2) : '-'}
                </span>
              </span>
              <span style={{ width: 1, height: 16, background: '#ccc', flexShrink: 0, margin: '0 6px' }} />
              <span className="roll-order-label">限價</span>
              <div className="roll-limit-wrapper" ref={limitInputRef}>
                <input
                  type="text"
                  className="roll-order-input"
                  value={limitPrice}
                  onChange={(e) => {
                    userEditedPriceRef.current = true
                    setLimitPrice(e.target.value)
                  }}
                  placeholder="0.00"
                />
              </div>
            </div>
          </div>

          {/* Positions table */}
          {positions.length > 0 && (
            <>
              <div className="roll-dialog-table-wrapper">
                <table className="roll-dialog-table roll-positions-table">
                  <tbody>
                    {positions.map((pos, idx) => {
                      const curGreek = findCurrentGreek(pos)
                      const curMid = midPrice(curGreek)
                      const liveSpread =
                        curMid !== null && targetMid !== null ? curMid - targetMid : null
                      const displayVal = liveSpread
                      const rightLabel = pos.right === 'C' ? 'C' : pos.right === 'P' ? 'P' : ''
                      const strikeStr = Number.isInteger(Number(pos.strike))
                        ? Number(pos.strike)
                        : (Number(pos.strike) || 0).toFixed(1)
                      const currentDesc = `${symbol} ${pos.expiry ? formatExpiry(pos.expiry) : ''} ${strikeStr}${rightLabel}`
                      const targetDesc =
                        targetExpiry && targetStrike !== null && targetRight
                          ? `${symbol} ${formatExpiry(targetExpiry)} ${Number.isInteger(Number(targetStrike)) ? Number(targetStrike) : Number(targetStrike).toFixed(1)}${targetRight === 'C' ? 'C' : 'P'}`
                          : '-'

                      return (
                        <tr key={idx}>
                          <td
                            style={{
                              color: '#333',
                              textAlign: 'center',
                              width: '1px',
                              whiteSpace: 'nowrap'
                            }}
                          >{`${idx + 1}.`}</td>
                          <td>{getAlias(pos.account)}</td>
                          <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                            {Math.abs(pos.quantity)}口
                          </td>
                          <td style={{ whiteSpace: 'nowrap' }}>{currentDesc} → {targetDesc}</td>
                          <td
                            className={
                              displayVal !== null && !isNaN(displayVal as number)
                                ? (displayVal as number) <= 0
                                  ? 'spread-positive'
                                  : 'spread-negative'
                                : ''
                            }
                          >
                            {displayVal !== null && !isNaN(displayVal as number)
                              ? `價差 ${(displayVal as number) >= 0 ? '+' : ''}${(displayVal as number).toFixed(2)}`
                              : '-'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        <div className="roll-dialog-footer">
          <button className="roll-dialog-cancel" onClick={onClose}>
            取消
          </button>
          <button
            className="roll-dialog-confirm"
            disabled={
              !targetExpiry ||
              targetStrike === null ||
              targetRight === null ||
              !limitPrice ||
              submitting
            }
            onClick={async () => {
              if (!targetExpiry || targetStrike === null || targetRight === null || !limitPrice)
                return
              setSubmitting(true)
              try {
                for (const pos of positions) {
                  const qty = Math.abs(pos.quantity)
                  const isShort = pos.quantity < 0
                  const closeAction = isShort ? 'BUY' : 'SELL'
                  await window.ibApi.placeRollOrder(
                    {
                      symbol,
                      closeExpiry: pos.expiry || '',
                      closeStrike: pos.strike || 0,
                      closeRight: pos.right === 'C' || pos.right === 'CALL' ? 'C' : 'P',
                      openExpiry: targetExpiry,
                      openStrike: targetStrike,
                      openRight: targetRight,
                      action: closeAction,
                      limitPrice: parseFloat(limitPrice),
                      outsideRth: true
                    },
                    { [pos.account]: qty }
                  )
                }
                onRollComplete?.(positions, {
                  expiry: targetExpiry,
                  strike: targetStrike,
                  right: targetRight
                })
                onClose()
              } catch (err: unknown) {
                alert('展期下單失敗: ' + String(err))
              } finally {
                setSubmitting(false)
              }
            }}
          >
            {submitting
              ? '下單中...'
              : targetExpiry && targetStrike !== null && targetRight
                ? `確認展期 ${symbol} ${formatExpiry(targetExpiry)} ${Number.isInteger(Number(targetStrike)) ? Number(targetStrike) : Number(targetStrike).toFixed(1)}${targetRight}`
                : '確認展期'}
          </button>
        </div>
      </div>
    </div>
  )
}
