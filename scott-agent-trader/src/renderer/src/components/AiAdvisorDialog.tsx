import { useState, useEffect } from 'react'
import type { AccountData, PositionData } from '../hooks/useAccountStore'

interface Recommendation {
  position: string
  action: 'roll' | 'hold' | 'close' | 'sell' | 'skip_stock' | 'skip_option' | 'already_traded'
  optionAction?:
    | 'roll'
    | 'hold'
    | 'close'
    | 'sell'
    | 'skip_stock'
    | 'skip_option'
    | 'already_traded'
  targetExpiry?: string
  targetStrike?: number
  estimatedCredit?: string
  reason: string
}

interface AdvisorResponse {
  recommendations: Recommendation[]
  summary: string
  error?: string
}

interface AiAdvisorDialogProps {
  open: boolean
  onClose: () => void
  account: AccountData
  positions: PositionData[]
  quotes: Record<string, number>
  optionQuotes: Record<string, number>
}

const ACTION_LABELS: Record<string, { text: string; color: string; bg: string }> = {
  roll: { text: '建議展期', color: '#166534', bg: '#dcfce7' },
  hold: { text: '持有', color: '#4b5563', bg: '#f3f4f6' },
  close: { text: '平倉', color: '#991b1b', bg: '#fee2e2' },
  sell: { text: '賣出 CALL', color: '#1e40af', bg: '#dbeafe' },
  skip_stock: { text: '持股', color: '#4b5563', bg: '#f3f4f6' },
  skip_option: { text: '期權：今日不操作', color: '#4b5563', bg: '#f3f4f6' },
  already_traded: { text: '持有', color: '#4b5563', bg: '#f3f4f6' }
}

function isGroupable(rec: Recommendation): boolean {
  return !rec.targetExpiry && !rec.targetStrike
}

function getOptText(rec: Recommendation): string {
  if (!rec.optionAction) return ''
  const optInfo = ACTION_LABELS[rec.optionAction] || ACTION_LABELS.skip_option
  if (rec.optionAction === 'skip_option' && rec.reason?.includes('已有CC')) return '已有CC覆蓋'
  return optInfo.text
}

function groupKey(rec: Recommendation): string {
  const actionLabel = (ACTION_LABELS[rec.action] || ACTION_LABELS.hold).text
  const optLabel = rec.optionAction ? getOptText(rec) : ''
  return `${actionLabel}|${optLabel}`
}

function normalizeReason(reason: string): string {
  if (!reason) return reason
  const last = reason.trimEnd().slice(-1)
  if (['。', '！', '？', '!', '?', '.'].includes(last)) return reason
  return `${reason.trimEnd()}。`
}

interface RenderItem {
  type: 'individual'
  rec: Recommendation
}
interface RenderGroup {
  type: 'group'
  key: string
  recs: Recommendation[]
}
type RenderEntry = RenderItem | RenderGroup

function buildRenderList(recs: Recommendation[]): RenderEntry[] {
  const sorted = [...recs].sort((a, b) => {
    const priority = (action: string): number =>
      ['sell', 'roll', 'close'].includes(action) ? 0 : 1
    const pDiff = priority(a.action) - priority(b.action)
    if (pDiff !== 0) return pDiff
    return a.action.localeCompare(b.action)
  })

  const entries: RenderEntry[] = []
  const groupMap = new Map<string, Recommendation[]>()

  for (const rec of sorted) {
    if (isGroupable(rec)) {
      const k = groupKey(rec)
      if (!groupMap.has(k)) groupMap.set(k, [])
      groupMap.get(k)!.push(rec)
    } else {
      entries.push({ type: 'individual', rec })
    }
  }

  for (const [key, grpRecs] of groupMap) {
    if (grpRecs.length === 1) {
      entries.push({ type: 'individual', rec: grpRecs[0] })
    } else {
      entries.push({ type: 'group', key, recs: grpRecs })
    }
  }

  return entries
}

function Badges({ rec }: { rec: Recommendation }): React.ReactElement {
  const actionInfo = ACTION_LABELS[rec.action] || ACTION_LABELS.hold
  const optInfo = rec.optionAction
    ? ACTION_LABELS[rec.optionAction] || ACTION_LABELS.skip_option
    : null
  const optText = rec.optionAction ? getOptText(rec) : ''
  return (
    <div className="ai-advisor-rec-badges">
      {rec.action === 'sell' && rec.position.includes('股票') && (
        <span
          className="ai-advisor-rec-action"
          style={{
            color: ACTION_LABELS.skip_stock.color,
            backgroundColor: ACTION_LABELS.skip_stock.bg
          }}
        >
          {ACTION_LABELS.skip_stock.text}
        </span>
      )}
      <span
        className="ai-advisor-rec-action"
        style={{ color: actionInfo.color, backgroundColor: actionInfo.bg }}
      >
        {actionInfo.text}
      </span>
      {optInfo && rec.optionAction !== rec.action && (
        <span
          className="ai-advisor-rec-action"
          style={{ color: optInfo.color, backgroundColor: optInfo.bg }}
        >
          {optText}
        </span>
      )}
    </div>
  )
}

export default function AiAdvisorDialog({
  open,
  onClose,
  account,
  positions,
  quotes,
  optionQuotes
}: AiAdvisorDialogProps): React.ReactElement | null {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<AdvisorResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setResult(null)
    setError(null)

    const acctPositions = positions.filter((p) => p.account === account.accountId)

    window.ibApi
      .getAiAdvice({
        account: {
          accountId: account.accountId,
          alias: account.alias,
          netLiquidation: account.netLiquidation,
          totalCashValue: account.totalCashValue,
          grossPositionValue: account.grossPositionValue
        },
        positions: acctPositions.map((p) => ({
          symbol: p.symbol,
          secType: p.secType,
          quantity: p.quantity,
          avgCost: p.avgCost,
          expiry: p.expiry,
          strike: p.strike,
          right: p.right
        })),
        optionQuotes,
        quotes
      })
      .then((res) => {
        if (res.error) {
          setError(res.error)
        } else {
          setResult(res)
        }
      })
      .catch((err) => {
        setError(String(err))
      })
      .finally(() => {
        setLoading(false)
      })
  }, [open, account.accountId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="ai-advisor-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>💡 AI 交易建議 — {account.alias || account.accountId}</h2>
          <button className="settings-close-btn" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="ai-advisor-body">
          {loading && (
            <div className="ai-advisor-loading">
              <div className="ai-advisor-spinner" />
              <p>正在分析持倉資料並生成建議...</p>
              <p style={{ fontSize: '0.85em', color: '#888', marginTop: 4 }}>
                AI 正在讀取歷史交易紀錄、帳戶淨值趨勢，結合當前持倉進行分析
              </p>
            </div>
          )}

          {error && (
            <div className="ai-advisor-error">
              <span style={{ fontSize: '1.5em' }}>⚠️</span>
              <p>{error}</p>
            </div>
          )}

          {result && result.recommendations.length > 0 && (
            <div className="ai-advisor-recommendations">
              {buildRenderList(result.recommendations).map((entry, idx) => {
                if (entry.type === 'individual') {
                  const rec = entry.rec
                  return (
                    <div key={idx} className="ai-advisor-rec-card">
                      <div
                        className="ai-advisor-rec-header"
                        style={{ justifyContent: 'flex-start', gap: '8px' }}
                      >
                        <Badges rec={rec} />
                        <span className="ai-advisor-rec-position">{rec.position}</span>
                      </div>
                      {(rec.targetExpiry || !!rec.targetStrike) && (
                        <div className="ai-advisor-rec-target">
                          {rec.targetExpiry && <span>目標到期: {rec.targetExpiry}</span>}
                          {!!rec.targetStrike && <span>目標行權: {rec.targetStrike}</span>}
                          {rec.estimatedCredit && <span>預估: {rec.estimatedCredit}</span>}
                        </div>
                      )}
                      <div className="ai-advisor-rec-reason">{normalizeReason(rec.reason)}</div>
                    </div>
                  )
                }

                // Grouped card — multiple stocks same action
                const { recs } = entry
                return (
                  <div key={`group-${idx}`} className="ai-advisor-rec-card">
                    <div className="ai-advisor-rec-header">
                      <Badges rec={recs[0]} />
                    </div>
                    <ul className="ai-advisor-rec-group-reasons">
                      {recs.map((r, ri) => {
                        const sym = r.position.replace(/股票$/, '').trim()
                        return (
                          <li key={ri}>
                            <strong>{sym}：</strong>
                            {normalizeReason(r.reason)}
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
