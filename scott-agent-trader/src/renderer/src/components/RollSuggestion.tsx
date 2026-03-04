import React, { useState, useEffect, useRef, useMemo } from 'react'

interface PositionData {
  account: string
  symbol: string
  secType: string
  expiry?: string
  strike?: number
  right?: string
  quantity: number
  avgCost: number
  conId?: number
}

interface OptionGreek {
  strike: number
  right: 'C' | 'P'
  expiry: string
  bid: number
  ask: number
  last: number
  delta: number
  modelPrice: number
}

interface Suggestion {
  label: string
  symbol: string
  expiry: string
  strike: number
  right: string
  bid: number
  ask: number
  last: number
  delta: number
  type: 'same-strike' | 'delta-target'
  currentAvgCost: number
}

interface RollSuggestionProps {
  positions: PositionData[]
  connected: boolean
}

// Format expiry YYYYMMDD to MonDD'YY
function formatExpiry(expiry: string): string {
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
  const y = expiry.substring(2, 4)
  const m = parseInt(expiry.substring(4, 6), 10)
  const d = expiry.substring(6, 8)
  return `${months[m - 1]}${d}'${y}`
}

export default function RollSuggestion({
  positions,
  connected
}: RollSuggestionProps): React.JSX.Element | null {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const fetchedRef = useRef<string>('')

  // Extract unique option groups from positions: {symbol, expiry, right, strikes[]}
  // Memoize to avoid creating a new array reference every render
  const optPositions = useMemo(
    () => positions.filter((p) => p.secType === 'OPT' && p.expiry && p.right && p.strike && p.quantity < 0),
    [positions]
  )

  useEffect(() => {
    if (!connected || optPositions.length === 0) {
      setSuggestions([])
      setLoading(false)
      return
    }

    // Build unique key to avoid re-fetching
    const groupKey = optPositions
      .map((p) => `${p.symbol}|${p.expiry}|${p.right}|${p.strike}`)
      .sort()
      .join(',')

    if (fetchedRef.current === groupKey) {
      return
    }
    fetchedRef.current = groupKey
    window.ibApi.log('[RollSuggestion] Fetching suggestions for:', groupKey)

    // Group by symbol + expiry + right
    const groups = new Map<
      string,
      { symbol: string; expiry: string; right: string; strikes: Set<number> }
    >()
    for (const p of optPositions) {
      const key = `${p.symbol}|${p.expiry}|${p.right}`
      if (!groups.has(key)) {
        groups.set(key, {
          symbol: p.symbol,
          expiry: p.expiry!,
          right: p.right!,
          strikes: new Set()
        })
      }
      groups.get(key)!.strikes.add(p.strike!)
    }



    const fetchSuggestions = async (): Promise<void> => {
      setLoading(true)
      setError(null)
      const results: Suggestion[] = []

      try {
        for (const [, g] of groups) {
          // 1. Get option chain to find next expiry
          const chain = await window.ibApi.getOptionChain(g.symbol)
          if (!chain || chain.length === 0) continue

          // Merge all expirations from all exchanges, sorted
          const allExpiries = [
            ...new Set(chain.flatMap((c: any) => c.expirations))
          ].sort() as string[]
          const nextExpiry = allExpiries.find((e) => e > g.expiry) as string
          if (!nextExpiry) continue

          // Get all strikes from chain for this symbol
          const allStrikesRaw = [...new Set(chain.flatMap((c: any) => c.strikes))] as number[]
          const allStrikes = allStrikesRaw.sort((a, b) => a - b)

          // Find nearby strikes for delta scan (pick ~20 strikes around current strikes)
          const currentStrikes = [...g.strikes]
          const minStrike = Math.min(...currentStrikes)
          const maxStrike = Math.max(...currentStrikes)
          // Include current strikes + 15 strikes above and below
          const nearbyStrikes = allStrikes.filter((s: number) => {
            const idx = allStrikes.indexOf(s)
            const minIdx = allStrikes.findIndex((x: number) => x >= minStrike) - 15
            const maxIdx = allStrikes.findIndex((x: number) => x > maxStrike) + 15
            return idx >= Math.max(0, minIdx) && idx <= Math.min(allStrikes.length - 1, maxIdx)
          })

          if (nearbyStrikes.length === 0) continue

          // 2. Get greeks for next expiry
          const greeks: OptionGreek[] = await window.ibApi.getOptionGreeks(
            g.symbol,
            nextExpiry,
            nearbyStrikes
          )

          const safeGreeks = greeks ?? []

          // Filter to same direction
          const sameRight = safeGreeks.filter((gk: OptionGreek) => gk.right === g.right)
          const getPrice = (gk: OptionGreek): number => {
            if (gk.bid > 0 && gk.ask > 0) return (gk.bid + gk.ask) / 2
            if (gk.last > 0) return gk.last
            return gk.modelPrice
          }

          window.ibApi.log(
            `[RollSuggestion] ${g.symbol} ${g.right}: currentStrikes=${currentStrikes} nextExpiry=${nextExpiry} sameRight=${sameRight.length}`
          )

          // a. Same-strike suggestion for each current strike
          // Always show these, even without price data — prices update later
          for (const strike of currentStrikes) {
            const match = sameRight.find((gk: OptionGreek) => gk.strike === strike)
            // Average avgCost across all positions at this strike+right
            // IB avgCost for options = per-share price * 100 (multiplier)
            const matchingPos = optPositions.filter(
              (p) => p.strike === strike && p.right === g.right
            )
            const avgCostSum = matchingPos.reduce((sum, p) => sum + p.avgCost / 100, 0)
            const currentAvgCost = matchingPos.length > 0 ? avgCostSum / matchingPos.length : 0
            results.push({
              label: `${g.symbol} ${formatExpiry(nextExpiry)} ${strike}${g.right}`,
              symbol: g.symbol,
              expiry: nextExpiry,
              strike,
              right: g.right,
              bid: match?.bid ?? 0,
              ask: match?.ask ?? 0,
              last: match ? (match.last > 0 ? match.last : getPrice(match)) : 0,
              delta: match?.delta ?? 0,
              type: 'same-strike',
              currentAvgCost
            })
          }

          // b. Delta target suggestion: find strike with |delta| closest to 0.2 (but >= 0.2)
          // Sort candidates by |delta| ascending — no price requirement so suggestions show immediately
          const candidates = sameRight
            .filter((gk: OptionGreek) => Math.abs(gk.delta) >= 0.15)
            .sort((a: OptionGreek, b: OptionGreek) => Math.abs(a.delta) - Math.abs(b.delta))

          // Find the one closest to 0.2 with |delta| >= 0.2
          const deltaTarget = candidates.find((gk: OptionGreek) => Math.abs(gk.delta) >= 0.2)
          if (deltaTarget) {
            // Skip if this strike is already in same-strike suggestions
            const alreadySuggested = currentStrikes.includes(deltaTarget.strike)
            if (!alreadySuggested) {
              // Use average avgCost of all positions in this group
              // IB avgCost for options = per-share price * 100 (multiplier)
              const allPos = optPositions.filter((p) => p.right === g.right)
              const avgAll = allPos.reduce((s, p) => s + p.avgCost / 100, 0) / (allPos.length || 1)
              results.push({
                label: `${g.symbol} ${formatExpiry(nextExpiry)} ${deltaTarget.strike}${g.right}`,
                symbol: g.symbol,
                expiry: nextExpiry,
                strike: deltaTarget.strike,
                right: g.right,
                bid: deltaTarget.bid,
                ask: deltaTarget.ask,
                last: deltaTarget.last > 0 ? deltaTarget.last : getPrice(deltaTarget),
                delta: deltaTarget.delta,
                type: 'delta-target',
                currentAvgCost: avgAll
              })
            }
          }
        }

        setSuggestions(results)
      } catch (err) {
        window.ibApi.log('[RollSuggestion] Error:', err)
        setError('無法取得建議')
      } finally {
        setLoading(false)
      }
    }

    fetchSuggestions()

    // Re-fetch every 30s if any suggestion still has missing prices
    const intervalId = setInterval(() => {
      fetchedRef.current = '' // Allow re-fetch
      fetchSuggestions()
    }, 30000)

    return () => clearInterval(intervalId)
  }, [connected, optPositions])



  if (optPositions.length === 0) return null
  if (!connected) return null

  return (
    <div className="positions-section" style={{ marginTop: '12px' }}>

      {loading && <div style={{ color: '#aaa', padding: '4px 8px' }}>載入中...</div>}
      {error && <div style={{ color: '#dc2626', padding: '4px 8px' }}>{error}</div>}
      {!loading && !error && suggestions.length === 0 && (
        <div style={{ color: '#94a3b8', padding: '4px 8px', fontSize: '12px' }}>暫無建議</div>
      )}
      {suggestions.length > 0 && (
        <table className="positions-table">
          <thead>
            <tr>
              <th style={{ width: '15%', textAlign: 'left' }}>展期類型</th>
              <th style={{ width: '25%', textAlign: 'left' }}>目標期權</th>
              <th style={{ width: '10%' }}>Delta</th>
              <th style={{ width: '11%' }}>中間價</th>
              <th style={{ width: '11%' }}>均價</th>
              <th style={{ width: '11%' }}>價差</th>
            </tr>
          </thead>
          <tbody>
            {suggestions.map((s, i) => (
              <tr key={i}>
                <td
                  style={{
                    textAlign: 'left',
                    color: 'inherit'
                  }}
                >
                  {s.type === 'same-strike' ? '依價位' : '依字母'}
                </td>
                <td className="pos-symbol">{s.label}</td>
                <td>{s.delta ? s.delta.toFixed(3) : '—'}</td>
                {(() => {
                  const mid = s.bid > 0 || s.ask > 0 ? (s.bid + s.ask) / 2 : s.last || 0
                  return <td>{mid > 0 ? mid.toFixed(2) : '—'}</td>
                })()}
                <td>{s.currentAvgCost.toFixed(2)}</td>
                {(() => {
                  const mid = s.bid > 0 || s.ask > 0 ? (s.bid + s.ask) / 2 : s.last || 0
                  if (mid <= 0) return <td style={{ color: '#94a3b8' }}>—</td>
                  const spread = mid - s.currentAvgCost
                  return (
                    <td style={{ color: spread >= 0 ? '#1a6b3a' : '#8b1a1a' }}>
                      {spread >= 0 ? '+' : ''}
                      {spread.toFixed(2)}
                    </td>
                  )
                })()}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
