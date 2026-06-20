import React from 'react'
import { useState } from 'react'
import {
  OBSERVE_RULES,
  OBSERVE_RULES_MID,
  OBSERVE_RULES_NEAR,
  OBSERVE_RULES_BREACHED,
  OBSERVE_RULES_BREACHED_FAR,
  LEAD_HIGH_PCT,
  LEAD_LOW_PCT,
  BREACH_THRESHOLD_PCT,
  getObserveEnabled,
  setObserveEnabled,
  getObserveDteOp,
  setObserveDteOp,
  getObserveDte,
  setObserveDte,
  getObserveDays,
  setObserveDays,
  getObservePoints,
  setObservePoints,
  getObserveDteMode,
  setObserveDteMode,
  getObserveProfitMode,
  setObserveProfitMode
} from '../lib/observeRules'
import type { DteOp, DteMode, ProfitMode, ObserveRuleDef } from '../lib/observeRules'
import CustomSelect from './CustomSelect'

function SectionHeader({
  title,
  expanded,
  onToggle
}: {
  title: string
  expanded: boolean
  onToggle: () => void
}): React.JSX.Element {
  return (
    <div
      style={{
        userSelect: 'none',
        marginTop: 0,
        marginBottom: 8,
        display: 'flex',
        alignItems: 'center',
        gap: 6
      }}
    >
      <span
        onClick={onToggle}
        style={{
          display: 'inline-block',
          fontSize: '0.75em',
          color: '#888',
          cursor: 'pointer',
          padding: '2px 4px',
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

// Per-section explanatory text is hidden for now (set true to show again).
const SHOW_OBSERVE_DESC: boolean = false

const ALL_OBSERVE_RULES = [
  ...OBSERVE_RULES,
  ...OBSERVE_RULES_MID,
  ...OBSERVE_RULES_NEAR,
  ...OBSERVE_RULES_BREACHED,
  ...OBSERVE_RULES_BREACHED_FAR
]

interface ObserveRulesDialogProps {
  open: boolean
  onClose: () => void
}

// 觀察規則 — the default roll-observation rules, moved out of 設定 into a dialog
// reachable from the 批次交易 toolbar. Reads/writes the same observeRules store.
export default function ObserveRulesDialog({
  open,
  onClose
}: ObserveRulesDialogProps): React.JSX.Element | null {
  const [showObserve, setShowObserve] = useState(true)
  const [showObserveNear, setShowObserveNear] = useState(true)
  const [showObserveMid, setShowObserveMid] = useState(true)
  const [showObserveBreached, setShowObserveBreached] = useState(true)
  const [showObserveBreachedFar, setShowObserveBreachedFar] = useState(true)
  const [obsEnabled, setObsEnabled] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(ALL_OBSERVE_RULES.map((r) => [r.id, getObserveEnabled(r)]))
  )
  // One free-text field per rule holding the DTE condition, e.g. ">2" / "<2".
  const [obsDteText, setObsDteText] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      ALL_OBSERVE_RULES.map((r) => [r.id, `${getObserveDteOp(r)}${getObserveDte(r)}`])
    )
  )
  const [obsDays, setObsDays] = useState<Record<string, string>>(() =>
    Object.fromEntries(ALL_OBSERVE_RULES.map((r) => [r.id, String(getObserveDays(r))]))
  )
  const [obsPoints, setObsPoints] = useState<Record<string, string>>(() =>
    Object.fromEntries(ALL_OBSERVE_RULES.map((r) => [r.id, String(getObservePoints(r))]))
  )
  // Per-rule DTE 高/低/無關 selector — every rule has one.
  const [obsDteMode, setObsDteMode] = useState<Record<string, DteMode>>(() =>
    Object.fromEntries(ALL_OBSERVE_RULES.map((r) => [r.id, getObserveDteMode(r)]))
  )
  // Per-rule 收益 無關/正 selector — only 領先 > 2% rules (showProfitMode) use it.
  const [obsProfitMode, setObsProfitMode] = useState<Record<string, ProfitMode>>(() =>
    Object.fromEntries(ALL_OBSERVE_RULES.map((r) => [r.id, getObserveProfitMode(r)]))
  )

  // One editable row for an observe rule — shared by every section.
  const renderObserveRow = (r: ObserveRuleDef): React.JSX.Element => {
    const numStyle: React.CSSProperties = {
      width: 30,
      height: 24,
      boxSizing: 'border-box',
      padding: '0 4px',
      border: '1px solid #ccc',
      borderRadius: 5,
      fontSize: '0.88em',
      textAlign: 'center',
      flexShrink: 0,
      margin: '0 5px'
    }
    return (
      <div
        key={r.id}
        style={{
          display: 'flex',
          alignItems: 'center',
          // No flex gap — spacing comes from the boxes' own margins so the 「，」
          // separators sit tight against the boxes/labels (like normal text).
          gap: 0,
          marginBottom: 12,
          padding: '0 8px',
          fontSize: '0.88em',
          color: '#555'
        }}
      >
        <input
          type="checkbox"
          checked={obsEnabled[r.id]}
          onChange={(e) => {
            setObsEnabled((p) => ({ ...p, [r.id]: e.target.checked }))
            setObserveEnabled(r, e.target.checked)
          }}
          style={{ cursor: 'pointer', flexShrink: 0, marginRight: 6 }}
        />
        <span style={{ whiteSpace: 'nowrap' }}>DTE</span>
        <CustomSelect
          className="dte-mode-select"
          value={obsDteMode[r.id]}
          onChange={(v) => {
            const m = v as DteMode
            setObsDteMode((p) => ({ ...p, [r.id]: m }))
            setObserveDteMode(r, m)
          }}
          options={[
            { value: 'any', label: '無關' },
            { value: 'high', label: '≥ 3' },
            { value: 'eq23', label: '2, 3' },
            { value: 'eq2', label: '2' },
            { value: 'low', label: '1, 2' },
            { value: 'eq1', label: '1' }
          ]}
        />
        <span style={{ whiteSpace: 'nowrap' }}>，</span>
        {r.hasDte && (
          <>
            <span style={{ whiteSpace: 'nowrap' }}>DTE</span>
            <input
              type="text"
              value={obsDteText[r.id]}
              onChange={(e) => setObsDteText((p) => ({ ...p, [r.id]: e.target.value }))}
              onBlur={() => {
                const m = obsDteText[r.id].trim().match(/^([<>]?)\s*(-?\d+)$/)
                if (m) {
                  const op: DteOp = m[1] === '<' ? '<' : '>'
                  const v = parseInt(m[2], 10)
                  setObserveDteOp(r, op)
                  setObserveDte(r, v)
                  setObsDteText((p) => ({ ...p, [r.id]: `${op}${v}` }))
                } else {
                  setObsDteText((p) => ({
                    ...p,
                    [r.id]: `${getObserveDteOp(r)}${getObserveDte(r)}`
                  }))
                }
              }}
              style={numStyle}
            />
            <span style={{ whiteSpace: 'nowrap' }}>，</span>
          </>
        )}
        <span style={{ whiteSpace: 'nowrap' }}>展</span>
        <input
          type="text"
          inputMode="numeric"
          value={obsDays[r.id]}
          onChange={(e) => setObsDays((p) => ({ ...p, [r.id]: e.target.value }))}
          onBlur={() => {
            const raw = obsDays[r.id].trim()
            // Empty → 0 so a cleared field sticks instead of snapping back to the
            // old value; non-numeric junk → revert to the saved value.
            const v = raw === '' ? 0 : parseInt(raw, 10)
            if (Number.isFinite(v)) {
              setObserveDays(r, v)
              setObsDays((p) => ({ ...p, [r.id]: String(v) }))
            } else {
              setObsDays((p) => ({ ...p, [r.id]: String(getObserveDays(r)) }))
            }
          }}
          style={numStyle}
        />
        <span style={{ whiteSpace: 'nowrap' }}>天，{r.chase ? '追' : '展'}</span>
        <input
          type="text"
          inputMode="numeric"
          value={obsPoints[r.id]}
          onChange={(e) => setObsPoints((p) => ({ ...p, [r.id]: e.target.value }))}
          onBlur={() => {
            const raw = obsPoints[r.id].trim()
            const v = raw === '' ? 0 : parseInt(raw, 10)
            if (Number.isFinite(v)) {
              setObservePoints(r, v)
              setObsPoints((p) => ({ ...p, [r.id]: String(v) }))
            } else {
              setObsPoints((p) => ({ ...p, [r.id]: String(getObservePoints(r)) }))
            }
          }}
          style={numStyle}
        />
        <span style={{ whiteSpace: 'nowrap' }}>點</span>
        {r.showProfitMode && (
          <>
            <span style={{ whiteSpace: 'nowrap' }}>，收益</span>
            <CustomSelect
              className="dte-mode-select"
              value={obsProfitMode[r.id]}
              onChange={(v) => {
                const m = v as ProfitMode
                setObsProfitMode((p) => ({ ...p, [r.id]: m }))
                setObserveProfitMode(r, m)
              }}
              options={[
                { value: 'any', label: '無關' },
                { value: 'positive', label: '> 0' },
                { value: 'pos01', label: '> 0.1' },
                { value: 'pos03', label: '> 0.3' },
                { value: 'pos05', label: '> 0.5' },
                { value: 'pos07', label: '> 0.7' },
                { value: 'pos1', label: '> 1' }
              ]}
            />
          </>
        )}
      </div>
    )
  }

  if (!open) return null

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel observe-rules-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>觀察規則</h2>
          <button className="settings-close-btn" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="settings-body observe-rules-grid">
          <div className="observe-col">
          <div className="observe-section">
            <SectionHeader
              title={`QQQ 預設觀察規則 (領先 > ${LEAD_HIGH_PCT}%)`}
              expanded={showObserve}
              onToggle={() => setShowObserve((v) => !v)}
            />
            {showObserve && (
              <div
                style={{
                  fontSize: '0.88em',
                  color: '#333',
                  padding: '0 8px',
                  marginBottom: 10,
                  lineHeight: 1.6,
                  display: SHOW_OBSERVE_DESC ? undefined : 'none'
                }}
              >
                大幅領先可以優先考慮降 DTE，
                <br />
                若 DTE 正常就退後幾點放大收益
              </div>
            )}
            {showObserve && OBSERVE_RULES.map(renderObserveRow)}
          </div>

          <div className="observe-section">
            <SectionHeader
              title={`QQQ 預設觀察規則 (領先 ${LEAD_LOW_PCT}%~${LEAD_HIGH_PCT}%)`}
              expanded={showObserveMid}
              onToggle={() => setShowObserveMid((v) => !v)}
            />
            {showObserveMid && (
              <div
                style={{
                  fontSize: '0.88em',
                  color: '#333',
                  padding: '0 8px',
                  marginBottom: 10,
                  lineHeight: 1.6,
                  display: SHOW_OBSERVE_DESC ? undefined : 'none'
                }}
              >
                安全範圍可以考慮降 DTE，
                <br />
                或收益為正時可微幅的追價，
                <br />
                或微幅後退來放大收益
              </div>
            )}
            {showObserveMid && OBSERVE_RULES_MID.map(renderObserveRow)}
          </div>

          </div>

          <div className="observe-col">
          <div className="observe-section">
            <SectionHeader
              title={`QQQ 預設觀察規則 (領先 < ${LEAD_LOW_PCT}%)`}
              expanded={showObserveNear}
              onToggle={() => setShowObserveNear((v) => !v)}
            />
            {showObserveNear && (
              <div
                style={{
                  fontSize: '0.88em',
                  color: '#333',
                  padding: '0 8px',
                  marginBottom: 10,
                  lineHeight: 1.6,
                  display: SHOW_OBSERVE_DESC ? undefined : 'none'
                }}
              >
                領先不夠多不適合再退後點位，
                <br />
                可以同點位展期賺權利金，
                <br />
                也可以微幅的追來保持優勢
              </div>
            )}
            {showObserveNear && OBSERVE_RULES_NEAR.map(renderObserveRow)}
          </div>
          <div className="observe-section">
            <SectionHeader
              title={`QQQ 預設觀察規則 (落後 < ${BREACH_THRESHOLD_PCT}%)`}
              expanded={showObserveBreached}
              onToggle={() => setShowObserveBreached((v) => !v)}
            />
            {showObserveBreached && (
              <div
                style={{
                  fontSize: '0.88em',
                  color: '#333',
                  padding: '0 8px',
                  marginBottom: 10,
                  lineHeight: 1.6,
                  display: SHOW_OBSERVE_DESC ? undefined : 'none'
                }}
              >
                有落後就要追，追點數、或者追天數。
              </div>
            )}
            {showObserveBreached && OBSERVE_RULES_BREACHED.map(renderObserveRow)}
          </div>

          <div className="observe-section">
            <SectionHeader
              title={`QQQ 預設觀察規則 (落後 > ${BREACH_THRESHOLD_PCT}%)`}
              expanded={showObserveBreachedFar}
              onToggle={() => setShowObserveBreachedFar((v) => !v)}
            />
            {showObserveBreachedFar && (
              <div
                style={{
                  fontSize: '0.88em',
                  color: '#333',
                  padding: '0 8px',
                  marginBottom: 10,
                  lineHeight: 1.6,
                  display: SHOW_OBSERVE_DESC ? undefined : 'none'
                }}
              >
                落後太多故虧損提價難以避免，
                <br />
                如果 DTE 過高可以暫停不操作，
                <br />
                最多用兩天來換提價
              </div>
            )}
            {showObserveBreachedFar && OBSERVE_RULES_BREACHED_FAR.map(renderObserveRow)}
          </div>
          </div>
        </div>
      </div>
    </div>
  )
}
