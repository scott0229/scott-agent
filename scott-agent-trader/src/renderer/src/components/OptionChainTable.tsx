import React from 'react'
import { useMemo } from 'react'

interface OptionGreek {
  strike: number
  right: 'C' | 'P'
  expiry: string
  bid: number
  ask: number
  last: number
  delta: number
  gamma: number
  theta: number
  vega: number
  impliedVol: number
  openInterest: number
}

interface OptionChainTableProps {
  greeks: OptionGreek[]
  selectedStrike: number | null
  selectedRight: 'C' | 'P' | null
  onSelect: (strike: number, right: 'C' | 'P') => void
  currentPrice?: number
}

export default function OptionChainTable({
  greeks,
  selectedStrike,
  selectedRight,
  onSelect,
  currentPrice
}: OptionChainTableProps): React.JSX.Element {
  // Group greeks by strike
  const strikeData = useMemo(() => {
    const map = new Map<number, { call?: OptionGreek; put?: OptionGreek }>()

    for (const g of greeks) {
      const existing = map.get(g.strike) || {}
      if (g.right === 'C') existing.call = g
      else existing.put = g
      map.set(g.strike, existing)
    }

    return Array.from(map.entries())
      .sort(([a], [b]) => a - b)
      .map(([strike, data]) => ({ strike, ...data }))
  }, [greeks])

  if (greeks.length === 0) {
    return <div className="empty-state">請先查詢期權鏈</div>
  }

  const formatPrice = (v: number): string => (v > 0 ? v.toFixed(2) : '-')
  const formatGreek = (v: number): string => {
    if (v === 0) return '-'
    return v.toFixed(3)
  }
  const formatIV = (v: number): string => {
    if (v === 0) return '-'
    return (v * 100).toFixed(1) + '%'
  }

  return (
    <div className="option-chain-wrapper">
      <table className="option-chain-table">
        <thead>
          <tr>
            <th colSpan={6} className="chain-header-call">
              CALL
            </th>
            <th className="chain-header-strike">行使價</th>
            <th colSpan={6} className="chain-header-put">
              PUT
            </th>
          </tr>
          <tr>
            <th>IV</th>
            <th>DELTA</th>
            <th>THETA</th>
            <th>VEGA</th>
            <th>買價</th>
            <th>賣價</th>
            <th className="chain-strike-col">Strike</th>
            <th>買價</th>
            <th>賣價</th>
            <th>VEGA</th>
            <th>THETA</th>
            <th>DELTA</th>
            <th>IV</th>
          </tr>
        </thead>
        <tbody>
          {strikeData.map(({ strike, call, put }) => {
            const isITMCall = currentPrice !== undefined && strike < currentPrice
            const isITMPut = currentPrice !== undefined && strike > currentPrice
            const isATM =
              currentPrice !== undefined &&
              strikeData.length > 0 &&
              Math.abs(strike - currentPrice) ===
                Math.min(...strikeData.map((s) => Math.abs(s.strike - currentPrice)))

            const callSelected = selectedStrike === strike && selectedRight === 'C'
            const putSelected = selectedStrike === strike && selectedRight === 'P'

            return (
              <tr key={strike} className={isATM ? 'strike-atm' : ''}>
                {/* Call side */}
                <td
                  className={`chain-cell-call ${isITMCall ? 'strike-itm' : 'strike-otm'} ${callSelected ? 'chain-selected' : ''}`}
                  onClick={() => onSelect(strike, 'C')}
                >
                  {call ? formatIV(call.impliedVol) : '-'}
                </td>
                <td
                  className={`chain-cell-call ${isITMCall ? 'strike-itm' : 'strike-otm'} ${callSelected ? 'chain-selected' : ''}`}
                  onClick={() => onSelect(strike, 'C')}
                >
                  {call ? formatGreek(call.delta) : '-'}
                </td>
                <td
                  className={`chain-cell-call ${isITMCall ? 'strike-itm' : 'strike-otm'} ${callSelected ? 'chain-selected' : ''}`}
                  onClick={() => onSelect(strike, 'C')}
                >
                  {call ? formatGreek(call.theta) : '-'}
                </td>
                <td
                  className={`chain-cell-call ${isITMCall ? 'strike-itm' : 'strike-otm'} ${callSelected ? 'chain-selected' : ''}`}
                  onClick={() => onSelect(strike, 'C')}
                >
                  {call ? formatGreek(call.vega) : '-'}
                </td>
                <td
                  className={`chain-cell-call chain-bid ${isITMCall ? 'strike-itm' : 'strike-otm'} ${callSelected ? 'chain-selected' : ''}`}
                  onClick={() => onSelect(strike, 'C')}
                >
                  {call ? formatPrice(call.bid) : '-'}
                </td>
                <td
                  className={`chain-cell-call chain-ask ${isITMCall ? 'strike-itm' : 'strike-otm'} ${callSelected ? 'chain-selected' : ''}`}
                  onClick={() => onSelect(strike, 'C')}
                >
                  {call ? formatPrice(call.ask) : '-'}
                </td>

                {/* Strike */}
                <td className={`chain-strike ${isATM ? 'strike-atm-cell' : ''}`}>
                  {strike.toFixed(1)}
                </td>

                {/* Put side */}
                <td
                  className={`chain-cell-put chain-bid ${isITMPut ? 'strike-itm' : 'strike-otm'} ${putSelected ? 'chain-selected' : ''}`}
                  onClick={() => onSelect(strike, 'P')}
                >
                  {put ? formatPrice(put.bid) : '-'}
                </td>
                <td
                  className={`chain-cell-put chain-ask ${isITMPut ? 'strike-itm' : 'strike-otm'} ${putSelected ? 'chain-selected' : ''}`}
                  onClick={() => onSelect(strike, 'P')}
                >
                  {put ? formatPrice(put.ask) : '-'}
                </td>
                <td
                  className={`chain-cell-put ${isITMPut ? 'strike-itm' : 'strike-otm'} ${putSelected ? 'chain-selected' : ''}`}
                  onClick={() => onSelect(strike, 'P')}
                >
                  {put ? formatGreek(put.vega) : '-'}
                </td>
                <td
                  className={`chain-cell-put ${isITMPut ? 'strike-itm' : 'strike-otm'} ${putSelected ? 'chain-selected' : ''}`}
                  onClick={() => onSelect(strike, 'P')}
                >
                  {put ? formatGreek(put.theta) : '-'}
                </td>
                <td
                  className={`chain-cell-put ${isITMPut ? 'strike-itm' : 'strike-otm'} ${putSelected ? 'chain-selected' : ''}`}
                  onClick={() => onSelect(strike, 'P')}
                >
                  {put ? formatGreek(put.delta) : '-'}
                </td>
                <td
                  className={`chain-cell-put ${isITMPut ? 'strike-itm' : 'strike-otm'} ${putSelected ? 'chain-selected' : ''}`}
                  onClick={() => onSelect(strike, 'P')}
                >
                  {put ? formatIV(put.impliedVol) : '-'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
