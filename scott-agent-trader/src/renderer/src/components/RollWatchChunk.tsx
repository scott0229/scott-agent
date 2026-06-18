import React from 'react'
import { useEffect, useRef, useState } from 'react'
import { formatExpiry } from '../hooks/useOptionChain'
import { rollTradingDays } from '../lib/tradingDays'

interface Leg {
  expiry: string
  strike: number
  right: 'C' | 'P'
}

interface RollWatchChunkProps {
  symbol: string
  source: Leg
  target: Leg
  isShort: boolean
  // When true the strike was chased in the breach direction (+N for calls,
  // −N for puts), so the spec reads "追 N 點" using `points` rather than the
  // signed target−source strike diff. Omitted/false → plain "展 N 點".
  chase?: boolean
  points?: number
  // Optional — when omitted (e.g. auto-generated default-rule watches) the
  // ✕ remove button is hidden since there's nothing saved to remove.
  onClear?: () => void
  // 用這組觀察直接交易：開啟展期 DIALOG 並預選此標的。
  onGo: () => void
  // Only meaningful in 暫停一天 mode (展 0 天 + 追 0 點): clicking the 暫停一天
  // label calls onPauseToggle to mark/unmark the group's positions as handled
  // today (blue left-edge). `paused` reflects the current marked state.
  paused?: boolean
  onPauseToggle?: () => void
}

// A persistent "展期觀察" row on a batch card: source → target with the live
// roll spread (買/賣/中間), refreshed every 2s. The spread maths mirror the roll
// dialog's spreadPrices so the numbers match exactly.
export default function RollWatchChunk({
  symbol,
  source,
  target,
  isShort,
  chase,
  points,
  onClear,
  onGo,
  paused,
  onPauseToggle
}: RollWatchChunkProps): React.JSX.Element {
  const [spread, setSpread] = useState<{ bid: number; ask: number; mid: number } | null>(null)
  const [targetDelta, setTargetDelta] = useState<number | null>(null)
  const [targetIv, setTargetIv] = useState<number | null>(null)
  const cancelledRef = useRef(false)

  useEffect(() => {
    cancelledRef.current = false
    const fetchOnce = async (): Promise<void> => {
      try {
        const [srcGreeks, tgtGreeks] = await Promise.all([
          window.ibApi.getOptionGreeks(symbol, source.expiry, [source.strike]),
          window.ibApi.getOptionGreeks(symbol, target.expiry, [target.strike])
        ])
        const cur = srcGreeks.find((g) => g.strike === source.strike && g.right === source.right)
        const tgt = tgtGreeks.find((g) => g.strike === target.strike && g.right === target.right)
        if (cancelledRef.current || !cur || !tgt) return
        const spreadBid = isShort ? cur.ask - tgt.bid : tgt.ask - cur.bid
        const spreadAsk = isShort ? cur.bid - tgt.ask : tgt.bid - cur.ask
        setSpread({ bid: spreadBid, ask: spreadAsk, mid: (spreadBid + spreadAsk) / 2 })
        // Target leg's delta = the new position's assignment probability.
        setTargetDelta(Number.isFinite(tgt.delta) ? tgt.delta : null)
        setTargetIv(Number.isFinite(tgt.impliedVol) ? tgt.impliedVol : null)
      } catch {
        /* ignore transient quote errors */
      }
    }
    void fetchOnce()
    const id = setInterval(() => void fetchOnce(), 2000)
    return () => {
      cancelledRef.current = true
      clearInterval(id)
    }
  }, [
    symbol,
    source.expiry,
    source.strike,
    source.right,
    target.expiry,
    target.strike,
    target.right,
    isShort
  ])

  const fmtLeg = (l: Leg): string =>
    `${formatExpiry(l.expiry)} ${Number.isInteger(l.strike) ? l.strike : l.strike.toFixed(1)}${l.right}`
  const fmt = (v: number | undefined): string =>
    v != null && Number.isFinite(v) ? v.toFixed(2) : '-'

  const days = rollTradingDays(source.expiry, target.expiry)
  // 追 (chase) convention everywhere: chase points = strike delta for calls,
  // negated for puts. Auto rules pass an explicit `points`; manual watches derive
  // it from the strike difference.
  const rawDelta = target.strike - source.strike
  const pts = chase && points != null ? points : source.right === 'C' ? rawDelta : -rawDelta
  const ptsStr = Number.isInteger(pts) ? `${pts}` : pts.toFixed(1)
  const ptsVerb = '追'
  // 展 0 天 + 追 0 點 ⇒ the target leg equals the source: not a roll, just a
  // "hold and re-check tomorrow". Show it as A → 暫停一天 and drop the roll
  // metrics, quote, and ✓ (there's no trade to place).
  const isPause = days === 0 && pts === 0

  // In 暫停一天 mode the whole row toggles the handled-today mark.
  const pauseClickable = isPause && !!onPauseToggle

  return (
    <div
      className="roll-watch-chunk"
      onClick={
        pauseClickable
          ? (e) => {
              e.stopPropagation()
              onPauseToggle?.()
            }
          : undefined
      }
      style={pauseClickable ? { cursor: 'pointer' } : undefined}
      title={pauseClickable ? '標記／取消今日已處理（成交）' : undefined}
    >
      <span className="roll-watch-spec">
        {symbol} {fmtLeg(source)} <span style={{ color: '#956b3a' }}>→</span>{' '}
        {isPause ? (
          <span
            style={{
              color: paused ? '#2563eb' : undefined,
              fontWeight: paused ? 600 : undefined
            }}
          >
            暫停一天
          </span>
        ) : (
          fmtLeg(target)
        )}
        {!isPause && targetDelta != null && (
          <>
            <span className="roll-watch-sep">·</span>
            <span style={{ fontWeight: 400 }}>
              delta {Math.abs(targetDelta).toFixed(2)}
            </span>
          </>
        )}
        {!isPause && targetIv != null && (
          <>
            <span className="roll-watch-sep">·</span>
            <span style={{ fontWeight: 400 }}>iv {(targetIv * 100).toFixed(0)}%</span>
          </>
        )}
        {!isPause && (
          <>
            <span className="roll-watch-sep">·</span>
            <span className="roll-watch-delta">
              展 {days != null ? days : '-'} 天<span className="roll-watch-sep">·</span>
              {ptsVerb} {ptsStr} 點
            </span>
          </>
        )}
      </span>
      {!isPause && (
        <span className="roll-watch-prices">
          <span>
            買 <b style={{ color: '#1a6b3a' }}>{fmt(spread?.bid)}</b>
          </span>
          <span className="roll-watch-sep">·</span>
          <span>
            賣 <b style={{ color: '#c0392b' }}>{fmt(spread?.ask)}</b>
          </span>
          <span className="roll-watch-sep">·</span>
          <span>
            中間 <b style={{ color: '#1d4ed8' }}>{fmt(spread?.mid)}</b>
          </span>
        </span>
      )}
      <span className="roll-watch-actions">
        {!isPause && (
          <button
            className="roll-watch-go"
            title="用這組觀察展期"
            onClick={(e) => {
              e.stopPropagation()
              onGo()
            }}
          >
            ✓
          </button>
        )}
        {onClear && (
          <button className="roll-watch-clear" title="移除觀察" onClick={onClear}>
            ✕
          </button>
        )}
      </span>
    </div>
  )
}
