import React, { useEffect } from 'react'
import { useState, useMemo, useCallback } from 'react'
import type { AccountData, PositionData } from '../hooks/useAccountStore'
import type { SymbolGroup } from '../hooks/useTraderSettings'
import CustomSelect from './CustomSelect'

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
        const months = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
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

    const isEditMode = !!editGroup

    // Initialize state when dialog opens in edit mode
    useEffect(() => {
        if (open && editGroup) {
            setGroupName(editGroup.name)
            setSelected(new Set(editGroup.posKeys))
        }
    }, [open, editGroup])

    // Get unique underlying symbols
    const uniqueSymbols = useMemo(() => {
        const syms = new Set<string>()
        positions.forEach((p) => syms.add(p.symbol))
        return Array.from(syms).sort()
    }, [positions])

    // Filter positions by symbol and type
    const displayPositions = useMemo(() => {
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
        return filtered
    }, [positions, filterSymbol, filterRight])

    const getAlias = useCallback(
        (accountId: string) => {
            const acct = accounts.find((a) => a.accountId === accountId)
            return acct?.alias || accountId
        },
        [accounts]
    )

    const togglePos = (key: string): void => {
        setSelected((prev) => {
            const next = new Set(prev)
            if (next.has(key)) next.delete(key)
            else next.add(key)
            return next
        })
    }

    const toggleAll = (): void => {
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

    const handleConfirm = (): void => {
        if (!groupName.trim() || selected.size === 0) return
        const selectedPositions = positions.filter((p) => selected.has(posKey(p)))
        const symbol = selectedPositions[0]?.symbol || ''

        if (isEditMode && editGroup && onUpdateGroup) {
            const updated: SymbolGroup = {
                ...editGroup,
                name: groupName.trim(),
                symbol,
                posKeys: selectedPositions.map((p) => posKey(p))
            }
            onUpdateGroup(updated)
        } else {
            const group: SymbolGroup = {
                id: crypto.randomUUID(),
                name: groupName.trim(),
                symbol,
                posKeys: selectedPositions.map((p) => posKey(p)),
                createdAt: Date.now()
            }
            onAddGroup(group)
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
                style={{ maxWidth: '680px', height: '80vh' }}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="stock-order-dialog-header">
                    <h2>{isEditMode ? '編輯交易群組' : '新增交易群組'}</h2>
                    <button className="settings-close-btn" onClick={handleClose}>
                        ✕
                    </button>
                </div>
                <div className="stock-order-dialog-body" style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
                    {/* Group Name */}
                    <div style={{ marginBottom: '16px' }}>
                        <label style={{ fontSize: '13px', fontWeight: 600, color: '#555', display: 'block', marginBottom: '6px' }}>
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
                                if (e.key === 'Enter') handleConfirm()
                            }}
                        />
                    </div>

                    {/* Filter by symbol */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', justifyContent: 'flex-end' }}>
                        <label style={{ fontSize: '13px', fontWeight: 600, color: '#555', marginRight: 'auto' }}>群組標的</label>
                        <button
                            onClick={() => { setFilterSymbol(''); setFilterRight('') }}
                            title="重置篩選"
                            style={{
                                background: '#fff',
                                border: '1px solid #ccc',
                                borderRadius: '6px',
                                cursor: 'pointer',
                                fontSize: '16px',
                                color: (filterSymbol || filterRight) ? '#2563eb' : '#666',
                                padding: '6px',
                                display: 'flex',
                                alignItems: 'center',
                                height: '36px',
                                boxSizing: 'border-box'
                            }}
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M12.531 3H3a1 1 0 0 0-.742 1.67l7.225 7.989A2 2 0 0 1 10 14v6a1 1 0 0 0 .553.895l2 1A1 1 0 0 0 14 21v-7a2 2 0 0 1 .517-1.341l.427-.473" />
                                <path d="m16.5 3.5 5 5" />
                                <path d="m21.5 3.5-5 5" />
                            </svg>
                        </button>
                        <CustomSelect
                            value={filterSymbol}
                            onChange={(v) => {
                                setFilterSymbol(v)
                                setSelected(new Set())
                            }}
                            options={[
                                { value: '', label: '全部標的' },
                                ...uniqueSymbols.map((s) => ({ value: s, label: s }))
                            ]}
                        />
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
                        <button
                            className="select-toggle-btn"
                            style={{ fontSize: '13px', padding: '4px 12px', height: '36px', boxSizing: 'border-box' }}
                            onClick={toggleAll}
                        >
                            全選 / 取消
                        </button>

                    </div>

                    {/* Positions List */}
                    <div style={{ flex: 1, overflowY: 'auto', border: '1px solid #e0dbd4', borderRadius: '6px' }}>
                        {displayPositions.map((pos) => {
                            const key = posKey(pos)
                            const isSelected = selected.has(key)
                            return (
                                <div
                                    key={key}
                                    onClick={() => togglePos(key)}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '10px',
                                        padding: '8px 12px',
                                        cursor: 'pointer',
                                        borderBottom: '1px solid #f0ede8',
                                        background: isSelected ? '#eef2ff' : 'transparent',
                                        transition: 'background 0.15s'
                                    }}
                                >
                                    <input
                                        type="checkbox"
                                        checked={isSelected}
                                        readOnly
                                        style={{ width: '14px', height: '14px', accentColor: '#2563eb' }}
                                    />
                                    <span style={{ fontSize: '12px', color: '#888', minWidth: '80px' }}>
                                        {getAlias(pos.account)}
                                    </span>
                                    <span style={{ fontSize: '13px', fontWeight: 600, flex: 1 }}>
                                        {formatOptionLabel(pos)}
                                    </span>
                                    <span
                                        style={{
                                            fontSize: '13px',
                                            fontWeight: 600,
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
                            <div style={{ padding: '24px', textAlign: 'center', fontSize: '13px', color: '#999' }}>
                                無持倉資料
                            </div>
                        )}
                    </div>

                    {/* Actions */}
                    <div className="confirm-buttons" style={{ marginTop: 'auto', paddingTop: '16px' }}>
                        <button
                            className="btn btn-primary"
                            disabled={!groupName.trim() || selected.size === 0}
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
