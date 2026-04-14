import React, { useEffect } from 'react'
import { useState, useMemo, useCallback } from 'react'
import type { AccountData, PositionData } from '../hooks/useAccountStore'
import type { SymbolGroup } from '../hooks/useTraderSettings'
import CustomSelect from './CustomSelect'

function CustomMultiSelect({
  options,
  selectedValues,
  toggleValue,
  emptyText,
  selectedTextPrefix
}: {
  options: { value: string; label: string }[]
  selectedValues: string[]
  toggleValue: (value: string) => void
  emptyText: string
  selectedTextPrefix: string
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
  onAddGroup: (group: SymbolGroup) => void
  editGroup?: SymbolGroup | null
  onUpdateGroup?: (group: SymbolGroup) => void
}

// Same key format used in AccountOverview
const posKey = (pos: PositionData): string =>
  `${pos.account}|${pos.symbol}|${pos.secType}|${pos.expiry || ''}|${pos.strike || ''}|${pos.right || ''}`

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
  onAddGroup,
  editGroup,
  onUpdateGroup
}: AddGroupDialogProps): React.JSX.Element | null {
  const [groupName, setGroupName] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [filterSymbol, setFilterSymbol] = useState('')
  const [filterRight, setFilterRight] = useState('')

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
        } else {
          setIsAutoMode(false)
          setSelected(new Set(editGroup.posKeys))
          setAutoSymbols([])
          setAutoAccounts([])
          setAutoRights([])
        }
      } else {
        setGroupName('')
        setSelected(new Set())
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
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const toggleAll = (): void => {
    if (isAutoMode) return
    const allKeys = displayPositions.map((p) => posKey(p))
    setSelected((prev) => {
      const allSelected = allKeys.every((k) => prev.has(k))
      if (allSelected) {
        const next = new Set(prev)
        allKeys.forEach((k) => next.delete(k))
        return next
      } else {
        return new Set([...prev, ...allKeys])
      }
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

    const newGroup: SymbolGroup = {
      id: editGroup ? editGroup.id : crypto.randomUUID(),
      name: groupName.trim(),
      symbol,
      posKeys: isAutoMode ? [] : selectedPositions.map((p) => posKey(p)),
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
          <h2>{isEditMode ? '編輯交易群組' : '新增交易群組'}</h2>
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
            <label
              style={{
                fontSize: '13px',
                fontWeight: 600,
                color: '#555',
                display: 'block',
                marginBottom: '6px'
              }}
            >
              群組名稱
            </label>
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
                  />
                </div>
              </div>

              <div>
                <label style={{ fontSize: '13px', fontWeight: 600, color: '#555', display: 'block', marginBottom: '6px' }}>
                  期權類型
                </label>
                <div style={{ zIndex: 10, position: 'relative' }}>
                  <CustomMultiSelect
                    options={[
                      { value: 'C', label: 'CALL 期權' },
                      { value: 'P', label: 'PUT 期權' }
                    ]}
                    selectedValues={autoRights}
                    toggleValue={toggleAutoRight}
                    emptyText="未選擇類型"
                    selectedTextPrefix="已選"
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
                justifyContent: 'flex-end'
              }}
            >
              <label
                style={{ fontSize: '13px', fontWeight: 600, color: '#555', marginRight: 'auto' }}
              >
                群組標的
              </label>
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
              <div style={{ zIndex: 20, position: 'relative' }}>
                <CustomSelect
                  value={filterSymbol}
                  onChange={(v) => setFilterSymbol(v)}
                  options={[
                    { value: '', label: '全部標的' },
                    ...uniqueSymbols.map((s) => ({ value: s, label: s }))
                  ]}
                />
              </div>
              <div style={{ zIndex: 10, position: 'relative' }}>
                <CustomSelect
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
                    padding: '8px 12px',
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
                  </span>
                  <span
                    style={{
                      fontSize: '12px',
                      color: '#333',
                      minWidth: '40px',
                      textAlign: 'right'
                    }}
                  >
                    {pos.quantity.toLocaleString()}
                  </span>
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
