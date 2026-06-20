import React from 'react'
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'

import type { AccountData, PositionData } from '../hooks/useAccountStore'
import { useOptionChain, formatExpiry, mergeGreek } from '../hooks/useOptionChain'
import type { OptionGreek } from '../hooks/useOptionChain'
import OptionChainTable from './OptionChainTable'
import { getSymbolRiskRules } from '../lib/riskPrefs'
import { rollTradingDays } from '../lib/tradingDays'

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
  // Observe mode: instead of placing the roll, picking a target + confirming
  // just hands the target back (used by 展期觀察).
  observeMode?: boolean
  onObserve?: (target: { expiry: string; strike: number; right: 'C' | 'P' }) => void
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
  initialTarget,
  observeMode,
  onObserve
}: RollOptionDialogProps): React.JSX.Element | null {
  // Snapshot positions on open so parent re-renders don't cause re-fetches.
  // The snapshot is taken synchronously DURING the render where open flips
  // false → true, so the first render already has the fresh values — the
  // previous useEffect-based approach left positions/symbol stale for the
  // first render, which intermittently broke chain loading when the dialog
  // was opened on a different selection than last time.
  const snappedPositions = useRef<PositionData[]>([])
  const snappedAccounts = useRef<AccountData[]>([])
  const prevOpenRef = useRef(false)
  if (open && !prevOpenRef.current) {
    snappedPositions.current = selectedPositions
    snappedAccounts.current = accounts
  }
  prevOpenRef.current = open

  // Use snapped data
  const positions = open ? snappedPositions.current : []
  const accts = open ? snappedAccounts.current : []

  // Derive common properties
  const symbol = positions[0]?.symbol || ''

  // 用觀察倉做展期: the dialog was opened from a saved 展期觀察 target (a fixed
  // expiry/strike handed in via initialTarget, and NOT the observe-setup flow).
  // The target is already decided, so hide the option-chain UI (expiry/strike
  // pickers + 顯示期權鏈 toggle + the chain panel) so it can't be changed/opened.
  // Pricing still loads in the background for the target's bid/ask/mid.
  const lockChain = !!initialTarget && !observeMode

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

  // Single account check
  const isSingleAccount = useMemo(() => {
    return new Set(positions.map((p) => p.account)).size === 1
  }, [positions])

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

  // Keep the source position's strike(s) selected by default, so the
  // same-strike roll is visible without scrolling the strike list. Also pin the
  // initialTarget strike (from a 展期觀察 GO) so its greek always loads — without
  // it, a target outside the default display range never gets a quote and the
  // limit price can't auto-fill.
  const pinnedStrikes = useMemo(
    () =>
      Array.from(
        new Set([
          ...positions.map((p) => p.strike).filter((s): s is number => s != null),
          ...(initialTarget ? [initialTarget.strike] : [])
        ])
      ),
    [positions, initialTarget]
  )
  const chain = useOptionChain({
    symbol,
    expiryFilter,
    cancelSubscriptionsOnCleanup: true,
    pinnedStrikes
  })

  // Manual / observe-setup roll (clicked the 展期 button): default the option
  // chain to OPEN every time the dialog opens. This component stays mounted while
  // `open` toggles, so chainHidden persists — a prior 隱藏 would otherwise stick.
  // For a 觀察倉 roll the chain is hidden outright, so this is skipped.
  useEffect(() => {
    if (open && !lockChain) chain.setChainHidden(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, lockChain])

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
  const [rollQty, setRollQty] = useState('')
  // Per-account roll quantity (multi-account): defaults to each position's full
  // size, editable down (never up) by double-clicking the 口數 cell.
  const keyOf = (p: PositionData): string =>
    `${p.account}|${p.expiry || ''}|${p.strike || ''}|${p.right || ''}`
  const [rollQtyByKey, setRollQtyByKey] = useState<Record<string, number>>({})
  const [editingQtyKey, setEditingQtyKey] = useState<string | null>(null)
  // Heads-up when rolling QQQ out more than 2 trading days — shown the moment a
  // long target is picked. Track the last-warned expiry so it pops once per
  // distinct target rather than on every click.
  const [longRollWarnOpen, setLongRollWarnOpen] = useState(false)
  const [warnHeader, setWarnHeader] = useState('風險提示')
  const [warnMessages, setWarnMessages] = useState<string[]>([])
  // Keyed by the picked target (expiry|strike) so the warning pops once per
  // distinct target rather than on every click.
  const lastWarnedExpiryRef = useRef<string | null>(null)
  const initialExpirySetRef = useRef(false)

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
    initialExpirySetRef.current = false
    setRollQty(String(snappedPositions.current.reduce((sum, p) => sum + Math.abs(p.quantity), 0)))
    setRollQtyByKey(
      Object.fromEntries(snappedPositions.current.map((p) => [keyOf(p), Math.abs(p.quantity)]))
    )
    setEditingQtyKey(null)

    chain.fetchChain(symbol)
  }, [open, symbol])

  // Auto-select initial target expiry: prefer initialTarget; otherwise
  // pick the next expiry strictly after the current positions' max expiry
  // (i.e. skip same-day so the default is "next trading day").
  // Runs only once per open so user manual picks aren't overridden.
  useEffect(() => {
    if (initialExpirySetRef.current) return
    if (chain.availableExpirations.length === 0) return
    if (initialTarget && chain.availableExpirations.includes(initialTarget.expiry)) {
      chain.setSelectedExpirations([initialTarget.expiry])
      initialExpirySetRef.current = true
      return
    }
    const next = chain.availableExpirations.find((e) => e > maxCurrentExpiry)
    if (next) {
      chain.setSelectedExpirations([next])
      initialExpirySetRef.current = true
    } else if (chain.selectedExpirations.length > 0) {
      // No later expiry exists — leave hook's default (current expiry) and mark done
      initialExpirySetRef.current = true
    }
  }, [chain.availableExpirations, chain.selectedExpirations, initialTarget, maxCurrentExpiry])

  // Scroll strike dropdown to first checked item on open
  useEffect(() => {
    if (chain.strikeDropdownOpen && chain.strikeDropdownRef.current) {
      // Save dialog body scroll position before scrollIntoView
      const dialogBody = chain.strikeDropdownRef.current.closest('.roll-dialog-body')
      const savedScroll = dialogBody?.scrollTop ?? 0
      const firstChecked = chain.strikeDropdownRef.current.querySelector(
        '.roll-expiry-option.checked'
      )
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
        .catch(() => {})
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
            .catch(() => {})
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

  // The option type we're rolling FROM. A PUT can only roll into a PUT and a
  // CALL into a CALL — used to lock the chain's opposite side.
  const sourceRight = useMemo<'C' | 'P' | null>(() => {
    const r = positions[0]?.right
    if (r === 'C' || r === 'CALL') return 'C'
    if (r === 'P' || r === 'PUT') return 'P'
    return null
  }, [positions])

  // "SELL PUT" / "SELL CALL" (or BUY for long positions) for the dialog title.
  const positionLabel = useMemo(() => {
    if (!sourceRight) return ''
    const side = (positions[0]?.quantity ?? 0) < 0 ? 'SELL' : 'BUY'
    return `${side} ${sourceRight === 'P' ? 'PUT' : 'CALL'}`
  }, [sourceRight, positions])

  // Places the roll across all selected accounts. Extracted so it can run
  // either directly or after the long-roll confirmation.
  const performRoll = async (): Promise<void> => {
    if (!targetExpiry || targetStrike === null || targetRight === null || !limitPrice || !rollQty)
      return
    setSubmitting(true)
    try {
      const targetTotalQty = parseInt(rollQty, 10) || 0

      for (const pos of positions) {
        const originalQty = Math.abs(pos.quantity)
        // Single account → the global 口數 input. Multi → the per-account edited
        // value, clamped so it can only be ≤ the position's actual size.
        const qty =
          positions.length === 1
            ? targetTotalQty
            : Math.min(originalQty, Math.max(1, rollQtyByKey[keyOf(pos)] ?? originalQty))
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
  }

  const handleSelect = useCallback(
    (expiry: string, strike: number, right: 'C' | 'P') => {
      // 防呆: ignore a pick on the wrong side (CALL when rolling a PUT, etc.).
      if (sourceRight && right !== sourceRight) return
      userEditedPriceRef.current = false
      setTargetExpiry(expiry)
      setTargetStrike(strike)
      setTargetRight(right)
      // Per-symbol roll-risk warnings (展期天數 / 行權價變動 %) — shown the moment a
      // breaching target is picked, unless disabled in Settings → 風險提示.
      const rules = getSymbolRiskRules(symbol)
      const targetKey = `${expiry}|${strike}`
      if (rules && lastWarnedExpiryRef.current !== targetKey) {
        const messages: string[] = []
        let daysHit = false
        let strikeHit = false
        let breachHit = false

        if (rules.rollDays?.get()) {
          const maxRollDays = positions.reduce(
            (m, p) => Math.max(m, rollTradingDays(p.expiry, expiry) ?? 0),
            0
          )
          if (maxRollDays > rules.rollDays.threshold) {
            daysHit = true
            messages.push(
              `請留意展期為 ${maxRollDays} 天，期權的 DTE 越長，日後的滾動會越難操作，如果不是處於極端劣勢應儘量避免，也同時可以考慮支付費用做滾動。`
            )
          }
        }

        if (rules.strikePct?.get()) {
          let maxPct = 0
          let fromStrike = 0
          for (const p of positions) {
            const s = Number(p.strike)
            if (!s) continue
            const pct = (Math.abs(strike - s) / s) * 100
            if (pct > maxPct) {
              maxPct = pct
              fromStrike = s
            }
          }
          if (maxPct > rules.strikePct.threshold) {
            strikeHit = true
            messages.push(
              `請留意此次滾動將行權價 ${fromStrike} 調整為 ${strike}，變動約 ${maxPct.toFixed(2)}%（超過 ${rules.strikePct.threshold}%），幅度較大，請確認是否符合預期。`
            )
          }
        }

        // Strike breached by the underlying, and the roll keeps it on the wrong
        // side (short CALL not rolled up / short PUT not rolled down).
        const stock = chain.stockPrice
        if (rules.breachNoImprove?.get() && stock != null && stock > 0) {
          for (const p of positions) {
            const s = Number(p.strike)
            if (!s) continue
            const isCall = p.right === 'C' || p.right === 'CALL'
            const isPut = p.right === 'P' || p.right === 'PUT'
            const breach = isCall ? stock - s : isPut ? s - stock : -1 // points ITM
            if (breach <= 0) continue
            const breachPct = (breach / stock) * 100
            if (breachPct <= rules.breachNoImprove.threshold) continue
            const improves = isCall ? strike > s : strike < s
            if (!improves) {
              breachHit = true
              const dir = isCall ? '上調' : '下調'
              messages.push(
                `行權價 ${s} 已被股價 ${stock.toFixed(2)} 突破 ${breach.toFixed(2)} 點（${breachPct.toFixed(2)}%），此次滾動目標 ${strike} 未${dir}、未改善風險，請確認是否符合預期。`
              )
              break
            }
          }
        }

        if (messages.length > 0) {
          lastWarnedExpiryRef.current = targetKey
          const hitCount = [daysHit, strikeHit, breachHit].filter(Boolean).length
          setWarnHeader(
            hitCount > 1
              ? '展期風險提示'
              : daysHit
                ? '展期天數過長'
                : strikeHit
                  ? '行權價變動過大'
                  : '行權價已被突破'
          )
          setWarnMessages(messages)
          setLongRollWarnOpen(true)
        }
      }
    },
    [sourceRight, symbol, positions, chain.stockPrice]
  )

  // Reset the long-roll warning gate each time the dialog opens.
  useEffect(() => {
    if (open) lastWarnedExpiryRef.current = null
  }, [open])

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
    // bid/ask, falling back to last when a side has no live quote (e.g. market
    // closed at weekends); null when even last is missing → spread shows "-".
    // Without this, subtracting a 0 leg yields a garbage spread.
    const side = (q: number, last: number): number | null =>
      Number.isFinite(q) && q > 0 ? q : Number.isFinite(last) && last > 0 ? last : null
    const cb = side(curGreek.bid, curGreek.last)
    const ca = side(curGreek.ask, curGreek.last)
    const tb = side(targetGreek.bid, targetGreek.last)
    const ta = side(targetGreek.ask, targetGreek.last)
    if (cb == null || ca == null || tb == null || ta == null) return null
    const spreadBid = isShort ? ca - tb : ta - cb
    const spreadAsk = isShort ? cb - ta : tb - ca
    return { bid: spreadBid, ask: spreadAsk, mid: (spreadBid + spreadAsk) / 2 }
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
  }, [
    chain.allGreeks,
    targetExpiry,
    targetStrike,
    positions,
    chain.displayExpirations,
    initialTarget
  ])

  if (!open) return null

  const targetMid = midPrice(targetGreek)

  return (
    <>
    <div className="roll-dialog-overlay" onClick={onClose}>
      <div
        className="roll-dialog"
        style={{ width: 820, maxWidth: '96vw' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="roll-dialog-header">
          <h3>
            {symbol}
            {positionLabel ? ` ${positionLabel}` : ''} 展期
            {isSingleAccount && positions.length > 0 ? ` ${getAlias(positions[0].account)}` : ''}
          </h3>
          <button className="roll-dialog-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="roll-dialog-body">
          {chain.errorMsg && <div className="roll-dialog-error">{chain.errorMsg}</div>}

          {/* Selectors row — hidden entirely for a 觀察倉 roll (locked target). */}
          {lockChain ? null : chain.dataReady &&
            (chain.availableExpirations.length > 0 || chain.availableStrikes.length > 0) ? (
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
              <button className="roll-expiry-dropdown-btn" disabled>
                載入中…
              </button>
            </div>
          )}

          {/* Multi-expiry option chain */}
          {!lockChain && !chain.chainHidden && (
            <OptionChainTable
              loading={!chain.dataReady}
              displayExpirations={chain.displayExpirations}
              displayStrikes={chain.displayStrikes}
              greeksByExpiry={chain.greeksByExpiry}
              selectedExpiry={targetExpiry}
              selectedStrike={targetStrike}
              selectedRight={targetRight}
              allowedRight={sourceRight}
              onSelect={handleSelect}
            />
          )}

          {/* Order entry section */}
          <div
            className="roll-order-section"
            style={{
              flexWrap: 'nowrap',
              gap: 10,
              // Single-account mode has the 口數 input, which widens Chunk 2
              // enough that space-between reads as balanced. Batch mode drops
              // 口數, so space-between would fling the two chunks to opposite
              // edges and leave a wide gap — left-align them instead.
              justifyContent: isSingleAccount ? 'space-between' : 'flex-start'
            }}
          >
            {/* Chunk 1: source → target option signature. Always rendered so
                the section stays symmetric; target half shows a placeholder
                until the user picks an expiry/strike on the chain. */}
            {(() => {
              const srcPos = positions[0]
              const haveSrc = srcPos && srcPos.expiry && srcPos.strike != null
              // When the selected positions are NOT all the same source option
              // (different accounts rolling different expiries/strikes into one
              // target), a single "Jun24 704C" would misrepresent the batch —
              // show "多組 SELL CALL" instead.
              const uniformSource = positions.every(
                (p) =>
                  p.expiry === srcPos?.expiry &&
                  p.strike === srcPos?.strike &&
                  p.right === srcPos?.right
              )
              const srcStrikeStr =
                srcPos && srcPos.strike != null
                  ? Number.isInteger(Number(srcPos.strike))
                    ? Number(srcPos.strike)
                    : Number(srcPos.strike).toFixed(1)
                  : ''
              const srcRight =
                srcPos?.right === 'C' || srcPos?.right === 'CALL'
                  ? 'C'
                  : srcPos?.right === 'P' || srcPos?.right === 'PUT'
                    ? 'P'
                    : ''
              const haveTgt =
                targetExpiry && targetStrike !== null && targetRight !== null
              const tgtStrikeStr =
                targetStrike !== null
                  ? Number.isInteger(Number(targetStrike))
                    ? Number(targetStrike)
                    : Number(targetStrike).toFixed(1)
                  : ''
              return (
                <span
                  className="roll-order-chunk"
                  style={{ fontSize: 13, fontWeight: 700, color: '#333', background: '#fff7d1' }}
                >
                  {haveSrc ? (
                    uniformSource ? (
                      <>
                        {symbol} {formatExpiry(srcPos.expiry!)} {srcStrikeStr}
                        {srcRight}
                      </>
                    ) : (
                      <>
                        {symbol} 多組{positionLabel ? ` ${positionLabel}` : ''}
                      </>
                    )
                  ) : (
                    <span style={{ color: '#9ca3af' }}>來源 -</span>
                  )}
                  <span style={{ margin: '0 8px', color: '#888' }}>→</span>
                  {haveTgt ? (
                    <>
                      {formatExpiry(targetExpiry!)} {tgtStrikeStr}
                      {targetRight}
                    </>
                  ) : (
                    <span style={{ color: '#9ca3af' }}>選擇目標</span>
                  )}
                </span>
              )
            })()}
            {/* Chunk 2: prices + limit + qty inputs */}
            <span className="roll-order-chunk" style={{ display: 'inline-flex', alignItems: 'center' }}>
              <span className="roll-order-label" style={{ whiteSpace: 'nowrap' }}>
                買
              </span>
              <span className="roll-order-value roll-order-bid" style={{ marginLeft: 4 }}>
                {spreadPrices ? spreadPrices.bid.toFixed(2) : '-'}
              </span>
              <span
                style={{ width: 1, height: 16, background: '#ccc', flexShrink: 0, margin: '0 10px' }}
              />
              <span className="roll-order-label">賣</span>
              <span className="roll-order-value roll-order-ask" style={{ marginLeft: 4 }}>
                {spreadPrices ? spreadPrices.ask.toFixed(2) : '-'}
              </span>
              <span
                style={{ width: 1, height: 16, background: '#ccc', flexShrink: 0, margin: '0 10px' }}
              />
              <span className="roll-order-label">中間</span>
              <span className="roll-order-value roll-order-mid" style={{ marginLeft: 4 }}>
                {spreadPrices ? spreadPrices.mid.toFixed(2) : '-'}
              </span>
              <span
                style={{ width: 1, height: 16, background: '#ccc', flexShrink: 0, margin: '0 10px' }}
              />
              <span className="roll-order-label" style={{ whiteSpace: 'nowrap', fontSize: 12 }}>
                限價
              </span>
              <div className="roll-limit-wrapper" ref={limitInputRef} style={{ marginLeft: 4 }}>
                <input
                  type="text"
                  className="roll-order-input"
                  style={{ width: 55, padding: '0 6px', height: 22, fontSize: 12 }}
                  value={limitPrice}
                  onFocus={() => {
                    // Stop the mid-price auto-fill the moment focus lands
                    // here — otherwise the value can shift under the user's
                    // cursor before they even type, knocking them off the
                    // digit they were about to edit.
                    userEditedPriceRef.current = true
                  }}
                  onChange={(e) => {
                    userEditedPriceRef.current = true
                    setLimitPrice(e.target.value)
                  }}
                  placeholder="0.00"
                />
              </div>
              {isSingleAccount && (
                <>
                  <span
                    style={{ marginLeft: 12, whiteSpace: 'nowrap', fontSize: 12 }}
                    className="roll-order-label"
                  >
                    口數
                  </span>
                  <div className="roll-limit-wrapper" style={{ marginLeft: 4 }}>
                    <input
                      type="number"
                      className="roll-order-input"
                      style={{ width: 45, padding: '0 6px', height: 22, fontSize: 12 }}
                      value={rollQty}
                      onChange={(e) => setRollQty(e.target.value)}
                    />
                  </div>
                </>
              )}
            </span>
          </div>

          {/* Positions table */}
          {positions.length > 0 && (
            <>
              <div className="roll-dialog-table-wrapper roll-accounts-scroll">
                <table className="roll-dialog-table roll-positions-table">
                  <tbody>
                    {[...positions]
                      .sort((a, b) => getAlias(a.account).localeCompare(getAlias(b.account)))
                      .map((pos, idx, arr) => {
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
                          ? `${formatExpiry(targetExpiry)} ${Number.isInteger(Number(targetStrike)) ? Number(targetStrike) : Number(targetStrike).toFixed(1)}${targetRight === 'C' ? 'C' : 'P'}`
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
                          >{`${arr.length - idx}.`}</td>
                          <td>{getAlias(pos.account)}</td>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            {currentDesc} <span style={{ color: '#956b3a' }}>→</span> {targetDesc}
                          </td>
                          <td
                            style={{
                              width: 1,
                              textAlign: 'center',
                              whiteSpace: 'nowrap',
                              paddingLeft: 16,
                              paddingRight: 16
                            }}
                          >
                            {(() => {
                              // DTE = trading days from today to this option's
                              // (source) expiry — how much life is left on it.
                              const now = new Date()
                              const todayYmd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
                              const dte = rollTradingDays(todayYmd, pos.expiry)
                              return dte != null ? `DTE ${dte}` : '-'
                            })()}
                          </td>
                          {(() => {
                            const rd = rollTradingDays(pos.expiry, targetExpiry)
                            const srcStrike = Number(pos.strike)
                            const strikeDelta =
                              targetStrike !== null && Number.isFinite(srcStrike)
                                ? targetStrike - srcStrike
                                : null
                            // 追 (chase) convention, matching 展期觀察 / 委託單:
                            // calls = +strikeΔ, puts = −strikeΔ.
                            const isCall = pos.right === 'C' || pos.right === 'CALL'
                            const pd = strikeDelta === null ? null : isCall ? strikeDelta : -strikeDelta
                            const pdStr =
                              pd === null ? '-' : Number.isInteger(pd) ? `${pd}` : pd.toFixed(1)
                            return (
                              <>
                                <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                                  {rd !== null ? `展 ${rd} 天` : '-'}
                                </td>
                                <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                                  {pd !== null ? `追 ${pdStr} 點` : '-'}
                                </td>
                              </>
                            )
                          })()}
                          <td style={{ whiteSpace: 'nowrap' }}>
                            {displayVal !== null && !isNaN(displayVal as number) ? (
                              <>
                                價差{' '}
                                <span
                                  className={
                                    (displayVal as number) <= 0
                                      ? 'spread-positive'
                                      : 'spread-negative'
                                  }
                                >
                                  {(displayVal as number) >= 0 ? '+' : ''}
                                  {(displayVal as number).toFixed(2)}
                                </span>
                              </>
                            ) : (
                              '-'
                            )}
                          </td>
                          {(() => {
                            const k = keyOf(pos)
                            const original = Math.abs(pos.quantity)
                            const cur = rollQtyByKey[k] ?? original
                            const commit = (raw: string): void => {
                              const n = parseInt(raw, 10)
                              const clamped = Number.isFinite(n)
                                ? Math.min(original, Math.max(1, n))
                                : original
                              setRollQtyByKey((p) => ({ ...p, [k]: clamped }))
                              setEditingQtyKey(null)
                            }
                            // Single-account size is controlled by the global 口數
                            // input; only multi-account rows are inline-editable.
                            const editable = !isSingleAccount
                            return (
                              <td
                                className={editable ? 'roll-qty-cell' : undefined}
                                style={{ textAlign: 'center', whiteSpace: 'nowrap' }}
                                title={editable ? '雙擊編輯口數（只能調少）' : undefined}
                                onDoubleClick={() => editable && setEditingQtyKey(k)}
                              >
                                {editingQtyKey === k ? (
                                  <input
                                    type="number"
                                    autoFocus
                                    min={1}
                                    max={original}
                                    defaultValue={cur}
                                    className="roll-qty-input"
                                    onBlur={(e) => commit(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') commit((e.target as HTMLInputElement).value)
                                      else if (e.key === 'Escape') setEditingQtyKey(null)
                                    }}
                                  />
                                ) : (
                                  <span className={editable ? 'roll-qty-pill' : undefined}>
                                    {cur}
                                    {cur < original ? `/${original}` : ''}口
                                  </span>
                                )}
                              </td>
                            )
                          })()}
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
              // Observe mode only needs a target; placing a roll also needs limit + qty.
              (!observeMode && (!limitPrice || !rollQty)) ||
              submitting
            }
            onClick={() => {
              if (observeMode) {
                if (targetExpiry && targetStrike !== null && targetRight) {
                  onObserve?.({ expiry: targetExpiry, strike: targetStrike, right: targetRight })
                  onClose()
                }
                return
              }
              void performRoll()
            }}
          >
            {observeMode
              ? targetExpiry && targetStrike !== null && targetRight
                ? `儲存觀察 ${symbol} ${formatExpiry(targetExpiry)} ${Number.isInteger(Number(targetStrike)) ? Number(targetStrike) : Number(targetStrike).toFixed(1)}${targetRight}`
                : '儲存觀察'
              : submitting
                ? '下單中...'
                : targetExpiry && targetStrike !== null && targetRight
                  ? `確認展期 ${symbol} ${formatExpiry(targetExpiry)} ${Number.isInteger(Number(targetStrike)) ? Number(targetStrike) : Number(targetStrike).toFixed(1)}${targetRight}`
                  : '確認展期'}
          </button>
        </div>
      </div>
    </div>

    {longRollWarnOpen && (
      <div
        className="roll-dialog-overlay"
        style={{ zIndex: 1000 }}
        onClick={() => setLongRollWarnOpen(false)}
      >
        <div
          className="roll-dialog"
          style={{ width: 460, maxWidth: '92vw' }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="roll-dialog-header">
            <h3 style={{ margin: 0 }}>⚠️ {warnHeader}</h3>
          </div>
          <div
            className="roll-dialog-body"
            style={{ padding: 20, lineHeight: 1.7, fontSize: 14, display: 'flex', flexDirection: 'column', gap: 12 }}
          >
            {warnMessages.map((m, i) => (
              <div key={i}>{m}</div>
            ))}
          </div>
          <div className="roll-dialog-footer">
            <button className="roll-dialog-confirm" onClick={() => setLongRollWarnOpen(false)}>
              知道了
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  )
}
