import React from 'react'
import type { OptionGreek } from '../hooks/useOptionChain'
import { formatExpiry, formatPrice, formatGreekValue } from '../hooks/useOptionChain'

interface OptionChainTableProps {
  loading: boolean
  displayExpirations: string[]
  displayStrikes: number[]
  greeksByExpiry: Map<string, Map<string, OptionGreek>>
  selectedExpiry: string
  selectedStrike: number | null
  selectedRight: 'C' | 'P' | null
  onSelect: (expiry: string, strike: number, right: 'C' | 'P') => void
  // When set, only this side is selectable — a PUT roll can't target a CALL and
  // vice-versa. The other side renders greyed-out and non-clickable.
  allowedRight?: 'C' | 'P' | null
}

export default function OptionChainTable({
  loading,
  displayExpirations,
  displayStrikes,
  greeksByExpiry,
  selectedExpiry,
  selectedStrike,
  selectedRight,
  onSelect,
  allowedRight = null
}: OptionChainTableProps): React.JSX.Element {
  const dataReady = displayExpirations.length > 0 && displayStrikes.length > 0
  const callDisabled = allowedRight != null && allowedRight !== 'C'
  const putDisabled = allowedRight != null && allowedRight !== 'P'
  const fmtIv = (iv: number | undefined): string =>
    iv != null && Number.isFinite(iv) ? `${Math.round(iv * 100)}%` : '-'

  return (
    <div className="roll-chain-multi">
      <table className="roll-chain-table">
        <thead>
          <tr>
            <th colSpan={5} className="roll-chain-side-header roll-chain-call-header">
              CALL
            </th>
            <th className="roll-chain-desc-header"></th>
            <th colSpan={5} className="roll-chain-side-header roll-chain-put-header">
              PUT
            </th>
          </tr>
        </thead>
        <tbody>
          {loading && !dataReady && (
            <>
              <tr className="roll-chain-expiry-row">
                <td>DELTA</td>
                <td>IV</td>
                <td>買價</td>
                <td>賣價</td>
                <td>最後價</td>
                <td className="roll-chain-expiry-label" style={{ opacity: 0.4 }}>
                  載入中…
                </td>
                <td>買價</td>
                <td>賣價</td>
                <td>最後價</td>
                <td>IV</td>
                <td>DELTA</td>
              </tr>
              {Array.from({ length: 10 }, (_, i) => (
                <tr key={`skeleton-${i}`}>
                  <td className="roll-chain-cell roll-chain-call" style={{ opacity: 0.3 }}>
                    -
                  </td>
                  <td className="roll-chain-cell roll-chain-call" style={{ opacity: 0.3 }}>
                    -
                  </td>
                  <td
                    className="roll-chain-cell roll-chain-call chain-bid"
                    style={{ opacity: 0.3 }}
                  >
                    -
                  </td>
                  <td
                    className="roll-chain-cell roll-chain-call chain-ask"
                    style={{ opacity: 0.3 }}
                  >
                    -
                  </td>
                  <td className="roll-chain-cell roll-chain-call" style={{ opacity: 0.3 }}>
                    -
                  </td>
                  <td className="roll-chain-strike" style={{ opacity: 0.3 }}>
                    -
                  </td>
                  <td className="roll-chain-cell roll-chain-put chain-bid" style={{ opacity: 0.3 }}>
                    -
                  </td>
                  <td className="roll-chain-cell roll-chain-put chain-ask" style={{ opacity: 0.3 }}>
                    -
                  </td>
                  <td className="roll-chain-cell roll-chain-put" style={{ opacity: 0.3 }}>
                    -
                  </td>
                  <td className="roll-chain-cell roll-chain-put" style={{ opacity: 0.3 }}>
                    -
                  </td>
                  <td className="roll-chain-cell roll-chain-put" style={{ opacity: 0.3 }}>
                    -
                  </td>
                </tr>
              ))}
            </>
          )}
          {dataReady &&
            displayExpirations.map((expiry) => {
              const gMap = greeksByExpiry.get(expiry)
              return [
                <tr key={`hdr-${expiry}`} className="roll-chain-expiry-row">
                  <td>DELTA</td>
                  <td>IV</td>
                  <td>買價</td>
                  <td>賣價</td>
                  <td>最後價</td>
                  <td className="roll-chain-expiry-label">{formatExpiry(expiry)}</td>
                  <td>買價</td>
                  <td>賣價</td>
                  <td>最後價</td>
                  <td>IV</td>
                  <td>DELTA</td>
                </tr>,
                ...displayStrikes.map((strike) => {
                  const cg = gMap?.get(`${strike}_C`)
                  const pg = gMap?.get(`${strike}_P`)
                  const callSel =
                    selectedExpiry === expiry && selectedStrike === strike && selectedRight === 'C'
                  const putSel =
                    selectedExpiry === expiry && selectedStrike === strike && selectedRight === 'P'
                  const callCls = `roll-chain-cell roll-chain-call${callSel ? ' roll-chain-selected' : ''}${callDisabled ? ' roll-chain-disabled' : ''}`
                  const putCls = `roll-chain-cell roll-chain-put${putSel ? ' roll-chain-selected' : ''}${putDisabled ? ' roll-chain-disabled' : ''}`
                  const onCall = callDisabled
                    ? undefined
                    : (): void => onSelect(expiry, strike, 'C')
                  const onPut = putDisabled
                    ? undefined
                    : (): void => onSelect(expiry, strike, 'P')
                  return (
                    <tr key={`${expiry}-${strike}`}>
                      {/* Call side: Delta | IV | Bid | Ask | Last */}
                      <td className={callCls} onClick={onCall}>
                        {cg ? formatGreekValue(cg.delta) : '-'}
                      </td>
                      <td className={callCls} onClick={onCall}>
                        {cg ? fmtIv(cg.impliedVol) : '-'}
                      </td>
                      <td className={`${callCls} chain-bid`} onClick={onCall}>
                        {cg ? formatPrice(cg.bid) : '-'}
                      </td>
                      <td className={`${callCls} chain-ask`} onClick={onCall}>
                        {cg ? formatPrice(cg.ask) : '-'}
                      </td>
                      <td className={callCls} onClick={onCall}>
                        {cg ? formatPrice(cg.last) : '-'}
                      </td>
                      <td className="roll-chain-strike">{strike}</td>
                      {/* Put side: Bid | Ask | Last | IV | Delta */}
                      <td className={`${putCls} chain-bid`} onClick={onPut}>
                        {pg ? formatPrice(pg.bid) : '-'}
                      </td>
                      <td className={`${putCls} chain-ask`} onClick={onPut}>
                        {pg ? formatPrice(pg.ask) : '-'}
                      </td>
                      <td className={putCls} onClick={onPut}>
                        {pg ? formatPrice(pg.last) : '-'}
                      </td>
                      <td className={putCls} onClick={onPut}>
                        {pg ? fmtIv(pg.impliedVol) : '-'}
                      </td>
                      <td className={putCls} onClick={onPut}>
                        {pg ? formatGreekValue(pg.delta) : '-'}
                      </td>
                    </tr>
                  )
                })
              ]
            })}
        </tbody>
      </table>
    </div>
  )
}
