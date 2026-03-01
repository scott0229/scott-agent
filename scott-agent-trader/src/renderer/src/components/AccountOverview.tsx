import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react'
import type { SymbolGroup } from '../hooks/useTraderSettings'
import type {
  AccountData,
  PositionData,
  OpenOrderData,
  ExecutionDataItem
} from '../hooks/useAccountStore'
import CustomSelect from './CustomSelect'
import RollOptionDialog from './RollOptionDialog'
import BatchOrderForm from './BatchOrderForm'
import TransferStockDialog from './TransferStockDialog'
import ClosePositionDialog from './ClosePositionDialog'
import OptionOrderDialog from './OptionOrderDialog'
import CloseOptionDialog from './CloseOptionDialog'
import AddGroupDialog from './AddGroupDialog'
import CloseGroupDialog from './CloseGroupDialog'
import AiAdvisorDialog from './AiAdvisorDialog'

const TRADING_TYPE_OPTIONS = [
  { value: 'reg_t', label: 'Reg T 保證金' },
  { value: 'portfolio_margin', label: '投資組合保證金' },
  { value: 'cash', label: '現金帳戶' }
]

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function formatOptionLabel(
  symbol: string,
  expiry?: string,
  strike?: number,
  right?: string
): string {
  const exp = expiry
    ? (() => {
      const yy = expiry.slice(2, 4)
      const mm = parseInt(expiry.slice(4, 6), 10) - 1
      const dd = expiry.slice(6, 8).replace(/^0/, '')
      return `${MONTHS[mm]}${dd}'${yy}`
    })()
    : ''
  const r = right === 'C' || right === 'CALL' ? 'C' : 'P'
  return `${symbol} ${exp} ${strike || ''}${r}`
}

interface AccountOverviewProps {
  connected: boolean
  accounts: AccountData[]
  positions: PositionData[]
  quotes: Record<string, number>
  optionQuotes: Record<string, number>
  openOrders: OpenOrderData[]
  executions: ExecutionDataItem[]
  loading: boolean
  refresh?: () => void
  accountTypes?: Record<string, string>
  onSetAccountType?: (accountId: string, type: string) => void
  marginLimit?: number
  symbolGroups?: SymbolGroup[]
  onAddSymbolGroup?: (group: SymbolGroup) => void
  onDeleteSymbolGroup?: (groupId: string) => void
  onUpdateSymbolGroup?: (group: SymbolGroup) => void
  groupViewMode?: boolean
}

const posKey = (pos: PositionData): string =>
  `${pos.account}|${pos.symbol}|${pos.secType}|${pos.expiry || ''}|${pos.strike || ''}|${pos.right || ''}`

export default function AccountOverview({
  connected,
  accounts,
  positions,
  quotes,
  optionQuotes,
  openOrders,
  executions,
  loading,
  refresh,
  accountTypes,
  onSetAccountType,
  marginLimit = 1.3,
  symbolGroups = [],
  onAddSymbolGroup,
  onDeleteSymbolGroup,
  onUpdateSymbolGroup,
  groupViewMode = false
}: AccountOverviewProps): React.JSX.Element {
  const [sortBy, setSortBy] = useState('netLiquidation')
  const [filterSymbol, setFilterSymbol] = useState('')

  const [selectMode, setSelectMode] = useState<'STK' | 'OPT' | false>(false)
  const [selectedPositions, setSelectedPositions] = useState<Set<string>>(new Set())
  const [showRollDialog, setShowRollDialog] = useState(false)
  const [showBatchOrder, setShowBatchOrder] = useState(false)
  const [showTransferDialog, setShowTransferDialog] = useState(false)
  const [showCloseDialog, setShowCloseDialog] = useState(false)
  const [showOptionOrder, setShowOptionOrder] = useState(false)
  const [showCloseOptionDialog, setShowCloseOptionDialog] = useState(false)
  const [showCloseGroupDialog, setShowCloseGroupDialog] = useState(false)
  const [showAiAdvisor, setShowAiAdvisor] = useState<string | null>(null)
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null)
  const [showAddGroup, setShowAddGroup] = useState(false)
  const [editingGroup, setEditingGroup] = useState<SymbolGroup | null>(null)
  const [showGroupNameInput, setShowGroupNameInput] = useState(false)
  // Pending roll update: wait for IB to confirm fill before updating group posKeys
  const [pendingRollUpdate, setPendingRollUpdate] = useState<{
    rolledPositions: PositionData[]
    target: { expiry: string; strike: number; right: 'C' | 'P' }
  } | null>(null)
  // Pending transfer update: wait for IB to confirm fill before updating group posKeys
  const [pendingTransferUpdate, setPendingTransferUpdate] = useState<{
    ops: { account: string; sourceSymbol: string; soldShares: number; targetShares: number; originalSourceQty: number; originalTargetQty: number }[]
    targetSymbol: string
  } | null>(null)
  const [groupNameInput, setGroupNameInput] = useState('')
  // Inline editing state: tracks which cell is being edited
  const [editingCell, setEditingCell] = useState<{
    orderId: number
    field: 'quantity' | 'price'
  } | null>(null)
  const [editValue, setEditValue] = useState('')
  const editInputRef = useRef<HTMLInputElement | null>(null)
  // Context menu state for order cancellation
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    order: OpenOrderData
  } | null>(null)

  // Reset all filters and selections on reconnect
  useEffect(() => {
    setFilterSymbol('')
    setSelectMode(false)
    setSelectedPositions(new Set())
    setSelectedAccount(null)
    setShowRollDialog(false)
    setShowBatchOrder(false)
    setShowTransferDialog(false)
    setShowCloseDialog(false)
    setShowOptionOrder(false)
    setShowCloseOptionDialog(false)
  }, [connected])

  // Watch positions: when pending roll's old positions disappear and new ones appear,
  // update group posKeys using the actual new posKey reported by IB
  useEffect(() => {
    if (!pendingRollUpdate) return
    const { rolledPositions, target } = pendingRollUpdate
    // All old positions must be gone AND all new positions must have appeared
    for (const oldPos of rolledPositions) {
      const oldKey = posKey(oldPos)
      if (positions.some((p) => posKey(p) === oldKey)) return // old still present
      const appeared = positions.some(
        (p) =>
          p.account === oldPos.account &&
          p.symbol === oldPos.symbol &&
          p.secType === 'OPT' &&
          p.expiry === target.expiry &&
          p.strike === target.strike &&
          (p.right === target.right || p.right === (target.right === 'C' ? 'CALL' : 'PUT'))
      )
      if (!appeared) return // new not yet arrived
    }
    // All conditions met → update groups with actual new posKeys from IB
    const oldKeys = new Set(rolledPositions.map((p) => posKey(p)))
    for (const g of symbolGroups) {
      if (!g.posKeys.some((k) => oldKeys.has(k))) continue
      const newPosKeys = g.posKeys.map((k) => {
        if (!oldKeys.has(k)) return k
        const oldPos = rolledPositions.find((p) => posKey(p) === k)
        if (!oldPos) return k
        const newPos = positions.find(
          (p) =>
            p.account === oldPos.account &&
            p.symbol === oldPos.symbol &&
            p.secType === 'OPT' &&
            p.expiry === target.expiry &&
            p.strike === target.strike &&
            (p.right === target.right || p.right === (target.right === 'C' ? 'CALL' : 'PUT'))
        )
        return newPos ? posKey(newPos) : k
      })
      const finalPosKeys = Array.from(new Set(newPosKeys))
      // Only update if there's an actual change in the keys
      if (finalPosKeys.length !== g.posKeys.length || finalPosKeys.some((k, i) => k !== g.posKeys[i])) {
        onUpdateSymbolGroup?.({ ...g, posKeys: finalPosKeys })
      }
    }
    setPendingRollUpdate(null)
  }, [positions, pendingRollUpdate, symbolGroups, onUpdateSymbolGroup])

  // Watch positions: when pending transfer changes are confirmed, update group posKeys
  useEffect(() => {
    if (!pendingTransferUpdate) return
    const { ops, targetSymbol } = pendingTransferUpdate

    // 1. Wait for IB positions to reflect the expected quantity changes
    for (const op of ops) {
      const currentSrc = positions.find((p) => p.account === op.account && p.symbol === op.sourceSymbol && p.secType === 'STK')?.quantity ?? 0
      const currentTgt = positions.find((p) => p.account === op.account && p.symbol === targetSymbol && p.secType === 'STK')?.quantity ?? 0

      // Source quantity should decrease by at least soldShares
      if (currentSrc > op.originalSourceQty - op.soldShares) return

      // Target quantity should increase by exactly targetShares
      if (op.targetShares > 0 && currentTgt < op.originalTargetQty + op.targetShares) return
    }

    // 2. Conditions met. Apply group updates.
    // Build vanished keys (where stock went to 0)
    const vanishedKeys = new Set<string>()
    for (const op of ops) {
      const currentSrc = positions.find((p) => p.account === op.account && p.symbol === op.sourceSymbol && p.secType === 'STK')?.quantity ?? 0
      if (currentSrc === 0) {
        vanishedKeys.add(`${op.account}|${op.sourceSymbol}|STK|||`)
      }
    }

    for (const g of symbolGroups) {
      // Find ops that apply to this group (i.e. group holds the source stock limit)
      const opsInGroup = ops.filter((op) => g.posKeys.includes(`${op.account}|${op.sourceSymbol}|STK|||`))
      if (opsInGroup.length === 0) continue

      let newKeys = g.posKeys.filter((k) => !vanishedKeys.has(k))
      for (const op of opsInGroup) {
        if (op.targetShares > 0) {
          newKeys.push(`${op.account}|${targetSymbol}|STK|||`)
        }
      }
      const uniqueKeys = Array.from(new Set(newKeys))
      if (uniqueKeys.length !== g.posKeys.length || uniqueKeys.some((k, i) => k !== g.posKeys[i])) {
        onUpdateSymbolGroup?.({ ...g, posKeys: uniqueKeys })
      }
    }
    setPendingTransferUpdate(null)
  }, [positions, pendingTransferUpdate, symbolGroups, onUpdateSymbolGroup])

  // Fetch Fed Funds Rate from FRED on mount
  const [fedRate, setFedRate] = useState<number | null>(null)
  useEffect(() => {
    window.ibApi
      .getFedFundsRate()
      .then(setFedRate)
      .catch(() => {
        /* ignore */
      })
  }, [])

  // Close context menu on any click or right-click elsewhere
  useEffect(() => {
    if (!contextMenu) return undefined
    const handler = (): void => setContextMenu(null)
    // Use rAF to avoid closing on the same event that opened the menu
    const id = requestAnimationFrame(() => {
      window.addEventListener('mousedown', handler)
    })
    return () => {
      cancelAnimationFrame(id)
      window.removeEventListener('mousedown', handler)
    }
  }, [contextMenu])

  // Auto-focus input when entering edit mode
  useEffect(() => {
    if (editingCell && editInputRef.current) {
      editInputRef.current.focus()
      editInputRef.current.select()
    }
  }, [editingCell])

  const startEdit = useCallback((order: OpenOrderData, field: 'quantity' | 'price') => {
    const current =
      field === 'quantity' ? String(order.quantity) : (order.limitPrice ?? 0).toFixed(2)
    setEditingCell({ orderId: order.orderId, field })
    setEditValue(current)
  }, [])

  const cancelEdit = useCallback(() => {
    setEditingCell(null)
    setEditValue('')
  }, [])

  const submitEdit = useCallback(
    (order: OpenOrderData, field: 'quantity' | 'price', value: string) => {
      const val = parseFloat(value)
      if (isNaN(val) || val <= 0) {
        cancelEdit()
        return
      }
      const newQty = field === 'quantity' ? val : order.quantity
      const newPrice = field === 'price' ? val : (order.limitPrice ?? 0)
      console.log('[EDIT] submitting modify order:', { orderId: order.orderId, newQty, newPrice })
      window.ibApi
        .modifyOrder({
          orderId: order.orderId,
          account: order.account,
          symbol: order.symbol,
          secType: order.secType,
          action: order.action,
          orderType: order.orderType,
          quantity: newQty,
          limitPrice: newPrice,
          expiry: order.expiry,
          strike: order.strike,
          right: order.right
        })
        .then(() => {
          console.log('[EDIT] modifyOrder succeeded')
          setTimeout(() => refresh?.(), 500)
        })
        .catch((err: unknown) => {
          console.error('[EDIT] modifyOrder failed:', err)
          alert('修改委託失敗: ' + String(err))
        })
      cancelEdit()
    },
    [cancelEdit, refresh]
  )


  const togglePosition = (key: string): void => {
    setSelectedPositions((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const toggleSelectMode = (mode: 'STK' | 'OPT'): void => {
    if (selectMode === mode) {
      setSelectedPositions(new Set())
      setSelectMode(false)
    } else {
      setSelectedPositions(new Set())
      setSelectMode(mode)
    }
  }

  const canRollOptions = useMemo(() => {
    if (selectedPositions.size === 0) return false
    const selected = positions.filter((p) => selectedPositions.has(posKey(p)))
    if (selected.length === 0) return false
    if (!selected.every((p) => p.secType === 'OPT')) return false
    const symbol = selected[0].symbol
    const right = selected[0].right
    const side = selected[0].quantity < 0 ? 'SELL' : 'BUY'
    return selected.every((p) => {
      const pSide = p.quantity < 0 ? 'SELL' : 'BUY'
      return p.symbol === symbol && p.right === right && pSide === side
    })
  }, [selectedPositions, positions])

  const canCreateGroup = useMemo(() => {
    if (selectMode !== 'OPT' || selectedPositions.size === 0) return false
    const selected = positions.filter((p) => selectedPositions.has(posKey(p)))
    if (selected.length === 0) return false
    if (!selected.every((p) => p.secType === 'OPT')) return false
    const symbol = selected[0].symbol
    return selected.every((p) => p.symbol === symbol)
  }, [selectMode, selectedPositions, positions])

  const canCloseOptions = useMemo(() => {
    if (selectedPositions.size === 0) return false
    const selected = positions.filter((p) => selectedPositions.has(posKey(p)))
    if (selected.length === 0) return false
    return selected.every((p) => p.secType === 'OPT')
  }, [selectedPositions, positions])

  const canTransferStocks = useMemo(() => {
    if (selectedPositions.size === 0) return false
    const selected = positions.filter((p) => selectedPositions.has(posKey(p)))
    if (selected.length === 0) return false
    return selected.every((p) => p.secType === 'STK' && p.quantity > 0)
  }, [selectedPositions, positions])

  const uniqueSymbols = useMemo(() => {
    const set = new Set<string>()
    positions.forEach((p) => set.add(p.symbol))
    const symbolPriority: Record<string, number> = { QQQ: 1, QLD: 2, TQQQ: 3 }
    return Array.from(set).sort(
      (a, b) => (symbolPriority[a] ?? 99) - (symbolPriority[b] ?? 99) || a.localeCompare(b)
    )
  }, [positions])

  const getPositionsForAccount = (accountId: string): PositionData[] => {
    return positions
      .filter((p) => p.account === accountId)
      .filter((p) => !filterSymbol || p.symbol === filterSymbol)

      .sort((a, b) => {
        const symbolPriority: Record<string, number> = { QQQ: 1, QLD: 2, TQQQ: 3 }
        const aIsStock = a.secType !== 'OPT' ? 0 : 1
        const bIsStock = b.secType !== 'OPT' ? 0 : 1
        if (aIsStock !== bIsStock) return aIsStock - bIsStock
        // Sort by symbol priority
        const aPri = symbolPriority[a.symbol] || 99
        const bPri = symbolPriority[b.symbol] || 99
        if (aPri !== bPri) return aPri - bPri
        // Options: sort by expiry date (nearest first)
        if (a.secType === 'OPT' && b.secType === 'OPT') {
          return (a.expiry || '').localeCompare(b.expiry || '')
        }
        return b.avgCost * Math.abs(b.quantity) - a.avgCost * Math.abs(a.quantity)
      })
  }

  const formatCurrency = (value: number, _currency: string = 'USD'): string => {
    return new Intl.NumberFormat('en-US', {
      style: 'decimal',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value)
  }

  const formatPositionSymbol = (pos: PositionData): string => {
    if (pos.secType === 'OPT' && pos.expiry && pos.strike && pos.right) {
      const months = [
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
      // expiry format from IB: "20260217"
      const yy = pos.expiry.substring(2, 4)
      const month = months[parseInt(pos.expiry.substring(4, 6)) - 1]
      const day = pos.expiry.substring(6, 8)
      const strike = Number.isInteger(pos.strike) ? pos.strike.toString() : pos.strike.toFixed(1)
      const right = pos.right === 'C' || pos.right === 'CALL' ? 'C' : 'P'
      return `${pos.symbol} ${month}${day}'${yy} ${strike}${right}`
    }
    return pos.symbol
  }
  if (!connected) {
    return (
      <div>
        <div className="empty-state">請先連線到 TWS / IB Gateway</div>
      </div>
    )
  }

  const sortedAccounts = [...accounts].sort((a, b) => {
    if (sortBy === 'netLiquidation') return b.netLiquidation - a.netLiquidation
    if (sortBy === 'margin') {
      const aPutCost = positions
        .filter(
          (p) =>
            p.account === a.accountId &&
            p.secType === 'OPT' &&
            (p.right === 'P' || p.right === 'PUT') &&
            p.quantity < 0
        )
        .reduce((sum, p) => sum + (p.strike || 0) * 100 * Math.abs(p.quantity), 0)
      const bPutCost = positions
        .filter(
          (p) =>
            p.account === b.accountId &&
            p.secType === 'OPT' &&
            (p.right === 'P' || p.right === 'PUT') &&
            p.quantity < 0
        )
        .reduce((sum, p) => sum + (p.strike || 0) * 100 * Math.abs(p.quantity), 0)
      const aRatio = a.netLiquidation > 0 ? (a.grossPositionValue + aPutCost) / a.netLiquidation : 0
      const bRatio = b.netLiquidation > 0 ? (b.grossPositionValue + bPutCost) / b.netLiquidation : 0
      return bRatio - aRatio
    }
    return b.totalCashValue - a.totalCashValue
  })

  // Filter accounts: when filters are active, only show accounts with matching positions
  const displayAccounts = sortedAccounts.filter((a) => {
    let acctPositions = positions.filter((p) => p.account === a.accountId)
    if (filterSymbol) acctPositions = acctPositions.filter((p) => p.symbol === filterSymbol)
    if (selectMode === 'STK') acctPositions = acctPositions.filter((p) => p.secType !== 'OPT')
    if (selectMode === 'OPT') acctPositions = acctPositions.filter((p) => p.secType === 'OPT')
    if (filterSymbol || selectMode) return acctPositions.length > 0
    return true
  })

  return (
    <>
      <div>
        <div className="sort-bar">
          {groupViewMode ? (
            <div style={{ display: 'flex', width: '100%', justifyContent: 'flex-end' }}>
              <button
                className="select-toggle-btn"
                onClick={() => setShowAddGroup(true)}
              >
                ＋ 新增
              </button>
            </div>
          ) : (
            <>
              <div className="select-actions">
                <button
                  className="select-toggle-btn"
                  style={{ padding: '7px 9px' }}
                  title="重置篩選"
                  onClick={() => {
                    setFilterSymbol('')
                    setSelectMode(false)
                    setSelectedPositions(new Set())
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
                <button
                  className={`select-toggle-btn${selectMode === 'STK' ? ' active' : ''}`}
                  onClick={() => toggleSelectMode('STK')}
                >
                  選取股票
                  {selectMode === 'STK' && selectedPositions.size > 0
                    ? ` (${selectedPositions.size})`
                    : ''}
                </button>
                <button
                  className={`select-toggle-btn${selectMode === 'OPT' ? ' active' : ''}`}
                  onClick={() => toggleSelectMode('OPT')}
                >
                  選取期權
                  {selectMode === 'OPT' && selectedPositions.size > 0
                    ? ` (${selectedPositions.size})`
                    : ''}
                </button>
                <CustomSelect
                  value={filterSymbol}
                  onChange={(v) => {
                    setFilterSymbol(v)
                    setSelectedPositions(new Set())
                  }}
                  options={[
                    { value: '', label: '全部標的' },
                    ...uniqueSymbols.map((s) => ({ value: s, label: s }))
                  ]}
                />
                {selectMode && (
                  <button
                    className="select-toggle-btn"
                    onClick={() => {
                      const allKeys = new Set<string>()
                      displayAccounts.forEach((acct) => {
                        getPositionsForAccount(acct.accountId)
                          .filter((p) =>
                            selectMode === 'OPT' ? p.secType === 'OPT' : p.secType !== 'OPT'
                          )
                          .forEach((p) => allKeys.add(posKey(p)))
                      })
                      setSelectedPositions((prev) => (prev.size === allKeys.size ? new Set() : allKeys))
                    }}
                  >
                    全選
                  </button>
                )}
                {selectMode && canRollOptions && (
                  <button className="select-toggle-btn" onClick={() => setShowRollDialog(true)}>
                    展期
                  </button>
                )}
                {selectMode === 'OPT' && canCloseOptions && (
                  <button className="select-toggle-btn" onClick={() => setShowCloseOptionDialog(true)}>
                    期權平倉
                  </button>
                )}
                {selectMode === 'STK' && canTransferStocks && (
                  <button className="select-toggle-btn" onClick={() => setShowTransferDialog(true)}>
                    轉倉
                  </button>
                )}
                {selectMode === 'OPT' && canCreateGroup && !showGroupNameInput && (
                  <button
                    className="select-toggle-btn"
                    onClick={() => {
                      setShowGroupNameInput(true)
                      setGroupNameInput('')
                    }}
                  >
                    建立群組
                  </button>
                )}
                {showGroupNameInput && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <input
                      type="text"
                      value={groupNameInput}
                      onChange={(e) => setGroupNameInput(e.target.value)}
                      placeholder="輸入群組名稱"
                      autoFocus
                      style={{
                        padding: '4px 8px',
                        fontSize: '12px',
                        border: '1px solid #ccc',
                        borderRadius: '4px',
                        width: '120px'
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && groupNameInput.trim()) {
                          const selected = positions.filter((p) => selectedPositions.has(posKey(p)))
                          const symbol = selected[0]?.symbol || ''
                          const group: SymbolGroup = {
                            id: crypto.randomUUID(),
                            name: groupNameInput.trim(),
                            symbol,
                            posKeys: selected.map((p) => posKey(p)),
                            createdAt: Date.now()
                          }
                          onAddSymbolGroup?.(group)
                          setSelectedPositions(new Set())
                          setShowGroupNameInput(false)
                          setGroupNameInput('')
                        } else if (e.key === 'Escape') {
                          setShowGroupNameInput(false)
                          setGroupNameInput('')
                        }
                      }}
                    />
                    <button
                      className="select-toggle-btn"
                      onClick={() => {
                        if (!groupNameInput.trim()) return
                        const selected = positions.filter((p) => selectedPositions.has(posKey(p)))
                        const symbol = selected[0]?.symbol || ''
                        const group: SymbolGroup = {
                          id: crypto.randomUUID(),
                          name: groupNameInput.trim(),
                          symbol,
                          posKeys: selected.map((p) => posKey(p)),
                          createdAt: Date.now()
                        }
                        onAddSymbolGroup?.(group)
                        setSelectedPositions(new Set())
                        setShowGroupNameInput(false)
                        setGroupNameInput('')
                      }}
                    >
                      確認
                    </button>
                    <button
                      className="select-toggle-btn"
                      onClick={() => {
                        setShowGroupNameInput(false)
                        setGroupNameInput('')
                      }}
                    >
                      取消
                    </button>
                  </div>
                )}
                {selectMode === 'STK' && canTransferStocks && (
                  <button className="select-toggle-btn" onClick={() => setShowCloseDialog(true)}>
                    平倉
                  </button>
                )}
              </div>
              {!selectMode && (
                <>
                  <button
                    className="select-toggle-btn"
                    onClick={() => setShowBatchOrder(true)}
                    style={{ marginLeft: 'auto' }}
                  >
                    股票下單
                  </button>
                  <button className="select-toggle-btn" onClick={() => setShowOptionOrder(true)}>
                    期權下單
                  </button>
                </>
              )}
              <CustomSelect
                value={sortBy}
                onChange={setSortBy}
                options={[
                  { value: 'netLiquidation', label: '淨值-從高到低' },
                  { value: 'margin', label: '潛在融資-從高到低' },
                  { value: 'cash', label: '現金-從多到少' }
                ]}
              />
            </>
          )}
        </div>

        {groupViewMode ? (
          /* Group Cards View */
          symbolGroups.length === 0 ? (
            <div className="empty-state">尚無群組，請選取期權後建立</div>
          ) : (
            <div className="accounts-grid">
              {symbolGroups.map((g) => {
                const groupPosKeys = new Set(g.posKeys)
                const groupPositions = positions.filter((p) => groupPosKeys.has(posKey(p))).sort((a, b) => {
                  if (a.secType !== b.secType) return a.secType === 'STK' ? -1 : 1
                  return 0
                })
                return (
                  <div key={g.id} className="account-card">
                    <div className="account-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span className="account-id">{g.name}</span>
                        {(() => {
                          if (groupPositions.length === 0) return null
                          const setGroupKeys = (): void => {
                            const keys = new Set(groupPositions.map(p => posKey(p)))
                            setSelectedPositions(keys)
                          }
                          const allOpt = groupPositions.every(p => p.secType === 'OPT')
                          const allStk = groupPositions.every(p => p.secType === 'STK')
                          if (allOpt) {
                            const rights = new Set(groupPositions.map(p => (p.right || '').toUpperCase().replace('CALL', 'C').replace('PUT', 'P')))
                            const symbols = new Set(groupPositions.map(p => p.symbol))
                            const canRoll = rights.size === 1 && symbols.size === 1
                            return (
                              <>
                                {canRoll && (
                                  <button
                                    className="select-toggle-btn"
                                    style={{ fontSize: '13px', padding: '2px 10px', lineHeight: '1.4' }}
                                    onClick={() => { setGroupKeys(); setShowRollDialog(true) }}
                                  >
                                    展期
                                  </button>
                                )}
                                <button
                                  className="select-toggle-btn"
                                  style={{ fontSize: '13px', padding: '2px 10px', lineHeight: '1.4' }}
                                  onClick={() => { setGroupKeys(); setShowCloseOptionDialog(true) }}
                                >
                                  平倉
                                </button>
                              </>
                            )
                          }
                          if (allStk) {
                            return (
                              <>
                                <button
                                  className="select-toggle-btn"
                                  style={{ fontSize: '13px', padding: '2px 10px', lineHeight: '1.4' }}
                                  onClick={() => { setGroupKeys(); setShowTransferDialog(true) }}
                                >
                                  轉倉
                                </button>
                                <button
                                  className="select-toggle-btn"
                                  style={{ fontSize: '13px', padding: '2px 10px', lineHeight: '1.4' }}
                                  onClick={() => { setGroupKeys(); setShowCloseDialog(true) }}
                                >
                                  平倉
                                </button>
                              </>
                            )
                          }
                          return (
                            <button
                              className="select-toggle-btn"
                              style={{ fontSize: '13px', padding: '2px 10px', lineHeight: '1.4' }}
                              onClick={() => { setGroupKeys(); setShowCloseGroupDialog(true) }}
                            >
                              平倉
                            </button>
                          )
                        })()}
                      </div>
                      {(() => {
                        const totalPnl = groupPositions.reduce((sum, pos) => {
                          const isOpt = pos.secType === 'OPT'
                          const key = `${pos.symbol}|${pos.expiry || ''}|${pos.strike || ''}|${pos.right || ''}`
                          const lp = isOpt ? (optionQuotes[key] ?? 0) : (quotes[pos.symbol] ?? 0)
                          const pnl = isOpt
                            ? (lp - pos.avgCost / 100) * pos.quantity * 100
                            : (lp - pos.avgCost) * pos.quantity
                          return sum + pnl
                        }, 0)
                        return (
                          <span style={{
                            fontSize: '14px',
                            fontWeight: 600,
                            marginLeft: 'auto',
                            marginRight: '12px',
                            color: totalPnl >= 0 ? '#1a6b3a' : '#c0392b'
                          }}>
                            {totalPnl >= 0 ? '+' : ''}{Math.round(totalPnl).toLocaleString()}
                          </span>
                        )
                      })()}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <svg
                          xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
                          fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                          style={{ cursor: 'pointer', opacity: 0.7 }}
                          onClick={() => {
                            setEditingGroup(g)
                            setShowAddGroup(true)
                          }}
                        >
                          <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                          <path d="m15 5 4 4" />
                        </svg>
                        <svg
                          xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
                          fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                          style={{ cursor: 'pointer', opacity: 0.7 }}
                          onClick={() => {
                            if (confirm('確定刪除群組「' + g.name + '」？')) {
                              onDeleteSymbolGroup?.(g.id)
                            }
                          }}
                        >
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          <line x1="10" y1="11" x2="10" y2="17" />
                          <line x1="14" y1="11" x2="14" y2="17" />
                        </svg>
                      </div>
                    </div>
                    {groupPositions.length === 0 ? (
                      <div style={{ padding: '12px', fontSize: '12px', color: '#999' }}>
                        無匹配持倉
                      </div>
                    ) : (
                      <div className="positions-section">
                        <table className="positions-table">
                          <thead>
                            <tr>
                              <th style={{ width: '12%', textAlign: 'left' }}>帳戶</th>
                              <th style={{ width: '22%', textAlign: 'left' }}>期權</th>
                              <th style={{ width: '8%' }}>天數</th>
                              <th style={{ width: '8%' }}>數量</th>
                              <th style={{ width: '11%' }}>均價</th>
                              <th style={{ width: '11%' }}>最後價</th>
                              <th style={{ width: '11%' }}>盈虧</th>
                            </tr>
                          </thead>
                          <tbody>
                            {groupPositions.map((pos, idx) => {
                              const isOption = pos.secType === 'OPT'
                              const key = `${pos.symbol}|${pos.expiry || ''}|${pos.strike || ''}|${pos.right || ''}`
                              const lastPrice = isOption ? (optionQuotes[key] ?? 0) : (quotes[pos.symbol] ?? 0)
                              const displayAvg = isOption ? pos.avgCost / 100 : pos.avgCost
                              const pnl = isOption
                                ? (lastPrice - pos.avgCost / 100) * pos.quantity * 100
                                : (lastPrice - pos.avgCost) * pos.quantity
                              const days = pos.expiry
                                ? Math.max(
                                  0,
                                  Math.ceil(
                                    (new Date(
                                      pos.expiry.substring(0, 4) +
                                      '-' +
                                      pos.expiry.substring(4, 6) +
                                      '-' +
                                      pos.expiry.substring(6, 8) +
                                      'T00:00:00'
                                    ).getTime() -
                                      new Date().setHours(0, 0, 0, 0)) /
                                    (1000 * 60 * 60 * 24)
                                  )
                                )
                                : null
                              return (
                                <tr key={idx}>
                                  <td style={{ fontSize: '13px', color: '#8b7e74', textAlign: 'left' }}>{(accounts.find(a => a.accountId === pos.account)?.alias || pos.account).replace(/\s*\(.*?\)/, '')}</td>
                                  <td className="pos-symbol">{formatPositionSymbol(pos)}</td>
                                  <td
                                    style={
                                      days === 0
                                        ? { backgroundColor: '#fff0f0' }
                                        : days === 1
                                          ? { backgroundColor: '#e8f4fd' }
                                          : undefined
                                    }
                                  >
                                    {days !== null ? days : '-'}
                                  </td>
                                  <td style={{ color: pos.quantity >= 0 ? '#16a34a' : '#dc2626' }}>
                                    {pos.quantity.toLocaleString()}
                                  </td>
                                  <td>{displayAvg.toFixed(2)}</td>
                                  <td>{lastPrice ? lastPrice.toFixed(2) : '-'}</td>
                                  <td
                                    style={{
                                      color: pnl >= 0 ? '#16a34a' : '#dc2626',
                                      fontWeight: 500
                                    }}
                                  >
                                    {pnl >= 0 ? '+' : ''}
                                    {pnl.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )
        ) : accounts.length === 0 ? (
          <div className="empty-state">{loading ? '正在載入帳戶資料...' : '未找到帳戶資料'}</div>
        ) : (
          <div className="accounts-grid">
            {displayAccounts.map((account) => (
              <div
                key={account.accountId}
                className={`account-card${selectedAccount === account.accountId ? ' account-card-selected' : ''}`}
                onClick={() =>
                  setSelectedAccount((prev) =>
                    prev === account.accountId ? null : account.accountId
                  )
                }
              >
                <div className="account-header">
                  <span className="account-id">{account.alias || account.accountId}</span>
                  <button
                    className="ai-advisor-btn"
                    title="AI 交易建議"
                    onClick={(e) => {
                      e.stopPropagation()
                      setShowAiAdvisor(account.accountId)
                    }}
                  >
                    💡
                  </button>
                  <div className="account-type-select" onClick={(e) => e.stopPropagation()}>
                    <CustomSelect
                      value={accountTypes?.[account.accountId] || 'reg_t'}
                      options={TRADING_TYPE_OPTIONS}
                      onChange={(v) => onSetAccountType?.(account.accountId, v)}
                    />
                  </div>
                </div>

                {!selectMode && (
                  <div className="account-metrics">
                    <div className="metric">
                      <span className="metric-label">淨值</span>
                      <span className="metric-value">
                        {formatCurrency(account.netLiquidation, account.currency)}
                      </span>
                    </div>

                    <div className="metric">
                      <span className="metric-label">現金</span>
                      <span
                        className="metric-value"
                        style={account.totalCashValue < 0 ? { color: '#b91c1c' } : undefined}
                      >
                        {formatCurrency(account.totalCashValue, account.currency)}
                      </span>
                    </div>
                    {account.totalCashValue < 0 &&
                      fedRate !== null &&
                      (() => {
                        const loan = account.totalCashValue
                        const abs = Math.abs(loan)
                        const spread =
                          abs <= 100_000
                            ? 1.5
                            : abs <= 1_000_000
                              ? 1.0
                              : abs <= 3_000_000
                                ? 0.5
                                : 0.25
                        const annualRate = (fedRate + spread) / 100
                        const dailyInterest = (abs * annualRate) / 360
                        return (
                          <div
                            className="metric"
                            style={{ backgroundColor: '#ffe4e6', borderRadius: '4px' }}
                            title={`BM ${fedRate.toFixed(2)}% + ${spread}% = ${(fedRate + spread).toFixed(2)}% p.a.`}
                          >
                            <span className="metric-label">日利息</span>
                            <span className="metric-value" style={{ color: '#b91c1c' }}>
                              -{dailyInterest.toFixed(0)}
                            </span>
                          </div>
                        )
                      })()}
                    <div className="metric">
                      <span className="metric-label">融資率</span>
                      <span className="metric-value">
                        {account.netLiquidation > 0
                          ? (account.grossPositionValue / account.netLiquidation).toFixed(2)
                          : '-'}
                      </span>
                    </div>
                    {(() => {
                      const potentialMargin =
                        account.netLiquidation > 0
                          ? (account.grossPositionValue +
                            positions
                              .filter(
                                (p) =>
                                  p.account === account.accountId &&
                                  p.secType === 'OPT' &&
                                  (p.right === 'P' || p.right === 'PUT') &&
                                  p.quantity < 0
                              )
                              .reduce(
                                (sum, p) => sum + (p.strike || 0) * 100 * Math.abs(p.quantity),
                                0
                              )) /
                          account.netLiquidation
                          : null
                      return (
                        <div
                          className="metric"
                          style={
                            potentialMargin !== null && potentialMargin > marginLimit
                              ? { backgroundColor: '#ffe4e6', borderRadius: '4px' }
                              : undefined
                          }
                        >
                          <span className="metric-label">潛在融資</span>
                          <span className="metric-value">
                            {potentialMargin !== null ? potentialMargin.toFixed(2) : '-'}
                          </span>
                        </div>
                      )
                    })()}
                  </div>
                )}

                {/* Stock Positions */}
                {selectMode !== 'OPT' &&
                  getPositionsForAccount(account.accountId).filter((p) => p.secType !== 'OPT')
                    .length > 0 && (
                    <div className="positions-section">
                      <table className="positions-table">
                        <thead>
                          <tr>
                            <th style={{ textAlign: 'left' }}>股票</th>
                            <th>數量</th>
                            <th>均價</th>
                            <th>最後價</th>
                            <th>盈虧</th>
                          </tr>
                        </thead>
                        <tbody>
                          {getPositionsForAccount(account.accountId)
                            .filter((p) => p.secType !== 'OPT')
                            .map((pos, idx) => (
                              <tr
                                key={idx}
                                className={
                                  selectMode === 'STK'
                                    ? `selectable-row${selectedPositions.has(posKey(pos)) ? ' selected' : ''}`
                                    : ''
                                }
                                onClick={
                                  selectMode === 'STK'
                                    ? () => togglePosition(posKey(pos))
                                    : undefined
                                }
                                style={selectMode === 'STK' ? { cursor: 'pointer' } : undefined}
                              >
                                <td className="pos-symbol">
                                  {selectMode === 'STK' && (
                                    <input
                                      type="checkbox"
                                      checked={selectedPositions.has(posKey(pos))}
                                      onChange={() => togglePosition(posKey(pos))}
                                      onClick={(e) => e.stopPropagation()}
                                      style={{ marginRight: '6px', verticalAlign: 'middle' }}
                                    />
                                  )}
                                  {formatPositionSymbol(pos)}
                                </td>
                                <td className={pos.quantity > 0 ? 'pos-long' : 'pos-short'}>
                                  {pos.quantity.toLocaleString()}
                                </td>
                                <td>{pos.avgCost.toFixed(2)}</td>
                                <td>{quotes[pos.symbol] ? quotes[pos.symbol].toFixed(2) : '-'}</td>
                                <td
                                  style={{
                                    color: quotes[pos.symbol]
                                      ? (quotes[pos.symbol] - pos.avgCost) * pos.quantity >= 0
                                        ? '#1a6b3a'
                                        : '#8b1a1a'
                                      : undefined
                                  }}
                                >
                                  {quotes[pos.symbol]
                                    ? (
                                      (quotes[pos.symbol] - pos.avgCost) *
                                      pos.quantity
                                    ).toLocaleString('en-US', { maximumFractionDigits: 0 })
                                    : '-'}
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                {/* Option Positions */}
                {selectMode !== 'STK' &&
                  getPositionsForAccount(account.accountId).filter((p) => p.secType === 'OPT')
                    .length > 0 && (
                    <div className="positions-section">
                      <table className="positions-table">
                        <thead>
                          <tr>
                            <th style={{ width: '25%', textAlign: 'left' }}>期權</th>
                            <th style={{ width: '8%' }}>天數</th>
                            <th style={{ width: '8%' }}>數量</th>
                            <th style={{ width: '11%' }}>均價</th>
                            <th style={{ width: '11%' }}>最後價</th>
                            <th style={{ width: '11%' }}>盈虧</th>
                          </tr>
                        </thead>
                        <tbody>
                          {getPositionsForAccount(account.accountId)
                            .filter((p) => p.secType === 'OPT')
                            .map((pos, idx) => (
                              <tr
                                key={idx}
                                className={
                                  selectMode === 'OPT'
                                    ? `selectable-row${selectedPositions.has(posKey(pos)) ? ' selected' : ''}`
                                    : ''
                                }
                                onClick={
                                  selectMode === 'OPT'
                                    ? () => togglePosition(posKey(pos))
                                    : undefined
                                }
                                style={selectMode === 'OPT' ? { cursor: 'pointer' } : undefined}
                              >
                                <td className="pos-symbol">
                                  {selectMode === 'OPT' && (
                                    <input
                                      type="checkbox"
                                      checked={selectedPositions.has(posKey(pos))}
                                      onChange={() => togglePosition(posKey(pos))}
                                      onClick={(e) => e.stopPropagation()}
                                      style={{ marginRight: '6px', verticalAlign: 'middle' }}
                                    />
                                  )}
                                  {formatPositionSymbol(pos)}
                                </td>
                                {(() => {
                                  const days = pos.expiry
                                    ? Math.max(
                                      0,
                                      Math.ceil(
                                        (new Date(
                                          pos.expiry.substring(0, 4) +
                                          '-' +
                                          pos.expiry.substring(4, 6) +
                                          '-' +
                                          pos.expiry.substring(6, 8) +
                                          'T00:00:00'
                                        ).getTime() -
                                          new Date().setHours(0, 0, 0, 0)) /
                                        (1000 * 60 * 60 * 24)
                                      )
                                    )
                                    : null
                                  return (
                                    <td
                                      style={
                                        days === 0
                                          ? { backgroundColor: '#fff0f0' }
                                          : days === 1
                                            ? { backgroundColor: '#e8f4fd' }
                                            : undefined
                                      }
                                    >
                                      {days ?? '-'}
                                    </td>
                                  )
                                })()}
                                <td className={pos.quantity > 0 ? 'pos-long' : 'pos-short'}>
                                  {pos.quantity.toLocaleString()}
                                </td>
                                <td>{(pos.avgCost / 100).toFixed(2)}</td>
                                {(() => {
                                  const key = `${pos.symbol}|${pos.expiry}|${pos.strike}|${pos.right}`
                                  const lastPrice = optionQuotes[key]
                                  if (lastPrice != null && lastPrice > 0) {
                                    const avgUnit = pos.avgCost / 100
                                    const pnl = (lastPrice - avgUnit) * pos.quantity * 100
                                    return (
                                      <>
                                        <td>{lastPrice.toFixed(2)}</td>
                                        <td className={pnl >= 0 ? 'pos-long' : 'pos-short'}>
                                          {pnl >= 0 ? '+' : ''}
                                          {Math.round(pnl).toLocaleString()}
                                        </td>
                                      </>
                                    )
                                  }
                                  return (
                                    <>
                                      <td>-</td>
                                      <td>-</td>
                                    </>
                                  )
                                })()}
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                {/* Open Orders */}
                {!selectMode &&
                  openOrders.filter((o) => o.account === account.accountId).length > 0 && (
                    <div
                      className="positions-section order-section"
                      style={{ backgroundColor: '#fffbe6' }}
                    >
                      <table className="positions-table">
                        <thead>
                          <tr>
                            <th style={{ width: '35%', textAlign: 'left' }}>委託</th>
                            <th style={{ width: '13%' }}>方向</th>
                            <th style={{ width: '13%' }}>數量</th>
                            <th style={{ width: '20%' }}>價格</th>
                            <th style={{ width: '19%' }}>狀態</th>
                          </tr>
                        </thead>
                        <tbody>
                          {openOrders
                            .filter((o) => o.account === account.accountId)
                            .map((order) => {
                              const arrow = (
                                <span style={{ color: '#956b3a', margin: '0 3px' }}>→</span>
                              )
                              const desc: React.ReactNode =
                                order.secType === 'OPT' ? (
                                  formatOptionLabel(
                                    order.symbol,
                                    order.expiry,
                                    order.strike,
                                    order.right
                                  )
                                ) : order.secType === 'BAG' && order.comboDescription ? (
                                  <>
                                    {order.symbol}{' '}
                                    {order.comboDescription.split(' → ').map((p, i) => (
                                      <React.Fragment key={i}>
                                        {i > 0 && arrow}
                                        {p}
                                      </React.Fragment>
                                    ))}
                                  </>
                                ) : (
                                  order.symbol
                                )
                              return (
                                <tr
                                  key={order.orderId}
                                  onContextMenu={(e) => {
                                    e.preventDefault()
                                    if (order.status !== 'PendingCancel')
                                      setContextMenu({ x: e.clientX, y: e.clientY, order })
                                  }}
                                >
                                  <td className="pos-symbol">{desc}</td>
                                  <td
                                    style={{
                                      color: order.action === 'BUY' ? '#1a6b3a' : '#8b1a1a',
                                      fontWeight: 600
                                    }}
                                  >
                                    {order.action === 'BUY' ? '買' : '賣'}
                                  </td>
                                  <td
                                    style={{ cursor: 'pointer' }}
                                    onDoubleClick={() => startEdit(order, 'quantity')}
                                  >
                                    {editingCell?.orderId === order.orderId &&
                                      editingCell.field === 'quantity' ? (
                                      <input
                                        ref={editInputRef}
                                        type="number"
                                        step="1"
                                        value={editValue}
                                        onChange={(e) => setEditValue(e.target.value)}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter')
                                            submitEdit(order, 'quantity', editValue)
                                          if (e.key === 'Escape') cancelEdit()
                                        }}
                                        onBlur={() => cancelEdit()}
                                        style={{
                                          width: '60px',
                                          padding: '2px 4px',
                                          fontSize: '13px',
                                          background: 'transparent',
                                          border: '1px solid #94a3b8',
                                          borderRadius: '3px',
                                          color: 'inherit',
                                          outline: 'none',
                                          textAlign: 'center'
                                        }}
                                      />
                                    ) : (
                                      order.quantity
                                    )}
                                  </td>
                                  <td
                                    style={{
                                      cursor: order.orderType === 'LMT' ? 'pointer' : 'default'
                                    }}
                                    onDoubleClick={() => {
                                      if (order.orderType === 'LMT') startEdit(order, 'price')
                                    }}
                                  >
                                    {editingCell?.orderId === order.orderId &&
                                      editingCell.field === 'price' ? (
                                      <input
                                        ref={editInputRef}
                                        type="number"
                                        step="0.01"
                                        value={editValue}
                                        onChange={(e) => setEditValue(e.target.value)}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter')
                                            submitEdit(order, 'price', editValue)
                                          if (e.key === 'Escape') cancelEdit()
                                        }}
                                        onBlur={() => cancelEdit()}
                                        style={{
                                          width: '80px',
                                          padding: '2px 4px',
                                          fontSize: '13px',
                                          background: 'transparent',
                                          border: '1px solid #94a3b8',
                                          borderRadius: '3px',
                                          color: 'inherit',
                                          outline: 'none',
                                          textAlign: 'center'
                                        }}
                                      />
                                    ) : order.orderType === 'LMT' ? (
                                      (order.limitPrice ?? 0).toFixed(2)
                                    ) : (
                                      '市價'
                                    )}
                                  </td>
                                  <td style={{ whiteSpace: 'nowrap', fontSize: '13px' }}>
                                    {(
                                      {
                                        Submitted: '已送出',
                                        PendingSubmit: '待送出',
                                        PreSubmitted: '預送出',
                                        PendingCancel: '取消中',
                                        Filled: '已成交',
                                        Cancelled: '已取消',
                                        Inactive: '未啟用'
                                      } as Record<string, string>
                                    )[order.status] || order.status}
                                  </td>
                                </tr>
                              )
                            })}
                        </tbody>
                      </table>
                    </div>
                  )}

                {/* Today's Filled Orders */}
                {!selectMode &&
                  executions.filter((e) => e.account === account.accountId).length > 0 && (
                    <div
                      className="positions-section"
                      style={{ background: '#f5f5f5', borderRadius: '6px', padding: '8px' }}
                    >
                      <table className="positions-table">
                        <thead>
                          <tr>
                            <th style={{ width: '35%', textAlign: 'left' }}>今日成交</th>
                            <th style={{ width: '13%' }}>方向</th>
                            <th style={{ width: '13%' }}>數量</th>
                            <th style={{ width: '20%' }}>成交價</th>
                            <th style={{ width: '19%' }}>時間</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(() => {
                            // Filter then aggregate partial fills of the same order
                            const filtered = executions
                              .filter((e) => e.account === account.accountId)
                              .filter((e) => {
                                // Hide OPT legs that belong to a combo (BAG) order
                                if (e.secType === 'OPT') {
                                  const hasCombo = executions.some(
                                    (b) =>
                                      b.account === account.accountId &&
                                      b.orderId === e.orderId &&
                                      b.secType === 'BAG'
                                  )
                                  if (hasCombo) return false
                                }
                                return true
                              })
                            // Aggregate partial fills: group by orderId+secType
                            const grouped = new Map<string, typeof filtered[0]>()
                            for (const e of filtered) {
                              const key = `${e.orderId}|${e.secType}`
                              const existing = grouped.get(key)
                              if (existing) {
                                existing.quantity += e.quantity
                                // Keep the latest time
                                if (e.time > existing.time) existing.time = e.time
                              } else {
                                grouped.set(key, { ...e })
                              }
                            }
                            return Array.from(grouped.values())
                              .sort((a, b) => b.time.localeCompare(a.time))
                              .map((exec) => {
                                const acctExecs = executions.filter(
                                  (e) => e.account === account.accountId
                                )
                                let desc: React.ReactNode
                                if (exec.secType === 'OPT') {
                                  desc = formatOptionLabel(
                                    exec.symbol,
                                    exec.expiry,
                                    exec.strike,
                                    exec.right
                                  )
                                } else if (exec.secType === 'BAG') {
                                  // Build description from sibling OPT legs with the same orderId
                                  const legs = acctExecs.filter(
                                    (e) =>
                                      e.orderId === exec.orderId &&
                                      e.secType === 'OPT' &&
                                      e.symbol === exec.symbol
                                  )
                                  if (legs.length > 0) {
                                    const seen = new Set<string>()
                                    const legDescs: string[] = []
                                    for (const l of legs) {
                                      const exp = l.expiry
                                        ? (() => {
                                          const yy = l.expiry.slice(2, 4)
                                          const mm = parseInt(l.expiry.slice(4, 6), 10) - 1
                                          const dd = l.expiry.slice(6, 8).replace(/^0/, '')
                                          return `${MONTHS[mm]}${dd}'${yy}`
                                        })()
                                        : ''
                                      const r = l.right === 'C' || l.right === 'CALL' ? 'C' : 'P'
                                      const sign = l.side === 'BOT' ? '+' : '-'
                                      const key = `${sign}${exp} ${l.strike}${r}`
                                      if (!seen.has(key)) {
                                        seen.add(key)
                                        legDescs.push(key)
                                      }
                                    }
                                    legDescs.sort(
                                      (a, b) => (a[0] === '+' ? 0 : 1) - (b[0] === '+' ? 0 : 1)
                                    )
                                    const arrow = (
                                      <span
                                        style={{ color: '#956b3a', fontWeight: 400, margin: '0 3px' }}
                                      >
                                        →
                                      </span>
                                    )
                                    desc = (
                                      <>
                                        {exec.symbol}{' '}
                                        {legDescs.map((l, i) => (
                                          <React.Fragment key={i}>
                                            {i > 0 && arrow}
                                            {l}
                                          </React.Fragment>
                                        ))}
                                      </>
                                    )
                                  } else {
                                    desc = `${exec.symbol} COMBO`
                                  }
                                } else {
                                  desc = exec.symbol
                                }
                                const isAssignment =
                                  exec.orderId === 0 && exec.price === 0 && exec.secType === 'OPT'
                                // Convert IB time (e.g. "20260218 18:14:12 Asia/Taipei") → US Eastern "05:14"
                                const fmtTime = (() => {
                                  const m = exec.time.match(
                                    /^(\d{4})(\d{2})(\d{2})\s+(\d{2}):(\d{2}):(\d{2})\s+(.+)$/
                                  )
                                  if (!m)
                                    return exec.time.replace(
                                      /^\d{4}\d{2}\d{2}\s+(\d{2}:\d{2}).*$/,
                                      '$1'
                                    )
                                  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`
                                  const d = new Date(
                                    new Date(iso).toLocaleString('en-US', { timeZone: m[7] })
                                  )
                                  return d.toLocaleTimeString('en-US', {
                                    timeZone: 'America/New_York',
                                    hour: '2-digit',
                                    minute: '2-digit',
                                    hour12: false
                                  })
                                })()
                                return (
                                  <tr key={exec.execId}>
                                    <td className="pos-symbol">
                                      {desc}
                                      {isAssignment && (
                                        <span
                                          style={{
                                            color: '#1a6baa',
                                            fontWeight: 600,
                                            marginLeft: 6,
                                            fontSize: '0.92em'
                                          }}
                                        >
                                          (到期)
                                        </span>
                                      )}
                                    </td>
                                    <td
                                      style={{
                                        color: exec.side === 'BOT' ? '#1a6b3a' : '#8b1a1a',
                                        fontWeight: 600
                                      }}
                                    >
                                      {exec.side === 'BOT' ? '買' : '賣'}
                                    </td>
                                    <td>{exec.quantity}</td>
                                    <td>{exec.avgPrice.toFixed(2)}</td>
                                    <td style={{ whiteSpace: 'nowrap' }}>{fmtTime}</td>
                                  </tr>
                                )
                              })
                          })()}
                        </tbody>
                      </table>
                    </div>
                  )}
              </div>
            ))}
          </div>
        )}
      </div>
      <RollOptionDialog
        open={showRollDialog}
        onClose={() => setShowRollDialog(false)}
        selectedPositions={positions.filter((p) => selectedPositions.has(posKey(p)))}
        accounts={accounts}
        onRollComplete={(rolledPositions, target) => {
          // Store intent: will be applied once IB confirms the fill via position updates
          setPendingRollUpdate({ rolledPositions, target })
        }}
      />
      {showBatchOrder && (
        <div className="stock-order-dialog-overlay" onClick={() => setShowBatchOrder(false)}>
          <div className="stock-order-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="stock-order-dialog-header">
              <h2>股票下單</h2>
              <button className="settings-close-btn" onClick={() => setShowBatchOrder(false)}>
                ✕
              </button>
            </div>
            <div className="stock-order-dialog-body">
              <BatchOrderForm connected={connected} accounts={accounts} positions={positions} />
            </div>
          </div>
        </div>
      )}
      <TransferStockDialog
        open={showTransferDialog}
        onClose={() => setShowTransferDialog(false)}
        selectedPositions={positions.filter((p) => selectedPositions.has(posKey(p)))}
        accounts={accounts}
        quotes={quotes}
        onTransferComplete={(soldPositions, targetSymbol) => {
          const ops = soldPositions.map((sp) => {
            const currentSrc = positions.find((p) => p.account === sp.account && p.symbol === sp.symbol && p.secType === 'STK')?.quantity ?? 0
            const currentTgt = positions.find((p) => p.account === sp.account && p.symbol === targetSymbol && p.secType === 'STK')?.quantity ?? 0
            return {
              account: sp.account,
              sourceSymbol: sp.symbol,
              soldShares: sp.shares,
              targetShares: sp.targetShares,
              originalSourceQty: currentSrc,
              originalTargetQty: currentTgt
            }
          })
          setPendingTransferUpdate({ ops, targetSymbol })
        }}
      />
      <ClosePositionDialog
        open={showCloseDialog}
        onClose={() => setShowCloseDialog(false)}
        selectedPositions={positions.filter((p) => selectedPositions.has(posKey(p)))}
        accounts={accounts}
        positions={positions}
        quotes={quotes}
      />
      <OptionOrderDialog
        open={showOptionOrder}
        onClose={() => setShowOptionOrder(false)}
        accounts={accounts}
        positions={positions}
      />
      <CloseOptionDialog
        open={showCloseOptionDialog}
        onClose={() => setShowCloseOptionDialog(false)}
        selectedPositions={positions.filter((p) => selectedPositions.has(posKey(p)))}
        accounts={accounts}
        positions={positions}
      />
      <CloseGroupDialog
        open={showCloseGroupDialog}
        onClose={() => setShowCloseGroupDialog(false)}
        selectedPositions={positions.filter((p) => selectedPositions.has(posKey(p)))}
        accounts={accounts}
        positions={positions}
        quotes={quotes}
      />

      {/* Context menu for order cancellation */}
      {contextMenu && (
        <div
          className="order-context-menu"
          style={{ position: 'fixed', top: contextMenu.y, left: contextMenu.x, zIndex: 9999 }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div
            className="order-context-menu-item"
            onClick={() => {
              const order = contextMenu.order
              setContextMenu(null)
              window.ibApi
                .cancelOrder(order.orderId)
                .then(() => {
                  console.log('[CANCEL] cancelOrder succeeded')
                  setTimeout(() => refresh?.(), 300)
                  setTimeout(() => refresh?.(), 1000)
                  setTimeout(() => refresh?.(), 2000)
                })
                .catch((err: unknown) => {
                  console.error('[CANCEL] cancelOrder failed:', err)
                  alert('取消委託失敗: ' + String(err))
                })
            }}
          >
            取消委託
          </div>
        </div>
      )}

      {/* AI Advisor Dialog */}
      {showAiAdvisor &&
        (() => {
          const acct = accounts.find((a) => a.accountId === showAiAdvisor)
          return acct ? (
            <AiAdvisorDialog
              open={true}
              onClose={() => setShowAiAdvisor(null)}
              account={acct}
              positions={positions}
              quotes={quotes}
              optionQuotes={optionQuotes}
            />
          ) : null
        })()}

      {/* Add/Edit Group Dialog */}
      <AddGroupDialog
        open={showAddGroup}
        onClose={() => { setShowAddGroup(false); setEditingGroup(null) }}
        positions={positions}
        accounts={accounts}
        onAddGroup={onAddSymbolGroup!}
        editGroup={editingGroup}
        onUpdateGroup={onUpdateSymbolGroup}
      />
    </>
  )
}
