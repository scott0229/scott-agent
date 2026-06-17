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
  setObservePoints
} from '../lib/observeRules'
import type { DteOp, ObserveRuleDef } from '../lib/observeRules'

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

  // One editable row for an observe rule — shared by every section.
  const renderObserveRow = (r: ObserveRuleDef): React.JSX.Element => {
    const numStyle: React.CSSProperties = {
      width: 40,
      padding: '2px 4px',
      border: '1px solid #ccc',
      borderRadius: 5,
      fontSize: '0.88em',
      textAlign: 'center',
      flexShrink: 0
    }
    return (
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
          checked={obsEnabled[r.id]}
          onChange={(e) => {
            setObsEnabled((p) => ({ ...p, [r.id]: e.target.checked }))
            setObserveEnabled(r, e.target.checked)
          }}
          style={{ cursor: 'pointer', flexShrink: 0 }}
        />
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
          type="number"
          step={1}
          value={obsDays[r.id]}
          onChange={(e) => setObsDays((p) => ({ ...p, [r.id]: e.target.value }))}
          onBlur={() => {
            const v = parseInt(obsDays[r.id], 10)
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
          type="number"
          step={1}
          value={obsPoints[r.id]}
          onChange={(e) => setObsPoints((p) => ({ ...p, [r.id]: e.target.value }))}
          onBlur={() => {
            const v = parseInt(obsPoints[r.id], 10)
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
      </div>
    )
  }

  if (!open) return null

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>觀察規則</h2>
          <button className="settings-close-btn" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="settings-body">
          <SectionHeader
            title={`QQQ 預設觀察規則 (領先 > ${LEAD_HIGH_PCT}%)`}
            expanded={showObserve}
            onToggle={() => setShowObserve((v) => !v)}
          />
          {showObserve && OBSERVE_RULES.map(renderObserveRow)}

          <SectionHeader
            title={`QQQ 預設觀察規則 (領先 ${LEAD_LOW_PCT}%~${LEAD_HIGH_PCT}%)`}
            expanded={showObserveMid}
            onToggle={() => setShowObserveMid((v) => !v)}
          />
          {showObserveMid && OBSERVE_RULES_MID.map(renderObserveRow)}

          <SectionHeader
            title={`QQQ 預設觀察規則 (領先 < ${LEAD_LOW_PCT}%)`}
            expanded={showObserveNear}
            onToggle={() => setShowObserveNear((v) => !v)}
          />
          {showObserveNear && OBSERVE_RULES_NEAR.map(renderObserveRow)}

          <SectionHeader
            title={`QQQ 預設觀察規則 (落後 < ${BREACH_THRESHOLD_PCT}%)`}
            expanded={showObserveBreached}
            onToggle={() => setShowObserveBreached((v) => !v)}
          />
          {showObserveBreached && OBSERVE_RULES_BREACHED.map(renderObserveRow)}

          <SectionHeader
            title={`QQQ 預設觀察規則 (落後 > ${BREACH_THRESHOLD_PCT}%)`}
            expanded={showObserveBreachedFar}
            onToggle={() => setShowObserveBreachedFar((v) => !v)}
          />
          {showObserveBreachedFar && OBSERVE_RULES_BREACHED_FAR.map(renderObserveRow)}
        </div>
      </div>
    </div>
  )
}
