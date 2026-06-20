import React from 'react'
import { useState } from 'react'
import {
  RISK_RULES,
  getRuleEnabled,
  setRuleEnabled,
  getRuleThreshold,
  setRuleThreshold
} from '../lib/riskPrefs'

interface RiskAlertsDialogProps {
  open: boolean
  onClose: () => void
}

// 風險提示 — the roll risk-warning thresholds, moved out of 設定 into a dialog
// reachable from the 批次交易 toolbar (mirrors 觀察規則). Reads/writes the same
// riskPrefs store, so the roll dialog still picks up the edited values.
export default function RiskAlertsDialog({
  open,
  onClose
}: RiskAlertsDialogProps): React.JSX.Element | null {
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(RISK_RULES.map((r) => [r.id, getRuleEnabled(r)]))
  )
  const [threshold, setThreshold] = useState<Record<string, string>>(() =>
    Object.fromEntries(RISK_RULES.map((r) => [r.id, String(getRuleThreshold(r))]))
  )

  if (!open) return null

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel risk-alerts-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>風險提示</h2>
          <button className="settings-close-btn" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="settings-body">
          {RISK_RULES.map((r) => (
            <div
              key={r.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                marginBottom: 12,
                padding: '0 8px',
                fontSize: '0.88em',
                color: '#555'
              }}
            >
              <input
                type="checkbox"
                checked={enabled[r.id]}
                onChange={(e) => {
                  setEnabled((p) => ({ ...p, [r.id]: e.target.checked }))
                  setRuleEnabled(r, e.target.checked)
                }}
                style={{ cursor: 'pointer', flexShrink: 0 }}
              />
              <span style={{ whiteSpace: 'nowrap' }}>{r.labelBefore}</span>
              <input
                type="text"
                inputMode="decimal"
                value={threshold[r.id]}
                onChange={(e) => setThreshold((p) => ({ ...p, [r.id]: e.target.value }))}
                onBlur={() => {
                  // Empty / junk reverts to the saved value (a 0 threshold would
                  // fire constantly, so don't coerce empty → 0 here).
                  const v = parseFloat(threshold[r.id])
                  if (Number.isFinite(v) && v >= 0) {
                    setRuleThreshold(r, v)
                    setThreshold((p) => ({ ...p, [r.id]: String(v) }))
                  } else {
                    setThreshold((p) => ({ ...p, [r.id]: String(getRuleThreshold(r)) }))
                  }
                }}
                style={{
                  width: 44,
                  height: 24,
                  boxSizing: 'border-box',
                  padding: '0 4px',
                  border: '1px solid #ccc',
                  borderRadius: 5,
                  fontSize: '0.88em',
                  textAlign: 'center',
                  flexShrink: 0
                }}
              />
              <span style={{ whiteSpace: 'nowrap' }}>{r.labelAfter}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
