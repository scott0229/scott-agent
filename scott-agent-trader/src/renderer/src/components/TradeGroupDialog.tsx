import React from 'react'
import { useEffect, useState } from 'react'
import type { GroupDetailResponse, GroupDetailRow } from '../../../preload/index'

interface TradeGroupDialogProps {
  open: boolean
  onClose: () => void
  account: string
  alias: string
  groupName: string
  d1Target: 'staging' | 'production'
}

const MONTH_ABBR = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
]

function ymd(ts: number | null | undefined): string {
  if (!ts) return ''
  const d = new Date(ts * 1000)
  return `${String(d.getFullYear()).slice(-2)}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function tickerText(r: GroupDetailRow): React.ReactNode {
  if (r.type === 'STK') {
    if (r.underlying_price != null) {
      return `${r.underlying} (均價 ${r.underlying_price.toLocaleString('en-US', { maximumFractionDigits: 2 })})`
    }
    return r.underlying
  }
  const typeChar = r.type === 'PUT' ? 'P' : 'C'
  const strike = r.strike_price ?? 0
  if (!r.to_date) {
    return (
      <>
        {r.underlying} <span style={{ textDecoration: 'underline' }}>{strike}{typeChar}</span>
      </>
    )
  }
  const d = new Date(r.to_date * 1000)
  const mon = MONTH_ABBR[d.getMonth()]
  const day = d.getDate()
  const yr = String(d.getFullYear()).slice(-2)
  return (
    <>
      {r.underlying} {mon}{day}'{yr}{' '}
      <span style={{ textDecoration: 'underline' }}>{strike}{typeChar}</span>
    </>
  )
}

function signed(v: number | null | undefined, frac = 0): string {
  if (v == null || v === 0) return v === 0 ? '0' : '-'
  const opts: Intl.NumberFormatOptions = { maximumFractionDigits: frac }
  return (v > 0 ? '+' : '') + v.toLocaleString('en-US', opts)
}

function signClass(v: number | null | undefined): string {
  if (v == null || v === 0) return ''
  return v > 0 ? 'tg-pos' : 'tg-neg'
}

function operationBadge(op: GroupDetailRow['operation']): React.ReactNode {
  const base: React.CSSProperties = {
    padding: '2px 8px',
    borderRadius: 4,
    fontSize: 12,
    fontWeight: 500,
    whiteSpace: 'nowrap'
  }
  if (op === 'Open') {
    return <span style={{ ...base, background: '#fef3c7', color: '#92400e' }}>{op}</span>
  }
  if (op === 'Assigned') {
    return <span style={{ ...base, background: '#fde2e2', color: '#c0392b' }}>{op}</span>
  }
  if (op === 'Expired') {
    return <span style={{ ...base, background: '#dcfce7', color: '#166534' }}>{op}</span>
  }
  if (op === 'Transferred') {
    return <span style={{ ...base, background: '#e0f2fe', color: '#075985' }}>{op}</span>
  }
  return <span style={{ ...base, background: '#e5e7eb', color: '#374151' }}>{op}</span>
}

export default function TradeGroupDialog({
  open,
  onClose,
  account,
  alias,
  groupName,
  d1Target
}: TradeGroupDialogProps): React.JSX.Element | null {
  const [data, setData] = useState<GroupDetailResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !account || !groupName) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setData(null)
    window.ibApi
      .getGroupDetail(account, groupName, d1Target)
      .then((res) => {
        if (cancelled) return
        if (res.error) {
          setError(res.error)
        } else {
          setData(res)
        }
      })
      .catch((err) => {
        if (cancelled) return
        setError(String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, account, groupName, d1Target])

  if (!open) return null

  return (
    <div className="roll-dialog-overlay" onClick={onClose}>
      <div
        className="roll-dialog"
        style={{ width: 1050, maxWidth: '96vw', maxHeight: '70vh', overflow: 'hidden' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="roll-dialog-header" style={{ flexWrap: 'wrap', gap: 12, borderBottom: 'none' }}>
          <h3 style={{ margin: 0 }}>
            {alias} 群組{' '}
            <span
              className="option-group-pill"
              style={{ marginLeft: 6, fontSize: 14, padding: '2px 10px' }}
            >
              {groupName}
            </span>
          </h3>
          {data && data.summary && (
            <div
              className="trade-groups-summary"
              style={{
                display: 'flex',
                gap: 10,
                alignItems: 'center',
                fontSize: 13,
                marginLeft: 'auto'
              }}
            >
              <span className="trade-groups-summary-chip">
                總現金流入{' '}
                <span className={signClass(data.summary.totalNetCashInflow)}>
                  {signed(data.summary.totalNetCashInflow, 1)}
                </span>
              </span>
              <span style={{ color: '#888' }}>+</span>
              <span className="trade-groups-summary-chip">
                平倉成本{' '}
                <span
                  className={
                    data.summary.totalOpenCostToClose > 0
                      ? 'tg-neg'
                      : data.summary.totalOpenCostToClose < 0
                        ? 'tg-pos'
                        : ''
                  }
                >
                  {data.summary.totalOpenCostToClose === 0
                    ? '0'
                    : data.summary.totalOpenCostToClose > 0
                      ? `-${data.summary.totalOpenCostToClose.toLocaleString('en-US', { maximumFractionDigits: 1 })}`
                      : `+${Math.abs(data.summary.totalOpenCostToClose).toLocaleString('en-US', { maximumFractionDigits: 1 })}`}
                </span>
              </span>
              <span style={{ color: '#888' }}>=</span>
              <span className="trade-groups-summary-chip">
                總損益{' '}
                <span className={signClass(data.summary.totalPnL)}>
                  {signed(data.summary.totalPnL, 0)}
                </span>
              </span>
            </div>
          )}
          <button className="roll-dialog-close" onClick={onClose} style={{ marginLeft: 0 }}>
            ✕
          </button>
        </div>

        <div className="roll-dialog-body" style={{ padding: '0 16px 16px' }}>
          {loading && (
            <div className="empty-state" style={{ padding: 20 }}>
              讀取中...
            </div>
          )}
          {error && (
            <div className="roll-dialog-error" style={{ margin: 16 }}>
              讀取失敗:{error}
            </div>
          )}
          {!loading && !error && data && (
            <table className="trade-groups-table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th style={{ width: 40, textAlign: 'center' }}>#</th>
                  <th style={{ width: 90, textAlign: 'center' }}>操作</th>
                  <th style={{ width: 90, textAlign: 'center' }}>開倉日</th>
                  <th style={{ width: 90, textAlign: 'center' }}>平倉日</th>
                  <th style={{ width: 60, textAlign: 'center' }}>數量</th>
                  <th>標的</th>
                  <th style={{ width: 120, textAlign: 'center' }}>累積持股</th>
                  <th style={{ width: 90, textAlign: 'center' }}>當時股價</th>
                  <th style={{ width: 90, textAlign: 'center' }}>權利金</th>
                  <th style={{ width: 90, textAlign: 'center' }}>損益</th>
                  <th style={{ width: 90, textAlign: 'center' }}>展期收益</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="empty-state" style={{ padding: 20 }}>
                      此群組沒有資料
                    </td>
                  </tr>
                ) : (
                  data.rows.map((r, idx) => {
                    const stockTotal = r.cumulative_holdings ?? 0
                    const stockAvg = r.cumulative_avg_price
                    const holdingsText =
                      stockTotal !== 0
                        ? `股${stockTotal.toLocaleString('en-US')}${
                            stockAvg != null
                              ? `, 均${stockAvg.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
                              : ''
                          }`
                        : '-'
                    return (
                      <tr key={`${r.type}-${r.id}-${r.operation}`}>
                        <td style={{ textAlign: 'center', color: '#888' }}>
                          {data.rows.length - idx}
                        </td>
                        <td style={{ textAlign: 'center' }}>{operationBadge(r.operation)}</td>
                        <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                          {ymd(r.open_date)}
                        </td>
                        <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                          {ymd(r.settlement_date)}
                        </td>
                        <td style={{ textAlign: 'center' }}>{r.quantity}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>{tickerText(r)}</td>
                        <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                          {holdingsText}
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          {r.underlying_price != null
                            ? r.underlying_price.toLocaleString('en-US', {
                                maximumFractionDigits: 2
                              })
                            : '-'}
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          {r.premium != null
                            ? r.premium.toLocaleString('en-US', { maximumFractionDigits: 1 })
                            : '-'}
                        </td>
                        <td
                          style={{ textAlign: 'center' }}
                          className={signClass(r.final_profit)}
                        >
                          {r.final_profit != null ? signed(r.final_profit, 0) : '-'}
                        </td>
                        <td
                          style={{ textAlign: 'center' }}
                          className={signClass(r.roll_profit)}
                        >
                          {r.roll_profit != null ? signed(r.roll_profit, 1) : '-'}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
