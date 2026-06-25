import React, { useEffect } from 'react'
import { useState, useMemo, useCallback } from 'react'
import type { AccountData, PositionData } from '../hooks/useAccountStore'
import type { SymbolGroup } from '../hooks/useTraderSettings'
import {
  posKey,
  legKey,
  legContractKey,
  posKeysFromLegs,
  legFromKeyAndPos,
  type GroupLeg
} from '../lib/groupLegs'
import CustomSelect from './CustomSelect'

function CustomMultiSelect({
  options,
  selectedValues,
  toggleValue,
  emptyText,
  selectedTextPrefix,
  onSelectAll
}: {
  options: { value: string; label: string }[]
  selectedValues: string[]
  toggleValue: (value: string) => void
  emptyText: string
  selectedTextPrefix: string
  onSelectAll?: (selectAll: boolean) => void
}) {
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const selectedLabels = selectedValues.map(v => options.find(o => o.value === v)?.label).filter(Boolean)
  const selectedText = selectedValues.length === 0 
    ? emptyText 
    : selectedValues.length <= 2
      ? selectedLabels.join('、')
      : `${selectedTextPrefix} ${selectedValues.length} 項`

  return (
    <div className="custom-select" ref={ref}>
      <button type="button" className="custom-select-trigger" onClick={() => setOpen(!open)}>
        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{selectedText}</span>
        <span className="custom-select-arrow">▾</span>
      </button>
      {open && (
        <div className="custom-select-dropdown" style={{ maxHeight: '200px', overflowY: 'auto' }}>
          {onSelectAll && options.length > 0 && (
            <div
              className="custom-select-option"
              style={{ display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid #eee' }}
              onClick={(e) => {
                e.stopPropagation()
                const isAllSelected = selectedValues.length === options.length && options.length > 0
                onSelectAll(!isAllSelected)
              }}
            >
              <input 
                type="checkbox" 
                checked={selectedValues.length === options.length && options.length > 0} 
                readOnly 
                style={{ accentColor: '#2563eb', pointerEvents: 'none', margin: 0 }} 
              />
              <span style={{ flex: 1, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden', fontWeight: 600 }}>
                {selectedValues.length === options.length && options.length > 0 ? '取消全選' : '全選'}
              </span>
            </div>
          )}
          {options.map(o => {
            const isSelected = selectedValues.includes(o.value)
            return (
              <div
                key={o.value}
                className="custom-select-option"
                style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                onClick={(e) => {
                  e.stopPropagation()
                  toggleValue(o.value)
                }}
              >
                <input 
                  type="checkbox" 
                  checked={isSelected} 
                  readOnly 
                  style={{ accentColor: '#2563eb', pointerEvents: 'none', margin: 0 }} 
                />
                <span style={{ flex: 1, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
                  {o.label}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

interface AddGroupDialogProps {
  open: boolean
  onClose: () => void
  positions: PositionData[]
  accounts: AccountData[]
  // posKeys of positions not belonging to any group — shown with a "(未歸類)" tag.
  uncategorizedKeys?: Set<string>
  // Signed qty already claimed by OTHER groups, keyed by legContractKey. Used
  // to default a newly-selected contract's qty to the REMAINING unclaimed
  // amount so a 2nd same-content group splits naturally.
  claimedByOthers?: Map<string, number>
  onAddGroup: (group: SymbolGroup) => void
  editGroup?: SymbolGroup | null
  onUpdateGroup?: (group: SymbolGroup) => void
}

// posKey/legKey/etc. imported from ../lib/groupLegs (shared with AccountOverview).

// Format option description, e.g. "SOFI Sep18'26 25C"
function formatOptionLabel(pos: PositionData): string {
  const parts: string[] = [pos.symbol]
  if (pos.expiry) {
    // expiry is YYYYMMDD → "Sep18'26"
    const y = pos.expiry.slice(0, 4)
    const m = parseInt(pos.expiry.slice(4, 6))
    const d = pos.expiry.slice(6, 8)
    const months = [
      '',
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
    parts.push(`${months[m]}${d}'${y.slice(2)}`)
  }
  if (pos.strike) parts.push(String(pos.strike))
  if (pos.right) parts.push(pos.right === 'C' || pos.right === 'CALL' ? 'C' : 'P')
  return parts.join(' ')
}

export default function AddGroupDialog({
  open,
  onClose,
  positions,
  accounts,
  uncategorizedKeys,
  claimedByOthers,
  onAddGroup,
  editGroup,
  onUpdateGroup
}: AddGroupDialogProps): React.JSX.Element | null {
  const [groupName, setGroupName] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  // posKey -> signed claimed qty for this group's manual legs.
  const [legQty, setLegQty] = useState<Map<string, number>>(new Map())
  const [filterSymbol, setFilterSymbol] = useState('')
  const [filterRight, setFilterRight] = useState('')

  // Default claimed qty for a contract = its remaining unclaimed amount
  // (position qty minus what other groups already claim). Falls back to the
  // full position qty when nothing remains, so an explicit selection is never
  // silently empty. Always same sign as the position.
  const defaultQtyFor = (pos: PositionData): number => {
    const others = claimedByOthers?.get(legContractKey(pos)) || 0
    const remaining = pos.quantity - others
    if (remaining !== 0 && Math.sign(remaining) === Math.sign(pos.quantity)) return remaining
    return pos.quantity
  }

  // Auto Mode States
  const [isAutoMode, setIsAutoMode] = useState(true)
  const [autoSymbols, setAutoSymbols] = useState<string[]>([])
  const [autoAccounts, setAutoAccounts] = useState<string[]>([])
  const [autoRights, setAutoRights] = useState<string[]>([])

  const isEditMode = !!editGroup

  // Initialize state when dialog opens (or when editGroup changes)
  const prevOpenRef = React.useRef(false)
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      if (editGroup) {
        setGroupName(editGroup.name)
        if (editGroup.autoParams) {
          setIsAutoMode(true)
          setAutoSymbols(editGroup.autoParams.symbols || [])
          setAutoAccounts(editGroup.autoParams.accounts || [])
          setAutoRights(editGroup.autoParams.rights || (editGroup.autoParams.right ? [editGroup.autoParams.right] : []))
          setSelected(new Set())
          setLegQty(new Map())
        } else {
          setIsAutoMode(false)
          const qty = new Map<string, number>()
          if (editGroup.legs && editGroup.legs.length) {
            // Preferred: per-leg claimed quantities.
            editGroup.legs.forEach((l) => {
              if (l.quantity !== 0) qty.set(legKey(l), l.quantity)
            })
          } else {
            // Legacy fallback: posKeys at full matching position qty.
            editGroup.posKeys.forEach((k) => {
              const match = positions.find((p) => posKey(p) === k)
              qty.set(k, match ? match.quantity : 0)
            })
          }
          setSelected(new Set(qty.keys()))
          setLegQty(qty)
          setAutoSymbols([])
          setAutoAccounts([])
          setAutoRights([])
        }
      } else {
        setGroupName('')
        setSelected(new Set())
        setLegQty(new Map())
        setIsAutoMode(true)
        setAutoSymbols([])
        setAutoAccounts([])
        setAutoRights([])
      }
    }
    prevOpenRef.current = open
  }, [open, editGroup])

  // Get unique underlying symbols
  const uniqueSymbols = useMemo(() => {
    const syms = new Set<string>()
    positions.forEach((p) => syms.add(p.symbol))
    return Array.from(syms).sort()
  }, [positions])

  // Get unique underlying accounts
  const uniqueAccounts = useMemo(() => {
    return accounts.slice().sort((a, b) => (a.alias || a.accountId).localeCompare(b.alias || b.accountId))
  }, [accounts])

  // Filter positions by symbol and type for manual mode
  const displayPositions = useMemo(() => {
    if (isAutoMode) {
      return positions.filter((p) => {
        const symbolMatch = autoSymbols.includes(p.symbol)
        if (!symbolMatch) return false
        const rightMatch =
          p.secType === 'STK' ||
          (autoRights.includes('C') && p.secType === 'OPT' && (p.right === 'C' || p.right === 'CALL')) ||
          (autoRights.includes('P') && p.secType === 'OPT' && (p.right === 'P' || p.right === 'PUT'))
        if (!rightMatch) return false
        const accountMatch = autoAccounts.includes(p.account)
        return accountMatch
      }).sort((a, b) => {
        const aliasA = accounts.find((acc) => acc.accountId === a.account)?.alias || a.account
        const aliasB = accounts.find((acc) => acc.accountId === b.account)?.alias || b.account
        const cmp = aliasA.localeCompare(aliasB)
        if (cmp !== 0) return cmp
        if (a.secType === 'STK' && b.secType !== 'STK') return -1
        if (a.secType !== 'STK' && b.secType === 'STK') return 1
        return 0
      })
    }

    let filtered = positions
    if (filterSymbol) filtered = filtered.filter((p) => p.symbol === filterSymbol)
    if (filterRight) {
      filtered = filtered.filter((p) => {
        if (filterRight === 'STK') return p.secType === 'STK'
        if (filterRight === 'C') {
          const r = p.right?.toUpperCase()
          return p.secType === 'OPT' && (r === 'C' || r === 'CALL')
        }
        if (filterRight === 'P') {
          const r = p.right?.toUpperCase()
          return p.secType === 'OPT' && (r === 'P' || r === 'PUT')
        }
        return true
      })
    }
    return filtered.sort((a, b) => {
      const aliasA = accounts.find((acc) => acc.accountId === a.account)?.alias || a.account
      const aliasB = accounts.find((acc) => acc.accountId === b.account)?.alias || b.account
      const cmp = aliasA.localeCompare(aliasB)
      if (cmp !== 0) return cmp
      // Stocks before options
      if (a.secType === 'STK' && b.secType !== 'STK') return -1
      if (a.secType !== 'STK' && b.secType === 'STK') return 1
      return 0
    })
  }, [positions, filterSymbol, filterRight, accounts, isAutoMode, autoSymbols, autoAccounts, autoRights])

  const getAlias = useCallback(
    (accountId: string) => {
      const acct = accounts.find((a) => a.accountId === accountId)
      return acct?.alias || accountId
    },
    [accounts]
  )

  const togglePos = (key: string): void => {
    if (isAutoMode) return
    const adding = !selected.has(key)
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
    setLegQty((prev) => {
      const next = new Map(prev)
      if (adding) {
        const pos = positions.find((p) => posKey(p) === key)
        next.set(key, pos ? defaultQtyFor(pos) : 0)
      } else {
        next.delete(key)
      }
      return next
    })
  }

  const toggleAll = (): void => {
    if (isAutoMode) return
    const allKeys = displayPositions.map((p) => posKey(p))
    const allSelected = allKeys.every((k) => selected.has(k))
    setSelected((prev) => {
      if (allSelected) {
        const next = new Set(prev)
        allKeys.forEach((k) => next.delete(k))
        return next
      }
      return new Set([...prev, ...allKeys])
    })
    setLegQty((prev) => {
      const next = new Map(prev)
      if (allSelected) {
        allKeys.forEach((k) => next.delete(k))
      } else {
        for (const p of displayPositions) {
          const k = posKey(p)
          if (!next.has(k)) next.set(k, defaultQtyFor(p))
        }
      }
      return next
    })
  }

  // Set a leg's claimed qty from a user-typed magnitude; clamp magnitude to the
  // live position size and keep the position's sign.
  const setLegMagnitude = (key: string, magnitude: number): void => {
    const pos = positions.find((p) => posKey(p) === key)
    const sign = pos ? Math.sign(pos.quantity) || 1 : 1
    const cap = pos ? Math.abs(pos.quantity) : magnitude
    const mag = Math.max(0, Math.min(cap, Math.abs(magnitude)))
    setLegQty((prev) => {
      const next = new Map(prev)
      next.set(key, sign * mag)
      return next
    })
  }

  const toggleAutoSymbol = (s: string) => {
    setAutoSymbols(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])
  }

  const toggleAutoAccount = (a: string) => {
    setAutoAccounts(prev => prev.includes(a) ? prev.filter(x => x !== a) : [...prev, a])
  }

  const toggleAutoRight = (r: string) => {
    setAutoRights(prev => prev.includes(r) ? prev.filter(x => x !== r) : [...prev, r])
  }

  const handleConfirm = (): void => {
    if (!groupName.trim()) return
    if (!isAutoMode && selected.size === 0) return

    const selectedPositions = isAutoMode ? [] : positions.filter((p) => selected.has(posKey(p)))
    // For manual mode, symbol is extracted from the first position. For auto mode, we can omit it or take the first autoSymbol.
    const symbol = isAutoMode ? (autoSymbols[0] || '') : (selectedPositions[0]?.symbol || '')

    // Build legs from the per-contract claimed quantities (drop any 0).
    const legs: GroupLeg[] = isAutoMode
      ? []
      : Array.from(legQty.entries())
          .filter(([key, qty]) => qty !== 0 && selected.has(key))
          .map(([key, qty]) => legFromKeyAndPos(key, qty, positions))

    const newGroup: SymbolGroup = {
      id: editGroup ? editGroup.id : crypto.randomUUID(),
      name: groupName.trim(),
      symbol,
      legs: isAutoMode ? undefined : legs,
      posKeys: isAutoMode ? [] : posKeysFromLegs(legs),
      createdAt: editGroup ? editGroup.createdAt : Date.now(),
      autoParams: isAutoMode ? {
        symbols: autoSymbols,
        rights: autoRights,
        accounts: autoAccounts
      } : undefined
    }

    if (isEditMode && editGroup && onUpdateGroup) {
      onUpdateGroup(newGroup)
    } else {
      onAddGroup(newGroup)
    }
    handleClose()
  }

  const handleClose = (): void => {
    setGroupName('')
    setSelected(new Set())
    setLegQty(new Map())
    setFilterSymbol('')
    setFilterRight('')
    onClose()
  }

  if (!open) return null

  return (
    <div className="stock-order-dialog-overlay" onClick={handleClose}>
      <div
        className="stock-order-dialog"
        style={{ maxWidth: '500px', height: isAutoMode ? 'auto' : '65vh', maxHeight: '65vh', overflow: isAutoMode ? 'visible' : 'hidden' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="stock-order-dialog-header">
          <h2>{isEditMode ? '編輯批次交易' : '新增批次交易'}</h2>
          <button className="settings-close-btn" onClick={handleClose}>
            ✕
          </button>
        </div>
        <div
          className="stock-order-dialog-body"
          style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: isAutoMode ? 'visible' : 'hidden' }}
        >
          {/* Mode Toggle */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
            <button
              className={`select-toggle-btn ${!isAutoMode ? 'active' : ''}`}
              style={{ flex: 1, padding: '8px', fontSize: '13px', borderRadius: '6px' }}
              onClick={() => setIsAutoMode(false)}
            >
              手動選擇標的
            </button>
            <button
              className={`select-toggle-btn ${isAutoMode ? 'active' : ''}`}
              style={{ flex: 1, padding: '8px', fontSize: '13px', borderRadius: '6px' }}
              onClick={() => setIsAutoMode(true)}
            >
              自動加入標的
            </button>
          </div>

          <div style={{ marginBottom: '16px' }}>
            <input
              type="text"
              className="input-field"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="例如：SOFI LEAPS"
              autoFocus
              style={{ width: '100%' }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  if (document.activeElement === e.currentTarget) handleConfirm()
                }
              }}
            />
          </div>

          {isAutoMode ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '12px' }}>
              <div>
                <label style={{ fontSize: '13px', fontWeight: 600, color: '#555', display: 'block', marginBottom: '6px' }}>
                  限定帳戶
                </label>
                <div style={{ zIndex: 30, position: 'relative' }}>
                  <CustomMultiSelect
                    options={uniqueAccounts.map(a => ({ value: a.accountId, label: a.alias || a.accountId }))}
                    selectedValues={autoAccounts}
                    toggleValue={toggleAutoAccount}
                    emptyText="未選擇帳戶"
                    selectedTextPrefix="已選"
                    onSelectAll={(selectAll) => setAutoAccounts(selectAll ? uniqueAccounts.map(a => a.accountId) : [])}
                  />
                </div>
              </div>

              <div>
                <label style={{ fontSize: '13px', fontWeight: 600, color: '#555', display: 'block', marginBottom: '6px' }}>
                  目標股票
                </label>
                <div style={{ zIndex: 20, position: 'relative' }}>
                  <CustomMultiSelect
                     options={Array.from(new Set([...uniqueSymbols, ...autoSymbols])).sort().map(s => ({ value: s, label: s }))}
                    selectedValues={autoSymbols}
                    toggleValue={toggleAutoSymbol}
                    emptyText="未選擇標的"
                    selectedTextPrefix="已選"
                    onSelectAll={(selectAll) => setAutoSymbols(selectAll ? Array.from(new Set([...uniqueSymbols, ...autoSymbols])) : [])}
                  />
                </div>
              </div>

              <div>
                <label style={{ fontSize: '13px', fontWeight: 600, color: '#555', display: 'block', marginBottom: '6px' }}>
                  資產類型
                </label>
                <div style={{ zIndex: 10, position: 'relative' }}>
                  <CustomMultiSelect
                    options={[
                      { value: 'STK', label: '股票' },
                      { value: 'C', label: 'CALL 期權' },
                      { value: 'P', label: 'PUT 期權' }
                    ]}
                    selectedValues={autoRights}
                    toggleValue={toggleAutoRight}
                    emptyText="未選擇類型"
                    selectedTextPrefix="已選"
                    onSelectAll={(selectAll) => setAutoRights(selectAll ? ['STK', 'C', 'P'] : [])}
                  />
                </div>
              </div>

            </div>
          ) : (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                marginBottom: '12px',
                width: '100%'
              }}
            >
              <button
                onClick={() => {
                  setFilterSymbol('')
                  setFilterRight('')
                }}
                title="重置篩選"
                style={{
                  background: '#fff',
                  border: '1px solid #ccc',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '16px',
                  color: filterSymbol || filterRight ? '#2563eb' : '#666',
                  padding: '6px',
                  display: 'flex',
                  alignItems: 'center',
                  height: '36px',
                  boxSizing: 'border-box'
                }}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12.531 3H3a1 1 0 0 0-.742 1.67l7.225 7.989A2 2 0 0 1 10 14v6a1 1 0 0 0 .553.895l2 1A1 1 0 0 0 14 21v-7a2 2 0 0 1 .517-1.341l.427-.473" />
                  <path d="m16.5 3.5 5 5" />
                  <path d="m21.5 3.5-5 5" />
                </svg>
              </button>
              <div style={{ flex: 1, minWidth: 0, zIndex: 20, position: 'relative' }}>
                <CustomSelect
                  className="fill-width"
                  value={filterSymbol}
                  onChange={(v) => setFilterSymbol(v)}
                  options={[
                    { value: '', label: '全部標的' },
                    ...uniqueSymbols.map((s) => ({ value: s, label: s }))
                  ]}
                />
              </div>
              <div style={{ flex: 1, minWidth: 0, zIndex: 10, position: 'relative' }}>
                <CustomSelect
                  className="fill-width"
                  value={filterRight}
                  onChange={(v) => setFilterRight(v)}
                  options={[
                    { value: '', label: '全部類型' },
                    { value: 'STK', label: '股票' },
                    { value: 'C', label: 'CALL' },
                    { value: 'P', label: 'PUT' }
                  ]}
                />
              </div>
              <button
                className="select-toggle-btn"
                style={{
                  fontSize: '13px',
                  padding: '4px 12px',
                  height: '36px',
                  boxSizing: 'border-box'
                }}
                onClick={toggleAll}
              >
                全選 / 取消
              </button>
            </div>
          )}

          {/* Positions List */}
          {!isAutoMode && (
          <div
            style={{ flex: 1, overflowY: 'auto', border: '1px solid #e0dbd4', borderRadius: '6px' }}
          >
            {displayPositions.map((pos) => {
              const key = posKey(pos)
              const isSelected = isAutoMode ? true : selected.has(key)
              return (
                <div
                  key={key}
                  onClick={() => togglePos(key)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '3px 12px',
                    cursor: isAutoMode ? 'default' : 'pointer',
                    borderBottom: '1px solid #f0ede8',
                    background: isSelected ? '#eef2ff' : 'transparent',
                    transition: 'background 0.15s'
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    readOnly
                    disabled={isAutoMode}
                    style={{ width: '14px', height: '14px', accentColor: '#2563eb' }}
                  />
                  <span style={{ fontSize: '13px', color: '#333', minWidth: '80px' }}>
                    {getAlias(pos.account)}
                  </span>
                  <span style={{ fontSize: '12px', flex: 1 }}>
                    {formatOptionLabel(pos)}
                    {uncategorizedKeys?.has(key) && (
                      <span style={{ color: '#555' }}> (未歸類)</span>
                    )}
                  </span>
                  {isSelected ? (
                    // Per-leg claimed qty (magnitude). Lets two same-content
                    // groups split one IB position. Sign is fixed by the
                    // underlying; magnitude is capped at the position size.
                    <span
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '3px',
                        whiteSpace: 'nowrap'
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="number"
                        min={0}
                        max={Math.abs(pos.quantity)}
                        value={Math.abs(legQty.get(key) ?? pos.quantity)}
                        onChange={(e) => setLegMagnitude(key, parseInt(e.target.value, 10) || 0)}
                        style={{
                          width: '48px',
                          fontSize: '12px',
                          textAlign: 'right',
                          padding: '1px 4px',
                          border: '1px solid #cbd5e1',
                          borderRadius: '4px'
                        }}
                      />
                      <span style={{ fontSize: '12px', color: '#333' }}>
                        / {Math.abs(pos.quantity)}
                        {pos.secType === 'STK' ? '股' : '口'}
                      </span>
                    </span>
                  ) : (
                    <span
                      style={{
                        fontSize: '12px',
                        color: '#333',
                        minWidth: '52px',
                        textAlign: 'right',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {pos.quantity.toLocaleString()}
                      {pos.secType === 'STK' ? '股' : '口'}
                    </span>
                  )}
                </div>
              )
            })}
            {displayPositions.length === 0 && (
              <div
                style={{ padding: '24px', textAlign: 'center', fontSize: '13px', color: '#999' }}
              >
                無持倉資料
              </div>
            )}
          </div>
          )}

          {/* Actions */}
          <div className="confirm-buttons" style={{ marginTop: 'auto', paddingTop: '16px' }}>
            <button
              className="btn btn-primary"
              disabled={!groupName.trim() || (!isAutoMode && selected.size === 0)}
              onClick={handleConfirm}
            >
              {isEditMode ? '儲存變更' : '確認建立'}
            </button>
            <button className="btn btn-secondary" onClick={handleClose}>
              取消
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
