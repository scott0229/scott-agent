import React, { useState, useEffect, useRef } from 'react'

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
  window.ibApi.log(
    '[RollSuggestion] Render started (HMR). positions length:',
    positions.length,
    'connected:',
    connected
  )
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const fetchedRef = useRef<string>('')

  // Extract unique option groups from positions: {symbol, expiry, right, strikes[]}
  const optPositions = positions.filter(
    (p) => p.secType === 'OPT' && p.expiry && p.right && p.strike
  )
  window.ibApi.log('[RollSuggestion] optPositions:', optPositions.length)

  useEffect(() => {
    window.ibApi.log(
      '[RollSuggestion] useEffect triggered, connected:',
      connected,
      'optPositions:',
      optPositions.length
    )
    if (!connected || optPositions.length === 0) {
      window.ibApi.log('[RollSuggestion] empty or not connected, returning early')
      setSuggestions([])
      return
    }

    // Build unique key to avoid re-fetching
    const groupKey = optPositions
      .map((p) => `${p.symbol}|${p.expiry}|${p.right}|${p.strike}`)
      .sort()
      .join(',')

    if (fetchedRef.current === groupKey) {
      window.ibApi.log('[RollSuggestion] Skipping fetch, same groupKey')
      return
    }
    fetchedRef.current = groupKey
    window.ibApi.log('[RollSuggestion] New groupKey:', groupKey)

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

    window.ibApi.log('[RollSuggestion] Group building complete. groups count:', groups.size)

    const fetchSuggestions = async (): Promise<void> => {
      window.ibApi.log('[RollSuggestion] Inside fetchSuggestions()')
      setLoading(true)
      setError(null)
      const results: Suggestion[] = []

      try {
        for (const [, g] of groups) {
          window.ibApi.log(
            '[RollSuggestion] Fetching chain for',
            g.symbol,
            'expiry:',
            g.expiry,
            'right:',
            g.right
          )
          // 1. Get option chain to find next expiry
          const chain = await window.ibApi.getOptionChain(g.symbol)
          window.ibApi.log('[RollSuggestion] Chain result:', chain?.length, 'entries')
          if (!chain || chain.length === 0) continue

          // Merge all expirations from all exchanges, sorted
          const allExpiries = [
            ...new Set(chain.flatMap((c: any) => c.expirations))
          ].sort() as string[]
          const nextExpiry = allExpiries.find((e) => e > g.expiry) as string
          window.ibApi.log(
            '[RollSuggestion] allExpiries sample:',
            allExpiries.slice(0, 5),
            'found nextExpiry:',
            nextExpiry,
            'looking for >',
            g.expiry
          )
          if (!nextExpiry) {
            window.ibApi.log('[RollSuggestion] No next expiry found, skipping')
            continue
          }

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

          if (!greeks || greeks.length === 0) continue

          // Filter to same direction
          const sameRight = greeks.filter((gk: OptionGreek) => gk.right === g.right)
          const hasPrice = (gk: OptionGreek): boolean => gk.bid > 0 || gk.ask > 0 || gk.last > 0

          // a. Same-strike suggestion for each current strike
          for (const strike of currentStrikes) {
            const match = sameRight.find((gk: OptionGreek) => gk.strike === strike)
            if (match && hasPrice(match)) {
              // Average avgCost across all positions at this strike+right
              // IB avgCost for options = per-share price * 100 (multiplier)
              const matchingPos = optPositions.filter(
                (p) => p.strike === strike && p.right === g.right
              )
              const avgCostSum = matchingPos.reduce((sum, p) => sum + p.avgCost / 100, 0)
              const currentAvgCost = matchingPos.length > 0 ? avgCostSum / matchingPos.length : 0
              results.push({
                label: `${g.symbol} ${formatExpiry(nextExpiry)} ${match.strike}${g.right}`,
                symbol: g.symbol,
                expiry: nextExpiry,
                strike: match.strike,
                right: g.right,
                bid: match.bid,
                ask: match.ask,
                last: match.last,
                delta: match.delta,
                type: 'same-strike',
                currentAvgCost
              })
            }
          }

          // b. Delta target suggestion: find strike with |delta| closest to 0.2 (but >= 0.2)
          // Sort candidates by |delta| ascending
          const candidates = sameRight
            .filter((gk: OptionGreek) => Math.abs(gk.delta) >= 0.15 && hasPrice(gk))
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
                last: deltaTarget.last,
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
  }, [connected, optPositions, optPositions.length])

  window.ibApi.log(
    '[RollSuggestion] About to render layout. suggestions:',
    suggestions.length,
    'loading:',
    loading,
    'error:',
    error
  )

  if (optPositions.length === 0) return null
  if (!connected) return null

  return (
    <div className="positions-section" style={{ marginTop: '12px' }}>
      <div style={{ fontWeight: 600, marginBottom: '6px', color: '#64748b' }}>📋 展期建議</div>
      {loading && <div style={{ color: '#aaa', padding: '4px 8px' }}>載入中...</div>}
      {error && <div style={{ color: '#dc2626', padding: '4px 8px' }}>{error}</div>}
      {suggestions.length > 0 && (
        <table className="positions-table">
          <thead>
            <tr>
              <th style={{ width: '15%', textAlign: 'center' }}>類型</th>
              <th style={{ width: '25%', textAlign: 'left' }}>期權</th>
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
                    textAlign: 'center',
                    color: s.type === 'same-strike' ? '#64748b' : '#3b82f6'
                  }}
                >
                  {s.type === 'same-strike' ? '同價位' : 'Δ建議'}
                </td>
                <td className="pos-symbol">{s.label}</td>
                <td>{s.delta ? s.delta.toFixed(3) : '-'}</td>
                {(() => {
                  const mid = s.bid > 0 || s.ask > 0 ? (s.bid + s.ask) / 2 : s.last || 0
                  return <td>{mid.toFixed(2)}</td>
                })()}
                <td>{s.currentAvgCost.toFixed(2)}</td>
                {(() => {
                  const mid = s.bid > 0 || s.ask > 0 ? (s.bid + s.ask) / 2 : s.last || 0
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
