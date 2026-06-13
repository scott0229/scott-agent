import React from 'react'
import { useState, useEffect } from 'react'
import type { AccountData } from '../hooks/useAccountStore'
import {
  RISK_RULES,
  getRuleEnabled,
  setRuleEnabled,
  getRuleThreshold,
  setRuleThreshold
} from '../lib/riskPrefs'

const LABELS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']

interface SettingsPanelProps {
  open: boolean
  onClose: () => void
  accounts: AccountData[]
  hiddenAccounts: Set<string>
  onToggleAccount: (accountId: string) => void
  marginLimit: number
  onSetMarginLimit: (limit: number) => void
  watchSymbols: string[]
  onSetWatchSymbol: (index: number, value: string) => void
  symbolPrefetch: Record<string, boolean>
  onSetSymbolPrefetch: (symbol: string, enabled: boolean) => void
  showOperationMode: boolean
  onSetShowOperationMode: (v: boolean) => void
  showAccountType: boolean
  onSetShowAccountType: (v: boolean) => void
}

function SectionHeader({
  title,
  expanded,
  onToggle
}: {
  title: string
  expanded: boolean
  onToggle: () => void
}) {
  return (
    <div
      onClick={onToggle}
      style={{
        cursor: 'pointer',
        userSelect: 'none',
        marginTop: 16,
        marginBottom: 8,
        display: 'flex',
        alignItems: 'center',
        gap: 6
      }}
    >
      <span
        style={{
          display: 'inline-block',
          fontSize: '0.75em',
          color: '#888',
          transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
          transition: 'transform 0.15s ease'
        }}
      >
        ▶
      </span>
      <h3 className="settings-section-title" style={{ margin: 0 }}>
        {title}
      </h3>
    </div>
  )
}

export default function SettingsPanel({
  open,
  onClose,
  accounts,
  hiddenAccounts,
  onToggleAccount,
  marginLimit,
  onSetMarginLimit,
  watchSymbols,
  onSetWatchSymbol,
  symbolPrefetch,
  onSetSymbolPrefetch,
  showOperationMode,
  onSetShowOperationMode,
  showAccountType,
  onSetShowAccountType
}: SettingsPanelProps): React.JSX.Element | null {
  const [limitInput, setLimitInput] = useState(String(marginLimit))
  useEffect(() => {
    setLimitInput(String(marginLimit))
  }, [marginLimit])
  const [showRisk, setShowRisk] = useState(true)
  const [showRiskAlerts, setShowRiskAlerts] = useState(true)
  // Risk-rule toggle + threshold state, keyed by rule id. Threshold is kept as
  // a string while editing; committed to localStorage on blur.
  const [riskEnabled, setRiskEnabled] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(RISK_RULES.map((r) => [r.id, getRuleEnabled(r)]))
  )
  const [riskThreshold, setRiskThreshold] = useState<Record<string, string>>(() =>
    Object.fromEntries(RISK_RULES.map((r) => [r.id, String(getRuleThreshold(r))]))
  )
  const [showSymbols, setShowSymbols] = useState(true)
  const [showAccounts, setShowAccounts] = useState(true)

  if (!open) return null

  const sorted = [...accounts].sort((a, b) => (b.netLiquidation || 0) - (a.netLiquidation || 0))

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>設定</h2>
          <button className="settings-close-btn" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="settings-body">
          <SectionHeader
            title="風險參數"
            expanded={showRisk}
            onToggle={() => setShowRisk((v) => !v)}
          />
          {showRisk && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 12,
                padding: '0 8px'
              }}
            >
              <label style={{ fontSize: '0.88em', color: '#555', whiteSpace: 'nowrap' }}>
                潛在融資上限
              </label>
              <input
                type="number"
                step="0.01"
                min="1"
                max="5"
                value={limitInput}
                onChange={(e) => setLimitInput(e.target.value)}
                onBlur={() => {
                  const v = parseFloat(limitInput)
                  if (!isNaN(v) && v > 0) {
                    onSetMarginLimit(v)
                  } else {
                    setLimitInput(String(marginLimit))
                  }
                }}
                style={{
                  width: 100,
                  padding: '4px 8px',
                  border: '1px solid #ccc',
                  borderRadius: 6,
                  fontSize: '0.88em',
                  textAlign: 'center'
                }}
              />
            </div>
          )}

          <SectionHeader
            title="風險提示"
            expanded={showRiskAlerts}
            onToggle={() => setShowRiskAlerts((v) => !v)}
          />
          {showRiskAlerts &&
            RISK_RULES.map((r) => (
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
                  checked={riskEnabled[r.id]}
                  onChange={(e) => {
                    setRiskEnabled((p) => ({ ...p, [r.id]: e.target.checked }))
                    setRuleEnabled(r, e.target.checked)
                  }}
                  style={{ cursor: 'pointer', flexShrink: 0 }}
                />
                <span style={{ whiteSpace: 'nowrap' }}>{r.labelBefore}</span>
                <input
                  type="number"
                  step={r.step}
                  min={0}
                  value={riskThreshold[r.id]}
                  onChange={(e) =>
                    setRiskThreshold((p) => ({ ...p, [r.id]: e.target.value }))
                  }
                  onBlur={() => {
                    const v = parseFloat(riskThreshold[r.id])
                    if (Number.isFinite(v) && v >= 0) {
                      setRuleThreshold(r, v)
                      setRiskThreshold((p) => ({ ...p, [r.id]: String(v) }))
                    } else {
                      setRiskThreshold((p) => ({ ...p, [r.id]: String(getRuleThreshold(r)) }))
                    }
                  }}
                  style={{
                    width: 52,
                    padding: '2px 4px',
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

          <SectionHeader
            title="可交易標的"
            expanded={showSymbols}
            onToggle={() => setShowSymbols((v) => !v)}
          />
          {showSymbols &&
            LABELS.map((label, i) => {
              const sym = watchSymbols[i] || ''
              return (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    marginBottom: 10,
                    padding: '0 8px',
                    gap: 10
                  }}
                >
                  <label style={{ fontSize: '0.88em', color: '#555', minWidth: 50 }}>
                    標的{label}
                  </label>
                  <input
                    type="text"
                    value={sym}
                    onChange={(e) => onSetWatchSymbol(i, e.target.value.toUpperCase())}
                    placeholder=""
                    style={{
                      width: 80,
                      padding: '4px 8px',
                      border: '1px solid #ccc',
                      borderRadius: 6,
                      fontSize: '0.88em',
                      textAlign: 'center',
                      textTransform: 'uppercase',
                      marginLeft: 'auto'
                    }}
                  />
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 3,
                      fontSize: '0.83em',
                      color: sym ? '#555' : '#bbb',
                      cursor: sym ? 'pointer' : 'default',
                      userSelect: 'none'
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={sym ? symbolPrefetch[sym] !== false : false}
                      disabled={!sym}
                      onChange={(e) => sym && onSetSymbolPrefetch(sym, e.target.checked)}
                    />
                    預載
                  </label>
                </div>
              )
            })}

          <SectionHeader
            title="帳戶顯示"
            expanded={showAccounts}
            onToggle={() => setShowAccounts((v) => !v)}
          />
          {showAccounts && (
            <div className="settings-account-list">
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, borderBottom: '1px solid #eee', paddingBottom: 12, marginBottom: 12 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.88em', color: '#555', cursor: 'pointer' }}>
                  <input type="checkbox" checked={showOperationMode} onChange={e => onSetShowOperationMode(e.target.checked)} />
                  顯示交易重點
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.88em', color: '#555', cursor: 'pointer' }}>
                  <input type="checkbox" checked={showAccountType} onChange={e => onSetShowAccountType(e.target.checked)} />
                  顯示帳戶類型
                </label>
              </div>
              {sorted.map((acct) => {
                const isHidden = hiddenAccounts.has(acct.accountId)
                return (
                  <label key={acct.accountId} className="settings-account-row">
                    <span className="settings-account-name">{acct.alias || acct.accountId}</span>
                    <input
                      type="checkbox"
                      checked={!isHidden}
                      onChange={() => onToggleAccount(acct.accountId)}
                    />
                  </label>
                )
              })}
            </div>
          )}

        </div>
        <div
          style={{
            padding: '12px 20px',
            borderTop: '1px solid var(--border-color)',
            textAlign: 'center',
            fontSize: 15,
            color: '#aaa'
          }}
        >
          version {import.meta.env.VITE_APP_VERSION || '—'}
        </div>
      </div>
    </div>
  )
}
