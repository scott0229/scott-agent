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
import RollWatchChunk from './RollWatchChunk'
import ObserveRulesDialog from './ObserveRulesDialog'
import { rollTradingDays, addTradingDays } from '../lib/tradingDays'
import { compareSymbols } from '../lib/symbols'
import {
  getEnabledObserveRules,
  LEAD_HIGH_PCT,
  LEAD_LOW_PCT,
  BREACH_THRESHOLD_PCT
} from '../lib/observeRules'
import TradeGroupDialog from './TradeGroupDialog'
import BatchOrderForm from './BatchOrderForm'
import TransferStockDialog from './TransferStockDialog'
import ClosePositionDialog from './ClosePositionDialog'
import OptionOrderDialog from './OptionOrderDialog'
import CloseOptionDialog from './CloseOptionDialog'
import AddGroupDialog from './AddGroupDialog'
import CloseGroupDialog from './CloseGroupDialog'
import AiAdvisorDialog from './AiAdvisorDialog'
import ReportNoteBox from './ReportNoteBox'

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

function formatAccountName(name: string): string {
  if (!name) return ''
  // 優先抓取類似 origin.568, loan.300, profit.967 的代號
  const aliasMatch = name.match(/([a-zA-Z]+\.\d+)/)
  if (aliasMatch) {
    return aliasMatch[1]
  }

  const match = name.match(/\((.*?)\)/)
  if (match && match[1]) {
    return match[1].trim()
  }
  return name.replace(/\s*\(.*?\)/, '').trim()
}

interface AccountOverviewProps {
  connected: boolean
  accounts: AccountData[]
  positions: PositionData[]
  quotes: Record<string, number>
  optionQuotes: Record<string, number>
  openOrders: OpenOrderData[]
  orderQuotes: Record<string, { bid: number; ask: number }>
  executions: ExecutionDataItem[]
  loading: boolean
  refresh?: () => void
  accountTypes?: Record<string, string>
  returnRates?: Record<string, number | null>
  operationModes?: Record<string, string>
  onSetAccountType?: (accountId: string, type: string) => void
  initialCosts?: Record<string, number>
  // Map of `${ib_account}|${YYYYMMDD}|${strike}|${C|P}` → group_id (e.g. "QQQ-4").
  // Sourced from D1 OPTIONS.group_id; only populated for currently OPEN trades.
  optionGroups?: Record<string, string>
  // Per-account daily-report note from the website (USERS.report_note).
  reportNotes?: Record<string, string>
  // Save handler for in-app edits to USERS.report_note.
  onSetReportNote?: (accountId: string, note: string) => void
  marginLimit?: number
  symbolGroups?: SymbolGroup[]
  onAddSymbolGroup?: (group: SymbolGroup) => void
  onDeleteSymbolGroup?: (groupId: string) => void
  onUpdateSymbolGroup?: (group: SymbolGroup) => void
  onReorderSymbolGroups?: (groups: SymbolGroup[]) => void
  groupViewMode?: boolean
  showOperationMode?: boolean
  showAccountType?: boolean
  d1Target?: 'staging' | 'production'
  // Bumped when risk/observe prefs hydrate from D1, so the observe-rule chunks
  // (which read getEnabledObserveRules synchronously) re-render with synced values.
  prefsVersion?: number
}

const posKey = (pos: PositionData): string =>
  `${pos.account}|${pos.symbol}|${pos.secType}|${pos.expiry || ''}|${pos.strike || ''}|${pos.right || ''}`

// Toolbar filters are kept in MODULE-level memory (not localStorage) so they
// survive tab switches — which unmount/remount this component — but reset when
// the app is closed and reopened (a fresh renderer reloads the module). The
// batch (群組) filters and the 帳戶總覽 filters each get their own store.
interface GroupFilters {
  index: string
  symbol: string
  right: '' | 'C' | 'P' | 'STK'
}
const groupFiltersMemory: GroupFilters = { index: '', symbol: '', right: '' }

interface AccountFilters {
  symbol: string
  account: string
}
// Only the two always-visible filters (標的 / 帳戶) survive; filterRight is tied
// to the transient 選取期權 mode and resets with it.
const accountFiltersMemory: AccountFilters = { symbol: '', account: '' }

// Naked short-CALL detector — mirrors the website daily-trades warning. Per
// underlying, a sold call is "naked" (uncovered) when the contracts you're
// short exceed what you can deliver: shortCalls×100 > shares + longCalls×100.
// Computed from the live IB positions so it stays real-time.
interface NakedCall {
  u: string
  short: number
  long: number
  shares: number
  gap: number
}
function computeNakedCalls(positions: PositionData[], accountId: string): NakedCall[] {
  const calls = new Map<string, { short: number; long: number }>()
  const sharesByU = new Map<string, number>()
  for (const p of positions) {
    if (p.account !== accountId) continue
    if (p.secType === 'OPT' && (p.right === 'C' || p.right === 'CALL')) {
      const e = calls.get(p.symbol) || { short: 0, long: 0 }
      if (p.quantity < 0) e.short += -p.quantity
      else e.long += p.quantity
      calls.set(p.symbol, e)
    } else if (p.secType !== 'OPT') {
      sharesByU.set(p.symbol, (sharesByU.get(p.symbol) || 0) + p.quantity)
    }
  }
  const out: NakedCall[] = []
  for (const [u, { short, long }] of calls) {
    if (short <= 0) continue
    const shares = sharesByU.get(u) || 0
    const gap = short * 100 - (shares + long * 100)
    if (gap > 0) out.push({ u, short, long, shares, gap })
  }
  return out
}

// Trading days until expiry — calendar days minus weekends.
// IB expiry comes as YYYYMMDD; today is local "today" (midnight).
// DTE in trading days from today to the option's expiry — weekends AND US
// market holidays excluded (delegates to the shared holiday-aware helper).
function tradingDaysUntil(expiry: string | undefined): number | null {
  if (!expiry || expiry.length < 8) return null
  const today = new Date()
  const todayYmd = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`
  return rollTradingDays(todayYmd, expiry)
}

const SPEC_MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
]

// Turn an "Jan18" / "Jun22" leg-expiry (year omitted in combo descriptions)
// into YYYYMMDD by inferring the year: use the current year, but if the date
// already passed by more than a month it must belong to next year.
function inferLegYmd(mon: string, day: string): string | null {
  const mIdx = SPEC_MONTHS.indexOf(mon)
  if (mIdx < 0) return null
  const now = new Date()
  let y = now.getFullYear()
  const d = new Date(y, mIdx, parseInt(day, 10))
  if (d.getTime() < now.getTime() - 31 * 86400000) y += 1
  return `${y}${String(mIdx + 1).padStart(2, '0')}${day.padStart(2, '0')}`
}

// Parse a combo description like "+Jun18 716P → -Jun22 716P" into the roll
// spec shown in 委託單: days extended (trading days, source→target) and the
// strike change in points. The BUY (+) leg is the position being closed
// (source); the SELL (-) leg is the new position (target).
function parseRollSpec(
  desc: string | undefined
): { days: number | null; pts: number; right: string } | null {
  if (!desc || !desc.includes('→')) return null
  const legs = desc.split('→').map((s) => s.trim())
  if (legs.length !== 2) return null
  const re = /^([+-])([A-Za-z]{3})(\d+)\s+([\d.]+)([CP])$/
  const m1 = legs[0].match(re)
  const m2 = legs[1].match(re)
  if (!m1 || !m2) return null
  const buy = m1[1] === '+' ? m1 : m2[1] === '+' ? m2 : null
  const sell = m1[1] === '-' ? m1 : m2[1] === '-' ? m2 : null
  if (!buy || !sell) return null
  const srcYmd = inferLegYmd(buy[2], buy[3])
  const tgtYmd = inferLegYmd(sell[2], sell[3])
  const days = srcYmd && tgtYmd ? rollTradingDays(srcYmd, tgtYmd) : null
  const pts = Number(sell[4]) - Number(buy[4])
  return { days, pts, right: sell[5] }
}


export default function AccountOverview({
  connected,
  accounts,
  positions,
  quotes,
  optionQuotes,
  openOrders,
  orderQuotes,
  executions,
  loading,
  refresh,
  accountTypes,
  returnRates,
  operationModes,
  marginLimit = 1.3,
  symbolGroups = [],
  onAddSymbolGroup,
  onDeleteSymbolGroup,
  onUpdateSymbolGroup,
  onReorderSymbolGroups,
  groupViewMode = false,
  prefsVersion = 0,
  initialCosts = {},
  optionGroups = {},
  reportNotes = {},
  onSetReportNote,
  showOperationMode = true,
  showAccountType = true,
  d1Target = 'production'
}: AccountOverviewProps): React.JSX.Element {
  const [sortBy, setSortBy] = useState('netLiquidation')
  const [filterSymbol, setFilterSymbol] = useState(accountFiltersMemory.symbol)
  const [filterAccount, setFilterAccount] = useState(accountFiltersMemory.account)

  // Trade-groups panel data — fetched from the website when the user filters
  // down to one account. Mirrors the /trade-groups page on scott-agent.com.
  type AcctGroupRow = {
    id: number | null
    name: string
    count: number
    startDate: number
    endDate: number
    latestTrade: {
      type: 'CALL' | 'PUT' | 'STK'
      underlying: string
      quantity: number
      strike_price: number | null
      to_date: number | null
      underlying_price: number | null
      operation: string
      is_assigned: boolean
    }
    holdingShares: number
    holdingAvgPrice: number
    netCashInflow: number
    openCostToClose: number
    stockProfit: number
    profit: number
    status: 'Active' | 'Terminated'
  }
  type AcctGroupSummary = {
    totalCash: number
    marginRate: number
    totalProfit: number
  }
  const [accountGroups, setAccountGroups] = useState<AcctGroupRow[] | null>(null)
  const [accountGroupsSummary, setAccountGroupsSummary] = useState<AcctGroupSummary | null>(null)
  const [accountGroupsLoading, setAccountGroupsLoading] = useState(false)
  const [accountGroupsError, setAccountGroupsError] = useState<string | null>(null)

  const [selectMode, setSelectMode] = useState<'STK' | 'OPT' | false>(false)
  const [filterRight, setFilterRight] = useState<'' | 'C' | 'P'>('')
  const [selectedPositions, setSelectedPositions] = useState<Set<string>>(new Set())
  const [showRollDialog, setShowRollDialog] = useState(false)
  // When set, the roll dialog is in 展期觀察 (observe) mode for this group id.
  const [observeGroupId, setObserveGroupId] = useState<string | null>(null)
  // Drag-to-reorder state for 展期觀察 rows: which group + which row is dragging.
  const [watchDrag, setWatchDrag] = useState<{ groupId: string; from: number } | null>(null)
  // When the GO button on a 展期觀察 row fires, pre-select this target in the
  // (real, non-observe) roll dialog.
  const [rollInitialTarget, setRollInitialTarget] = useState<{
    expiry: string
    strike: number
    right: 'C' | 'P'
  } | null>(null)
  const [rollWarnMsg, setRollWarnMsg] = useState<{ title: string; message: string } | null>(
    null
  )
  // 潛在融資 calculation breakdown — populated on right-click of the metric.
  const [marginExplain, setMarginExplain] = useState<{
    name: string
    cash: number
    netLiq: number
    currency: string
    puts: { label: string; notional: number }[]
    putTotal: number
    pct: number | null
  } | null>(null)
  const [deleteGroupConfirm, setDeleteGroupConfirm] = useState<{ id: string; name: string } | null>(
    null
  )
  const [cancelAllConfirm, setCancelAllConfirm] = useState(false)
  const [groupDetailDialog, setGroupDetailDialog] = useState<{
    account: string
    group: string
  } | null>(null)

  const [showBatchOrder, setShowBatchOrder] = useState(false)
  const [ordersCollapsed, setOrdersCollapsed] = useState(false)
  // Same-batch order groups that the user has expanded (keyed by batch
  // signature). A batch placed across many accounts collapses to its first
  // row by default; clicking the ＋ reveals the rest.
  const [expandedBatches, setExpandedBatches] = useState<Set<string>>(new Set())
  const [orderFilterAccount, setOrderFilterAccount] = useState('')
  const [orderFilterSymbol, setOrderFilterSymbol] = useState('')
  const [orderFilterType, setOrderFilterType] = useState<'' | 'STK' | 'CALL' | 'PUT'>('')
  const [orderFilterFill, setOrderFilterFill] = useState<'' | 'filled' | 'unfilled'>('')
  const [showTransferDialog, setShowTransferDialog] = useState(false)
  const [showCloseDialog, setShowCloseDialog] = useState(false)
  const [showOptionOrder, setShowOptionOrder] = useState(false)
  const [showCloseOptionDialog, setShowCloseOptionDialog] = useState(false)
  const [showCloseGroupDialog, setShowCloseGroupDialog] = useState(false)
  const [showAiAdvisor, setShowAiAdvisor] = useState<string | null>(null)
  // Which note editor an "add note" header button has force-opened. Keys are
  // namespaced: `acct:<id>` for account cards, `grp:<id>` for batch cards.
  const [noteEditorFor, setNoteEditorFor] = useState<string | null>(null)
  // Bumped whenever a group note editor changes height (typing) so the masonry
  // layout re-measures the card and grows it live. Stable identity so it
  // doesn't retrigger ReportNoteBox's init effect on every render.
  const [masonryBump, setMasonryBump] = useState(0)
  const bumpMasonry = useCallback(() => setMasonryBump((n) => n + 1), [])
  // Group whose note is currently being edited — its card disables `draggable`
  // so dragging to select note text doesn't start a card reorder.
  const [editingNoteCardId, setEditingNoteCardId] = useState<string | null>(null)
  // Group whose note is currently hovered. Disabling `draggable` BEFORE the
  // mousedown (hover renders well ahead of the click) is what actually lets the
  // browser treat the drag as a text selection rather than a card drag —
  // cancelling dragstart after the fact gives neither drag nor selection.
  const [hoverNoteCardId, setHoverNoteCardId] = useState<string | null>(null)
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null)
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)
  const [showAddGroup, setShowAddGroup] = useState(false)
  const [showObserveRules, setShowObserveRules] = useState(false)
  const [editingGroup, setEditingGroup] = useState<SymbolGroup | null>(null)
  const [filterGroupIndex, setFilterGroupIndex] = useState(groupFiltersMemory.index)
  const [filterGroupSymbol, setFilterGroupSymbol] = useState(groupFiltersMemory.symbol)
  // Group-view option-right filter: '' = all, 'C' = calls only, 'P' = puts only
  const [filterGroupRight, setFilterGroupRight] = useState<'' | 'C' | 'P' | 'STK'>(
    groupFiltersMemory.right
  )

  // Per-group checkbox state: groupId -> Set of checked posKeys
  const [groupChecked, setGroupChecked] = useState<Record<string, Set<string>>>({})
  // Which groups have check mode active (checkboxes visible)
  const [checkModeGroups, setCheckModeGroups] = useState<Set<string>>(new Set())
  // Pending roll update: wait for IB to confirm fill before updating group posKeys
  const [pendingRollUpdate, setPendingRollUpdate] = useState<{
    rolledPositions: PositionData[]
    target: { expiry: string; strike: number; right: 'C' | 'P' }
  } | null>(null)
  // Pending transfer update: wait for IB to confirm fill before updating group posKeys
  const [pendingTransferUpdate, setPendingTransferUpdate] = useState<{
    ops: {
      account: string
      sourceSymbol: string
      soldShares: number
      targetShares: number
      originalSourceQty: number
      originalTargetQty: number
    }[]
    targetSymbol: string
  } | null>(null)

  // Inline editing state: tracks which cell is being edited
  const [editingCell, setEditingCell] = useState<{
    orderId: number
    field: 'quantity' | 'price'
  } | null>(null)
  const [editValue, setEditValue] = useState('')
  const editInputRef = useRef<HTMLInputElement | null>(null)
  const groupGridRef = useRef<HTMLDivElement | null>(null)
  // Defer the single-click action so a follow-up dblclick can cancel it.
  // Without this the card border flashes "selected" on every dblclick.
  const cardClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Track the first-seen timestamp for each open order so we can sort the
  // committee list by "submission time". IB's permId is the canonical key
  // but it's 0 for orders we haven't seen acknowledged yet (very common on
  // BAG combo rolls right after submission), so fall back to orderId. This
  // ref is per-mount, which is fine — re-mount happens only on reconnect.
  const orderSeenAtRef = useRef<Map<string, number>>(new Map())
  // True when the current mousedown landed inside a group card's note, so the
  // card's dragstart can be cancelled and the user can drag-select note text
  // instead of moving the card. Set in capture phase (before the note's own
  // stopPropagation), read in onDragStart.
  const dragFromNoteRef = useRef(false)
  // True while a note editor has an active IME composition. The masonry reflow
  // must pause while this is set — reflowing the grid mid-composition drops the
  // candidate window (the 注音 selection bug).
  const noteComposingRef = useRef(false)
  // Context menu state for order cancellation
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    order: OpenOrderData
  } | null>(null)
  // Context menu state for option positions
  const [optContextMenu, setOptContextMenu] = useState<{
    x: number
    y: number
    pos: PositionData
  } | null>(null)
  const [stkContextMenu, setStkContextMenu] = useState<{
    x: number
    y: number
    pos: PositionData
  } | null>(null)
  const [optOrderInitialSymbol, setOptOrderInitialSymbol] = useState('QQQ')
  const [optOrderInitialAccountId, setOptOrderInitialAccountId] = useState<string | undefined>(
    undefined
  )
  const [optOrderInitialRight, setOptOrderInitialRight] = useState<'C' | 'P' | undefined>(undefined)
  // Toggle: false = separate STK/OPT sections, true = grouped by underlying symbol
  const [acctViewBySymbol, setAcctViewBySymbol] = useState(false)

  // Reset all filters and selections on reconnect
  useEffect(() => {
    setFilterSymbol('')
    setFilterAccount('')
    setFilterRight('')
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

  // Stamp every order's first-seen time so the sort can pin newest on top.
  // Permanent permId is preferred; fall back to orderId for combo BAG orders
  // that haven't been acknowledged yet (their permId is still 0).
  useEffect(() => {
    const seen = orderSeenAtRef.current
    const now = Date.now()
    let assigned = 0
    for (const o of openOrders) {
      const key = o.permId > 0 ? `p:${o.permId}` : `o:${o.orderId}`
      if (!seen.has(key)) {
        // Spread initial mounts across 1ms slots so a fresh fetch keeps
        // IB's reported order (latest-first from setOpenOrders prepend),
        // and freshly-streamed orders later naturally sort above old ones.
        seen.set(key, now + assigned++)
      }
    }
  }, [openOrders])

  // Reset only the transient selection state when switching between 帳戶總覽 /
  // 批次交易 tabs. Both tabs' toolbar filters deliberately persist (remembered
  // across tab switches and app reopen via localStorage).
  useEffect(() => {
    setFilterRight('')
    setSelectMode(false)
    setSelectedPositions(new Set())
    setGroupChecked({})
    setCheckModeGroups(new Set())
  }, [groupViewMode])

  // Mirror the batch-trading group filters into module memory so they survive
  // a tab-switch unmount (but not an app restart).
  useEffect(() => {
    groupFiltersMemory.index = filterGroupIndex
    groupFiltersMemory.symbol = filterGroupSymbol
    groupFiltersMemory.right = filterGroupRight
  }, [filterGroupIndex, filterGroupSymbol, filterGroupRight])

  // Same for the 帳戶總覽 filters (the two always-visible ones).
  useEffect(() => {
    accountFiltersMemory.symbol = filterSymbol
    accountFiltersMemory.account = filterAccount
  }, [filterSymbol, filterAccount])

  // Resolve the filter target into a string alias. Memoising the *string*
  // means the effect below skips re-fires when accounts gets a new array
  // reference but the alias text is unchanged (IB pushes a tick → new
  // accounts ref → same alias).
  //
  // Guard: only emit an alias matching `name.digits` (the USERS.user_id
  // shape, e.g. "adair.600"). When IB hasn't streamed the alias yet,
  // acct.alias is empty and we'd fall through to acct.accountId (raw
  // "U1234567") which the server can't resolve → flashes 404. Returning
  // '' here suppresses the fetch until a real alias lands.
  const filteredAlias = useMemo(() => {
    if (!filterAccount) return ''
    const acct = accounts.find((a) => a.accountId === filterAccount)
    if (!acct) return ''
    const candidate = formatAccountName(acct.alias || acct.accountId)
    return /^[a-zA-Z]+\.\d+$/.test(candidate) ? candidate : ''
  }, [filterAccount, accounts])

  // Fetch the website's 交易群組 aggregation when the user filters down to one
  // account. Cleared whenever the filter is empty or the view changes.
  useEffect(() => {
    if (groupViewMode || !filteredAlias) {
      setAccountGroups(null)
      setAccountGroupsSummary(null)
      setAccountGroupsError(null)
      setAccountGroupsLoading(false)
      return
    }
    let cancelled = false
    setAccountGroupsLoading(true)
    setAccountGroupsError(null)
    const year = new Date().getFullYear()
    window.ibApi
      .getAccountGroups(filteredAlias, year, d1Target)
      .then((res) => {
        if (cancelled) return
        if (res.error) {
          setAccountGroupsError(res.error)
          setAccountGroups([])
          setAccountGroupsSummary(null)
        } else {
          setAccountGroups((res.groups as AcctGroupRow[]) || [])
          setAccountGroupsSummary((res.summary as AcctGroupSummary) || null)
        }
      })
      .catch((err) => {
        if (cancelled) return
        setAccountGroupsError(err instanceof Error ? err.message : '讀取失敗')
        setAccountGroups([])
        setAccountGroupsSummary(null)
      })
      .finally(() => {
        if (!cancelled) setAccountGroupsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [filteredAlias, d1Target, groupViewMode])

  // Compute positions not belonging to any group
  const uncategorizedPositions = useMemo(() => {
    if (!groupViewMode) return []
    const allGroupedKeys = new Set<string>()
    symbolGroups.forEach((g) => {
      if (g.autoParams) {
        positions.forEach((p) => {
          const symbolMatch = g.autoParams!.symbols.includes(p.symbol)
          if (symbolMatch) {
            const rights = g.autoParams!.rights || (g.autoParams!.right ? [g.autoParams!.right] : [])
            const rightMatch =
              (rights.includes('STK') && p.secType === 'STK') ||
              (rights.includes('C') && p.secType === 'OPT' && (p.right === 'C' || p.right === 'CALL')) ||
              (rights.includes('P') && p.secType === 'OPT' && (p.right === 'P' || p.right === 'PUT'))
            const accountMatch =
              g.autoParams!.accounts && g.autoParams!.accounts.includes(p.account)

            if (rightMatch && accountMatch) {
              allGroupedKeys.add(posKey(p))
            }
          }
        })
      } else {
        g.posKeys.forEach((k) => allGroupedKeys.add(k))
      }
    })
    return positions
      .filter((p) => !allGroupedKeys.has(posKey(p)))
      .sort((a, b) => {
        if (a.secType !== b.secType) return a.secType === 'STK' ? -1 : 1
        if (a.secType === 'OPT' && b.secType === 'OPT') {
          if (a.symbol !== b.symbol) return a.symbol.localeCompare(b.symbol)
          const rightA = a.right === 'P' || a.right === 'PUT' ? 'P' : 'C'
          const rightB = b.right === 'P' || b.right === 'PUT' ? 'P' : 'C'
          if (rightA !== rightB) return rightB.localeCompare(rightA)
          const aAlias = formatAccountName(accounts.find((x) => x.accountId === a.account)?.alias || a.account)
          const bAlias = formatAccountName(accounts.find((x) => x.accountId === b.account)?.alias || b.account)
          if (aAlias !== bAlias) return aAlias.localeCompare(bAlias)
          const expiryComp = (a.expiry || '').localeCompare(b.expiry || '')
          if (expiryComp !== 0) return expiryComp
          return (a.strike || 0) - (b.strike || 0)
        }
        if (a.symbol !== b.symbol) return a.symbol.localeCompare(b.symbol)
        const aAlias = formatAccountName(accounts.find((x) => x.accountId === a.account)?.alias || a.account)
        const bAlias = formatAccountName(accounts.find((x) => x.accountId === b.account)?.alias || b.account)
        return aAlias.localeCompare(bAlias)
      })
  }, [groupViewMode, symbolGroups, positions, accounts])

  // Masonry layout: measure each card and set grid-row span
  // Only recalculate when actual data changes (not on every poll-triggered render)
  const masonryKey = useMemo(() => {
    if (!groupViewMode) return ''
    const groupPart = symbolGroups
      .map((g) => {
        const groupPosKeys = new Set(g.posKeys)
        const count = positions.filter((p) => {
          if (g.autoParams) {
            const symbolMatch = g.autoParams.symbols.includes(p.symbol)
            if (!symbolMatch) return false
            const rights = g.autoParams.rights || (g.autoParams.right ? [g.autoParams.right] : [])
            const rightMatch =
              p.secType === 'STK' ||
              (rights.includes('C') && p.secType === 'OPT' && (p.right === 'C' || p.right === 'CALL')) ||
              (rights.includes('P') && p.secType === 'OPT' && (p.right === 'P' || p.right === 'PUT'))
            if (!rightMatch) return false
            const accountMatch = g.autoParams.accounts && g.autoParams.accounts.includes(p.account)
            return !!accountMatch
          }
          return groupPosKeys.has(posKey(p))
        }).length
        // Include the note (its length) and the 展期觀察 target so the card
        // re-measures when either is added/edited/removed — otherwise
        // overflow:hidden clips the extra row.
        const rwArr = Array.isArray(g.rollWatch)
          ? g.rollWatch
          : g.rollWatch
            ? [g.rollWatch]
            : []
        const rw = rwArr.map((w) => `${w.expiry}:${w.strike}${w.right}`).join(',')
        return `${g.id}:${count}:n${(g.note || '').length}:rw${rw}`
      })
      .join('|')
    // NOTE: checkModeGroups intentionally NOT in masonryKey. Toggling check
    // mode only adds a 14px-wide checkbox column, not card height — so
    // re-running the masonry collapse/expand on every toggle is wasted work
    // and (more importantly) caused the page to snap to top because all
    // cards briefly collapsed to 1 row during the recompute.
    return `${groupPart}|uncategorized:${uncategorizedPositions.length}|fgi:${filterGroupIndex}|fgs:${filterGroupSymbol}|fgr:${filterGroupRight}|edit:${noteEditorFor || ''}|pv:${prefsVersion}`
  }, [
    groupViewMode,
    symbolGroups,
    positions,
    prefsVersion,
    uncategorizedPositions,
    filterGroupIndex,
    filterGroupSymbol,
    filterGroupRight,
    noteEditorFor
  ])

  useEffect(() => {
    const grid = groupGridRef.current
    if (!grid || !groupViewMode) return
    const rafId = requestAnimationFrame(() => {
      // Never reflow the grid while a note is being composed — it orphans the
      // IME candidate window. The compositionend bump re-runs this afterwards.
      if (noteComposingRef.current) return
      const rowHeight = 10
      const rowGap = 6
      const spanFor = (h: number): number => Math.ceil((h + rowGap) / (rowHeight + rowGap))
      // Preserve scroll across the reflow. Resetting every card's gridRowEnd
      // below momentarily collapses the grid; the forced reflow then makes the
      // browser clamp the page scroll to the now-shorter document, so when a
      // live position/price update retriggers this effect the page jumps to the
      // top. Capture the active scroller now, restore it after the final spans.
      let scrollAncestor: HTMLElement | null = grid.parentElement
      while (scrollAncestor) {
        const oy = getComputedStyle(scrollAncestor).overflowY
        if (
          (oy === 'auto' || oy === 'scroll') &&
          scrollAncestor.scrollHeight > scrollAncestor.clientHeight
        )
          break
        scrollAncestor = scrollAncestor.parentElement
      }
      const scroller: Element =
        scrollAncestor ?? document.scrollingElement ?? document.documentElement
      const savedScrollTop = scroller.scrollTop
      // The card that currently holds the focused note editor must NOT be
      // collapsed/reflowed — doing so mid-IME-composition drops the candidate
      // window. We only grow it; it settles fully on edit end.
      const activeEl = document.activeElement
      const activeCard =
        activeEl instanceof HTMLElement && activeEl.classList.contains('report-note-editor')
          ? activeEl.closest<HTMLElement>('.account-card')
          : null
      const cards = grid.querySelectorAll<HTMLElement>('.account-card')
      cards.forEach((card) => {
        if (card === activeCard) return
        card.style.gridRowEnd = ''
      })
      void grid.offsetHeight
      cards.forEach((card) => {
        if (card === activeCard) {
          // Grow-only, no reset: keeps the textarea/IME stable while typing.
          const current = parseInt(card.style.gridRowEnd.replace(/\D/g, ''), 10) || 0
          const span = spanFor(card.scrollHeight)
          if (span > current) card.style.gridRowEnd = `span ${span}`
          return
        }
        card.style.gridRowEnd = `span ${spanFor(card.scrollHeight)}`
      })
      // Final layout is back to full height — pin the scroll back so the reflow
      // is invisible to the user (all of this runs in one frame before paint).
      if (scroller.scrollTop !== savedScrollTop) scroller.scrollTop = savedScrollTop
    })
    return () => cancelAnimationFrame(rafId)
  }, [groupViewMode, masonryKey, masonryBump])

  // Recompute the masonry when rows are added/removed inside any card — e.g.
  // the default-rule 觀察 rows appearing after the rules are toggled, or async
  // greek/spread content arriving. A card-level ResizeObserver can't catch
  // this: overflow:hidden + a fixed grid-row span locks the card's box size,
  // so its content can grow (and get clipped) without the box ever resizing.
  // MutationObserver(childList) fires on the DOM node add/remove instead.
  useEffect(() => {
    const grid = groupGridRef.current
    if (!grid || !groupViewMode) return
    let raf = 0
    const mo = new MutationObserver(() => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        if (!noteComposingRef.current) bumpMasonry()
      })
    })
    mo.observe(grid, { childList: true, subtree: true })
    return () => {
      cancelAnimationFrame(raf)
      mo.disconnect()
    }
  }, [groupViewMode, masonryKey, bumpMasonry])

  // Watch positions: when pending roll's new positions appear,
  // update group posKeys using the actual new posKey reported by IB.
  // NOTE: We no longer require old positions to disappear first, because with
  // partial fills the old posKey stays present (reduced qty) since posKey
  // doesn't include quantity.
  useEffect(() => {
    if (!pendingRollUpdate) return
    const { rolledPositions, target } = pendingRollUpdate

    // Resolve whatever new positions have appeared so far and apply each
    // old→new replacement INCREMENTALLY. The old code bailed ("return") if ANY
    // leg's new position hadn't arrived yet — so when a multi-account roll
    // filled at staggered times, the already-closed legs left their group
    // matching nothing ("無匹配持倉"), and a single never-matching leg stranded
    // the whole group permanently. Now each leg updates the moment it fills and
    // laggards no longer hold up the rest.
    const replacements = new Map<string, string>()
    const stillPending: PositionData[] = []
    for (const oldPos of rolledPositions) {
      const newPos = positions.find(
        (p) =>
          p.account === oldPos.account &&
          p.symbol === oldPos.symbol &&
          p.secType === 'OPT' &&
          p.expiry === target.expiry &&
          p.strike === target.strike &&
          (p.right === target.right || p.right === (target.right === 'C' ? 'CALL' : 'PUT'))
      )
      if (newPos) replacements.set(posKey(oldPos), posKey(newPos))
      else stillPending.push(oldPos)
    }

    if (replacements.size > 0) {
      const repl = Object.fromEntries(replacements)
      console.log('[ROLL] Applying posKey replacements', repl)
      window.ibApi.debugLog('[ROLL] applying ' + JSON.stringify(repl))
      for (const g of symbolGroups) {
        if (g.autoParams) continue
        if (!g.posKeys.some((k) => replacements.has(k))) continue
        const newPosKeys = g.posKeys.map((k) => replacements.get(k) ?? k)
        const finalPosKeys = Array.from(new Set(newPosKeys))
        if (
          finalPosKeys.length !== g.posKeys.length ||
          finalPosKeys.some((k, i) => k !== g.posKeys[i])
        ) {
          onUpdateSymbolGroup?.({ ...g, posKeys: finalPosKeys })
        }
      }
    }

    // Diagnostic: if legs stay unmatched the group is left pinned to its old
    // (now-closed) contracts and shows "無匹配持倉". Log exactly which leg's new
    // contract hasn't shown up in `positions` and what target we're hunting, so
    // a recurrence is debuggable instead of a silent empty batch.
    if (stillPending.length > 0) {
      const diag = {
        target,
        pending: stillPending.map(
          (p) => `${p.account}|${p.symbol}|${p.expiry}|${p.strike}|${p.right}`
        ),
        // What IB actually reports right now for those account+symbol OPT
        // positions — compare to `target` to see which field (expiry / strike /
        // right) doesn't line up so the new leg is never matched.
        candidates: stillPending.flatMap((op) =>
          positions
            .filter(
              (p) => p.account === op.account && p.symbol === op.symbol && p.secType === 'OPT'
            )
            .map(
              (p) => `${p.account}|${p.symbol}|${p.expiry}|${p.strike}|${p.right}|q${p.quantity}`
            )
        ),
        // The affected group(s)' currently-stored posKeys, to confirm whether
        // they still point at the old (closed) contract.
        affectedGroups: symbolGroups
          .filter(
            (g) =>
              !g.autoParams &&
              g.posKeys.some((k) => stillPending.some((op) => posKey(op) === k))
          )
          .map((g) => ({ name: g.name, posKeys: g.posKeys }))
      }
      console.warn('[ROLL] Legs still unmatched — 無匹配持倉 until resolved', diag)
      window.ibApi.debugLog('[ROLL] unmatched ' + JSON.stringify(diag))
    }

    // Done once every leg resolved; otherwise keep only the laggards pending so
    // they're retried (without reprocessing the resolved ones) on the next
    // position update.
    if (stillPending.length === 0) {
      setPendingRollUpdate(null)
    } else if (stillPending.length !== rolledPositions.length) {
      setPendingRollUpdate({ rolledPositions: stillPending, target })
    }
  }, [positions, pendingRollUpdate, symbolGroups, onUpdateSymbolGroup])

  // Diagnostic: a non-auto batch card that resolves to ZERO matching positions is
  // the visible "展期後卡牌被清空 / 認不出新交易" symptom — its stored posKeys still
  // point at the old (now-closed) contract while the new leg sits under a posKey
  // the group never picked up. The [ROLL] effect above only logs while a
  // pendingRollUpdate is active; this catches the empty state however it arose
  // (settings revert, a post-roll position refresh, a never-matched leg). Logged
  // once per (group, posKeys) so it doesn't spam every render; re-armed when the
  // card fills again or its posKeys change.
  const emptyCardLogged = useRef<Map<string, string>>(new Map())
  useEffect(() => {
    if (!positions.length) return
    const stillEmpty = new Set<string>()
    for (const g of symbolGroups) {
      if (g.autoParams || !g.posKeys.length) continue
      const matched = positions.filter((p) => g.posKeys.includes(posKey(p)))
      if (matched.length > 0) {
        emptyCardLogged.current.delete(g.id)
        continue
      }
      stillEmpty.add(g.id)
      const sig = g.posKeys.join(',')
      if (emptyCardLogged.current.get(g.id) === sig) continue
      emptyCardLogged.current.set(g.id, sig)
      // What IB actually reports for the account+symbol(s) this card points at —
      // compare to posKeys to see which contract the stored key still references.
      const wantAcctSym = new Set(g.posKeys.map((k) => k.split('|').slice(0, 2).join('|')))
      const candidates = positions
        .filter((p) => wantAcctSym.has(`${p.account}|${p.symbol}`))
        .map(
          (p) =>
            `${p.account}|${p.symbol}|${p.secType}|${p.expiry || ''}|${p.strike || ''}|${p.right || ''}|q${p.quantity}`
        )
      const diag = { group: g.name, id: g.id, posKeys: g.posKeys, candidates }
      console.warn('[CARD] emptied — 0 matching positions', diag)
      window.ibApi.debugLog('[CARD] emptied ' + JSON.stringify(diag))
    }
    for (const id of Array.from(emptyCardLogged.current.keys())) {
      if (!stillEmpty.has(id)) emptyCardLogged.current.delete(id)
    }
  }, [positions, symbolGroups])

  // Watch positions: when pending transfer changes are confirmed, update group posKeys
  useEffect(() => {
    if (!pendingTransferUpdate) return
    const { ops, targetSymbol } = pendingTransferUpdate

    // 1. Wait for IB positions to reflect the expected quantity changes
    for (const op of ops) {
      const currentSrc =
        positions.find(
          (p) => p.account === op.account && p.symbol === op.sourceSymbol && p.secType === 'STK'
        )?.quantity ?? 0
      const currentTgt =
        positions.find(
          (p) => p.account === op.account && p.symbol === targetSymbol && p.secType === 'STK'
        )?.quantity ?? 0

      // Source quantity should decrease by at least soldShares
      if (currentSrc > op.originalSourceQty - op.soldShares) return

      // Target quantity should increase by exactly targetShares
      if (op.targetShares > 0 && currentTgt < op.originalTargetQty + op.targetShares) return
    }

    // 2. Conditions met. Apply group updates.
    // Build vanished keys (where stock went to 0)
    const vanishedKeys = new Set<string>()
    for (const op of ops) {
      const currentSrc =
        positions.find(
          (p) => p.account === op.account && p.symbol === op.sourceSymbol && p.secType === 'STK'
        )?.quantity ?? 0
      if (currentSrc === 0) {
        vanishedKeys.add(`${op.account}|${op.sourceSymbol}|STK|||`)
      }
    }

    for (const g of symbolGroups) {
      if (g.autoParams) continue
      // Find ops that apply to this group (i.e. group holds the source stock limit)
      const opsInGroup = ops.filter((op) =>
        g.posKeys.includes(`${op.account}|${op.sourceSymbol}|STK|||`)
      )
      if (opsInGroup.length === 0) continue

      const newKeys = g.posKeys.filter((k) => !vanishedKeys.has(k))
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

  useEffect(() => {
    if (!optContextMenu) return undefined
    const handler = (): void => setOptContextMenu(null)
    const id = requestAnimationFrame(() => {
      window.addEventListener('mousedown', handler)
    })
    return () => {
      cancelAnimationFrame(id)
      window.removeEventListener('mousedown', handler)
    }
  }, [optContextMenu])

  useEffect(() => {
    if (!stkContextMenu) return undefined
    const handler = (): void => setStkContextMenu(null)
    const id = requestAnimationFrame(() => {
      window.addEventListener('mousedown', handler)
    })
    return () => {
      cancelAnimationFrame(id)
      window.removeEventListener('mousedown', handler)
    }
  }, [stkContextMenu])

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
    (
      order: OpenOrderData,
      field: 'quantity' | 'price',
      value: string,
      // When the collapsed batch row is edited, apply a PRICE change to every
      // order in the batch (each keeps its own quantity). Quantity edits stay
      // per-order.
      batchOrders?: OpenOrderData[]
    ) => {
      const val = parseFloat(value)
      if (isNaN(val)) {
        cancelEdit()
        return
      }
      // Quantity must be positive; price can be negative for combo (BAG) orders
      if (field === 'quantity' && val <= 0) {
        cancelEdit()
        return
      }

      const applyModify = (o: OpenOrderData): Promise<void> =>
        window.ibApi.modifyOrder({
          orderId: o.orderId,
          account: o.account,
          symbol: o.symbol,
          secType: o.secType,
          action: o.action,
          orderType: o.orderType,
          quantity: field === 'quantity' ? val : o.quantity,
          limitPrice: field === 'price' ? val : (o.limitPrice ?? 0),
          expiry: o.expiry,
          strike: o.strike,
          right: o.right,
          comboLegs: o.comboLegs
        })

      const targets =
        field === 'price' && batchOrders && batchOrders.length > 0 ? batchOrders : [order]
      console.log('[EDIT] submitting modify for', targets.length, 'order(s):', { field, val })
      Promise.all(targets.map(applyModify))
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
      setFilterRight('')
    } else {
      setSelectedPositions(new Set())
      setSelectMode(mode)
      setFilterRight('')
      // Reset by-symbol view since select mode only works in category view
      setAcctViewBySymbol(false)
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

  const attemptRoll = (rollPositions?: PositionData[]): void => {
    const targets =
      rollPositions ?? positions.filter((p) => selectedPositions.has(posKey(p)))
    const strikes = targets
      .filter((p) => p.secType === 'OPT')
      .map((p) => p.strike)
      .filter((s): s is number => typeof s === 'number' && s > 0)
    if (strikes.length >= 2) {
      const min = Math.min(...strikes)
      const max = Math.max(...strikes)
      const spread = (max - min) / min
      if (spread > 0.01) {
        setRollWarnMsg({
          title: '無法展期',
          message: `所選期權行權價差距 ${(spread * 100).toFixed(1)}%（${min} ~ ${max}）超過 1%，請分開選擇後再展期。`
        })
        return
      }
    }
    if (rollPositions) {
      setSelectedPositions(new Set(rollPositions.map((p) => posKey(p))))
    }
    setRollInitialTarget(null)
    setShowRollDialog(true)
  }

  const uniqueSymbols = useMemo(() => {
    const set = new Set<string>()
    positions.forEach((p) => set.add(p.symbol))
    return Array.from(set).sort(compareSymbols)
  }, [positions])

  const uniqueAccounts = useMemo(() => {
    return accounts
      .map((a) => ({
        value: a.accountId,
        label: formatAccountName(a.alias || a.accountId)
      }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [accounts])

  // Classify an order into STK / CALL / PUT for the type filter. BAG combo
  // orders don't carry a `right` field, so for those we peek at the combo
  // description (e.g. "QQQ +Jun11 721P → -Jun12 721P") to recover the side.
  const getOrderType = (o: OpenOrderData): 'STK' | 'CALL' | 'PUT' | 'OTHER' => {
    if (o.secType === 'STK') return 'STK'
    if (o.right === 'C' || o.right === 'CALL') return 'CALL'
    if (o.right === 'P' || o.right === 'PUT') return 'PUT'
    if (o.comboDescription) {
      const m = o.comboDescription.match(/\d+([CP])\b/)
      if (m) return m[1] === 'C' ? 'CALL' : 'PUT'
    }
    return 'OTHER'
  }

  // Cascading filters: each filter's option list reflects what's actually
  // selectable given the OTHER two filters. Picking PUT in the type filter
  // will collapse the account filter to only accounts with PUT orders, etc.
  const orderAccountOptions = useMemo(() => {
    const visible = openOrders.filter((o) => {
      if (orderFilterSymbol && o.symbol !== orderFilterSymbol) return false
      if (orderFilterType && getOrderType(o) !== orderFilterType) return false
      return true
    })
    const ids = new Set(visible.map((o) => o.account))
    const opts = Array.from(ids)
      .map((id) => {
        const acct = accounts.find((a) => a.accountId === id)
        return { value: id, label: formatAccountName(acct?.alias || id) }
      })
      .sort((a, b) => a.label.localeCompare(b.label))
    return [{ value: '', label: '全部帳戶' }, ...opts]
  }, [openOrders, accounts, orderFilterSymbol, orderFilterType])

  // Single-account mode: when the positions view is pinned to one account (the
  // ‹ › stepper at the top), the 委託單 card defaults to that same account so
  // both views line up. Only reacts to the top filter changing, so a manual
  // orders-filter pick afterwards is preserved.
  useEffect(() => {
    setOrderFilterAccount(filterAccount)
  }, [filterAccount])

  const orderSymbolOptions = useMemo(() => {
    const visible = openOrders.filter((o) => {
      if (orderFilterAccount && o.account !== orderFilterAccount) return false
      if (orderFilterType && getOrderType(o) !== orderFilterType) return false
      return true
    })
    const syms = new Set<string>()
    for (const o of visible) if (o.symbol) syms.add(o.symbol)
    const opts = Array.from(syms)
      .sort(compareSymbols)
      .map((s) => ({ value: s, label: s }))
    return [{ value: '', label: '全部標的' }, ...opts]
  }, [openOrders, orderFilterAccount, orderFilterType])

  const orderTypeOptions = useMemo(() => {
    const visible = openOrders.filter((o) => {
      if (orderFilterAccount && o.account !== orderFilterAccount) return false
      if (orderFilterSymbol && o.symbol !== orderFilterSymbol) return false
      return true
    })
    const present = new Set<string>()
    for (const o of visible) present.add(getOrderType(o))
    const opts: { value: string; label: string }[] = []
    if (present.has('STK')) opts.push({ value: 'STK', label: '股票' })
    if (present.has('CALL')) opts.push({ value: 'CALL', label: 'CALL' })
    if (present.has('PUT')) opts.push({ value: 'PUT', label: 'PUT' })
    return [{ value: '', label: '全部類型' }, ...opts]
  }, [openOrders, orderFilterAccount, orderFilterSymbol])

  const filteredOpenOrders = useMemo(() => {
    return openOrders.filter((o) => {
      if (orderFilterAccount && o.account !== orderFilterAccount) return false
      if (orderFilterSymbol && o.symbol !== orderFilterSymbol) return false
      if (orderFilterType) {
        if (getOrderType(o) !== orderFilterType) return false
      }
      if (orderFilterFill === 'filled' && (o.filled ?? 0) === 0) return false
      if (orderFilterFill === 'unfilled' && (o.filled ?? 0) > 0) return false
      return true
    })
  }, [
    openOrders,
    orderFilterAccount,
    orderFilterSymbol,
    orderFilterType,
    orderFilterFill
  ])

  const getPositionsForAccount = (accountId: string): PositionData[] => {
    return positions
      .filter((p) => p.account === accountId)
      .filter((p) => !filterSymbol || p.symbol === filterSymbol)
      .filter(
        (p) =>
          !filterRight ||
          p.secType !== 'OPT' ||
          p.right === filterRight ||
          p.right === (filterRight === 'C' ? 'CALL' : 'PUT')
      )

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
      const fullYear = parseInt(pos.expiry.substring(0, 4))
      const yy = pos.expiry.substring(2, 4)
      const month = months[parseInt(pos.expiry.substring(4, 6)) - 1]
      const day = pos.expiry.substring(6, 8)
      const numStrike = Number(pos.strike) || 0
      const strike = Number.isInteger(numStrike) ? numStrike.toString() : numStrike.toFixed(1)
      const right = pos.right === 'C' || pos.right === 'CALL' ? 'C' : 'P'
      // Drop the 'YY suffix when the contract expires this year — it's the
      // common case and the year just adds noise.
      const exp =
        fullYear === new Date().getFullYear() ? `${month}${day}` : `${month}${day}'${yy}`
      return `${pos.symbol} ${exp} ${strike}${right}`
    }
    return pos.symbol
  }

  // Strike-distance suffix for a short option — only shown in the batch-trade
  // group cards. ITM (breached) → "落後 N" red; OTM (winning) → "領先 N" green.
  const strikeDistanceLabel = (pos: PositionData): { text: string; color: string } | null => {
    if (pos.secType !== 'OPT' || pos.strike == null || !pos.right) return null
    const px = quotes[pos.symbol]
    if (px == null || px <= 0) return null
    const right = pos.right === 'C' || pos.right === 'CALL' ? 'C' : 'P'
    const strike = Number(pos.strike) || 0
    // behind > 0 = how far ITM (price past strike); behind < 0 = how far OTM.
    const behind = right === 'C' ? px - strike : strike - px
    if (behind === 0) return null
    const mag = Math.abs(behind)
    const n = Number.isInteger(mag) ? `${mag}` : mag.toFixed(1)
    const pct = ((mag / px) * 100).toFixed(1)
    return behind > 0
      ? { text: ` (落後 ${n}, ${pct}%)`, color: '#c0392b' }
      : { text: ` (領先 ${n}, ${pct}%)`, color: '#1a6b3a' }
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
    if (sortBy === 'alpha') {
      const aName = formatAccountName(a.alias || a.accountId)
      const bName = formatAccountName(b.alias || b.accountId)
      return aName.localeCompare(bName)
    }
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
    if (sortBy === 'returnRate') {
      const aRate = returnRates?.[a.accountId] ?? -Infinity
      const bRate = returnRates?.[b.accountId] ?? -Infinity
      return bRate - aRate
    }
    return b.totalCashValue - a.totalCashValue
  })

  // Filter accounts: when filters are active, only show accounts with matching positions
  const displayAccounts = sortedAccounts.filter((a) => {
    // User filter: only show the selected account
    if (filterAccount && a.accountId !== filterAccount) return false
    let acctPositions = positions.filter((p) => p.account === a.accountId)
    if (filterSymbol) acctPositions = acctPositions.filter((p) => p.symbol === filterSymbol)
    if (selectMode === 'STK') acctPositions = acctPositions.filter((p) => p.secType !== 'OPT')
    if (selectMode === 'OPT') acctPositions = acctPositions.filter((p) => p.secType === 'OPT')
    if (filterRight)
      acctPositions = acctPositions.filter(
        (p) =>
          p.secType !== 'OPT' ||
          p.right === filterRight ||
          p.right === (filterRight === 'C' ? 'CALL' : 'PUT')
      )
    if (filterSymbol || selectMode || filterRight) return acctPositions.length > 0
    return true
  })

  // Precompute 裸賣 CALL warnings per account once (reused by the card render),
  // then float accounts that have one to the FRONT of the grid — a stable
  // partition that keeps the chosen sort order within each half.
  const nakedByAccount = new Map<string, NakedCall[]>()
  for (const a of displayAccounts) {
    const n = computeNakedCalls(positions, a.accountId)
    if (n.length > 0) nakedByAccount.set(a.accountId, n)
  }
  const orderedAccounts =
    !selectMode && nakedByAccount.size > 0
      ? [
          ...displayAccounts.filter((a) => nakedByAccount.has(a.accountId)),
          ...displayAccounts.filter((a) => !nakedByAccount.has(a.accountId))
        ]
      : displayAccounts

  const cancelOrder = (orderId: number): void => {
    window.ibApi
      .cancelOrder(orderId)
      .then(() => {
        setTimeout(() => refresh?.(), 300)
        setTimeout(() => refresh?.(), 1000)
        setTimeout(() => refresh?.(), 2000)
      })
      .catch((err: unknown) => {
        alert('取消委託失敗: ' + String(err))
      })
  }

  // Cancel a whole batch at once (used by the collapsed batch row). Fires all
  // cancels in parallel, then refreshes once.
  const cancelOrders = (orderIds: number[]): void => {
    if (orderIds.length === 0) return
    Promise.allSettled(orderIds.map((id) => window.ibApi.cancelOrder(id))).then((results) => {
      const failed = results.filter((r) => r.status === 'rejected').length
      if (failed > 0) alert(`取消委託失敗 (${failed}/${orderIds.length})`)
      setTimeout(() => refresh?.(), 300)
      setTimeout(() => refresh?.(), 1000)
      setTimeout(() => refresh?.(), 2000)
    })
  }

  // Render one open-order row for the consolidated 委託單 card. First column is
  // the account name; quantity & price stay double-click editable.
  const renderOrderRow = (
    order: OpenOrderData,
    batchToggle?: {
      count: number
      collapsed: boolean
      onToggle: () => void
      orders: OpenOrderData[]
    }
  ): React.ReactNode => {
    const arrow = <span style={{ color: '#956b3a', margin: '0 3px' }}>→</span>
    const acctName = formatAccountName(
      accounts.find((a) => a.accountId === order.account)?.alias || order.account
    )
    const desc: React.ReactNode =
      order.secType === 'OPT' ? (
        formatOptionLabel(order.symbol, order.expiry, order.strike, order.right)
      ) : order.secType === 'BAG' && order.comboDescription ? (
        <>
          {order.symbol}{' '}
          {order.comboDescription
            .split(' → ')
            // Always show the BUY (+, 買回) leg first, then the SELL (-) leg.
            .slice()
            .sort((a, b) => {
              const aBuy = a.trim().startsWith('+')
              const bBuy = b.trim().startsWith('+')
              return aBuy === bBuy ? 0 : aBuy ? -1 : 1
            })
            .map((p, i) => (
              <React.Fragment key={i}>
                {i > 0 && arrow}
                <span style={{ whiteSpace: 'nowrap' }}>{p}</span>
              </React.Fragment>
            ))}
        </>
      ) : (
        order.symbol
      )
    const editingQty =
      editingCell?.orderId === order.orderId && editingCell.field === 'quantity'
    const editingPrice =
      editingCell?.orderId === order.orderId && editingCell.field === 'price'
    return (
      <tr
        key={`${order.account}-${order.permId}`}
        className={contextMenu?.order.orderId === order.orderId ? 'force-active' : ''}
        onContextMenu={(e) => {
          e.preventDefault()
          if (order.status !== 'PendingCancel')
            setContextMenu({ x: e.clientX, y: e.clientY, order })
        }}
      >
        <td
          style={{
            whiteSpace: 'nowrap',
            fontSize: '12px',
            color: '#333',
            paddingLeft: 8,
            textAlign: 'left'
          }}
        >
          {batchToggle && (
            <button
              type="button"
              className="batch-toggle-btn"
              title={batchToggle.collapsed ? '展開此批次' : '收合此批次'}
              onClick={(e) => {
                e.stopPropagation()
                batchToggle.onToggle()
              }}
            >
              {batchToggle.collapsed ? '+' : '−'}
            </button>
          )}
          {acctName}
          {batchToggle?.collapsed && (
            <span style={{ color: '#333', marginLeft: 5, fontSize: 12 }}>
              ({batchToggle.count})
            </span>
          )}
        </td>
        <td className="pos-symbol">{desc}</td>
        <td style={{ textAlign: 'left', fontSize: '12px', color: '#333', whiteSpace: 'nowrap', fontWeight: 600 }}>
          {(() => {
            const spec = parseRollSpec(order.comboDescription)
            if (!spec) return ''
            // These rolls come from the 展期觀察 chase rules (all observe rules
            // are chase), so match the watch's 追 convention: chase points =
            // strike delta for calls, negated for puts. The day part stays 展.
            const chasePts = spec.right === 'C' ? spec.pts : -spec.pts
            // Match the 展期觀察 chunk: no "+" prefix for positives (e.g. 追 2 點).
            const ptsStr = `${chasePts}`
            return (
              <>
                展 {spec.days != null ? spec.days : '-'} 天
                <span className="roll-watch-sep">·</span>追 {ptsStr} 點
              </>
            )
          })()}
        </td>
        <td
          style={{
            textAlign: 'center',
            color: '#fff',
            fontWeight: 600,
            backgroundColor: order.action === 'BUY' ? '#1a6b3a' : '#dc2626'
          }}
        >
          {order.action === 'BUY' ? '買' : '賣'}
        </td>
        <td
          className="editable-cell"
          title="雙擊修改數量"
          style={
            editingQty
              ? { cursor: 'pointer' }
              : { cursor: 'pointer', fontWeight: 500 }
          }
          onDoubleClick={(e) => {
            e.stopPropagation()
            startEdit(order, 'quantity')
          }}
        >
          {editingQty ? (
            <input
              ref={editInputRef}
              type="number"
              step="1"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitEdit(order, 'quantity', editValue)
                if (e.key === 'Escape') cancelEdit()
              }}
              onBlur={() => cancelEdit()}
              style={{
                width: '52px',
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
            // TWS-style "filled / total" — direction is conveyed by the
            // green/red cell background, so we drop the explicit +/- sign.
            <>
              {(order.filled ?? 0).toLocaleString('en-US')}/
              {Math.abs(order.quantity).toLocaleString('en-US')}
            </>
          )}
        </td>
        {(() => {
          const oq = orderQuotes[`${order.account}|${order.permId}`]
          // IB returns 0 for a combo with no live quote (e.g. market closed) —
          // show "-" instead of a misleading 0.00.
          const fmt = (v: number | undefined): string =>
            v != null && Number.isFinite(v) && v !== 0 ? v.toFixed(2) : '-'
          // 中間 = (買+賣)/2, only when BOTH sides have a real quote.
          const hasBoth =
            !!oq &&
            Number.isFinite(oq.bid) &&
            oq.bid !== 0 &&
            Number.isFinite(oq.ask) &&
            oq.ask !== 0
          const mid = hasBoth ? (oq!.bid + oq!.ask) / 2 : null
          return (
            <>
              <td style={{ color: '#1a6b3a' }}>{fmt(oq?.bid)}</td>
              <td style={{ color: '#c0392b' }}>{fmt(oq?.ask)}</td>
              <td style={{ color: '#1d4ed8' }}>{mid != null ? mid.toFixed(2) : '-'}</td>
            </>
          )
        })()}
        <td
          className={order.orderType === 'LMT' ? 'editable-cell' : undefined}
          title={
            order.orderType === 'LMT'
              ? batchToggle?.collapsed
                ? '雙擊修改全部限價'
                : '雙擊修改價格'
              : undefined
          }
          style={{ cursor: order.orderType === 'LMT' ? 'pointer' : 'default' }}
          onDoubleClick={(e) => {
            if (order.orderType === 'LMT') {
              e.stopPropagation()
              startEdit(order, 'price')
            }
          }}
        >
          {editingPrice ? (
            <input
              ref={editInputRef}
              type="number"
              step="0.01"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter')
                  submitEdit(
                    order,
                    'price',
                    editValue,
                    batchToggle?.collapsed ? batchToggle.orders : undefined
                  )
                if (e.key === 'Escape') cancelEdit()
              }}
              onBlur={() => cancelEdit()}
              style={{
                width: '52px',
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
        <td style={{ fontWeight: 600, color: '#1a3a6b' }}>
          {order.filled != null && order.filled > 0 && order.avgFillPrice != null
            ? order.avgFillPrice.toFixed(2)
            : '-'}
        </td>
        {(() => {
          const commission = executions
            .filter((e) => e.account === order.account && e.orderId === order.orderId)
            .reduce((s, e) => s + (e.commission ?? 0), 0)
          return (
            <td style={{ color: '#8a5a00' }}>
              {commission > 0 ? commission.toFixed(2) : '-'}
            </td>
          )
        })()}
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
        <td style={{ textAlign: 'center' }}>
          {(() => {
            const cancellable = (o: OpenOrderData): boolean =>
              o.status !== 'PendingCancel' &&
              o.status !== 'Cancelled' &&
              o.status !== 'Filled'
            // Collapsed batch row → one button cancels every (cancellable)
            // order in the batch.
            if (batchToggle?.collapsed) {
              const targets = batchToggle.orders.filter(cancellable)
              if (targets.length === 0) return null
              return (
                <button
                  className="order-cancel-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    cancelOrders(targets.map((o) => o.orderId))
                  }}
                >
                  取消全部
                </button>
              )
            }
            return cancellable(order) ? (
              <button
                className="order-cancel-btn"
                onClick={(e) => {
                  e.stopPropagation()
                  cancelOrder(order.orderId)
                }}
              >
                取消委託
              </button>
            ) : null
          })()}
        </td>
      </tr>
    )
  }

  return (
    <>
      <div>
        <div className="sort-bar">
          {groupViewMode ? (
            <div style={{ display: 'flex', width: '100%', alignItems: 'center', gap: '6px' }}>
              <button
                className="select-toggle-btn"
                style={{ padding: '7px 9px' }}
                title="重置篩選"
                onClick={() => {
                  setFilterGroupIndex('')
                  setFilterGroupSymbol('')
                  setFilterGroupRight('')
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
              <CustomSelect
                className={`group-filter-select${filterGroupIndex ? ' active' : ''}`}
                value={filterGroupIndex}
                onChange={setFilterGroupIndex}
                options={[
                  { value: '', label: '全部編號' },
                  ...symbolGroups.map((_, i) => ({ value: String(i), label: `${i + 1}` }))
                ]}
              />
              <CustomSelect
                className={`group-filter-select${filterGroupSymbol ? ' active' : ''}`}
                value={filterGroupSymbol}
                onChange={setFilterGroupSymbol}
                options={[
                  { value: '', label: '全部標的' },
                  ...Array.from(new Set(symbolGroups.map((g) => g.symbol)))
                    .sort(compareSymbols)
                    .map((s) => ({ value: s, label: s }))
                ]}
              />
              <CustomSelect
                className={`group-filter-select${filterGroupRight ? ' active' : ''}`}
                value={filterGroupRight}
                onChange={(v) => setFilterGroupRight(v as '' | 'C' | 'P' | 'STK')}
                options={[
                  { value: '', label: 'All Positions' },
                  { value: 'P', label: 'PUT' },
                  { value: 'C', label: 'CALL' },
                  { value: 'STK', label: '股票' }
                ]}
              />
              <button
                className="select-toggle-btn"
                style={{ marginLeft: 'auto' }}
                onClick={() => setShowObserveRules(true)}
              >
                觀察規則
              </button>
              <button className="select-toggle-btn" onClick={() => setShowAddGroup(true)}>
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
                    setFilterAccount('')
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
                  className={`group-filter-select${filterSymbol ? ' active' : ''}`}
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
                {selectMode === 'OPT' && (
                  <CustomSelect
                    className={`group-filter-select${filterRight ? ' active' : ''}`}
                    value={filterRight}
                    onChange={(v) => {
                      setFilterRight(v as '' | 'C' | 'P')
                      setSelectedPositions(new Set())
                    }}
                    options={[
                      { value: '', label: 'CALL / PUT' },
                      { value: 'C', label: 'CALL' },
                      { value: 'P', label: 'PUT' }
                    ]}
                  />
                )}
                <CustomSelect
                  value={filterAccount}
                  onChange={(v) => {
                    setFilterAccount(v)
                    setSelectedPositions(new Set())
                  }}
                  options={[
                    { value: '', label: `全部 ${uniqueAccounts.length} 個帳戶` },
                    ...uniqueAccounts
                  ]}
                  className={`dropdown-no-scroll${filterAccount ? ' account-filter-active' : ''}`}
                  onPrev={
                    filterAccount && uniqueAccounts.length > 1
                      ? () => {
                          const idx = uniqueAccounts.findIndex((a) => a.value === filterAccount)
                          if (idx < 0) return
                          const next =
                            uniqueAccounts[
                              (idx - 1 + uniqueAccounts.length) % uniqueAccounts.length
                            ]
                          setFilterAccount(next.value)
                          setSelectedPositions(new Set())
                        }
                      : undefined
                  }
                  onNext={
                    filterAccount && uniqueAccounts.length > 1
                      ? () => {
                          const idx = uniqueAccounts.findIndex((a) => a.value === filterAccount)
                          if (idx < 0) return
                          const next = uniqueAccounts[(idx + 1) % uniqueAccounts.length]
                          setFilterAccount(next.value)
                          setSelectedPositions(new Set())
                        }
                      : undefined
                  }
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
                      setSelectedPositions((prev) =>
                        prev.size === allKeys.size ? new Set() : allKeys
                      )
                    }}
                  >
                    全選
                  </button>
                )}
                {selectMode && canRollOptions && (
                  <button className="select-toggle-btn" onClick={() => attemptRoll()}>
                    展期
                  </button>
                )}
                {selectMode === 'OPT' && canCloseOptions && (
                  <button
                    className="select-toggle-btn"
                    onClick={() => setShowCloseOptionDialog(true)}
                  >
                    期權平倉
                  </button>
                )}
                {selectMode === 'STK' && canTransferStocks && (
                  <button className="select-toggle-btn" onClick={() => setShowTransferDialog(true)}>
                    轉倉
                  </button>
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
                  <button
                    className={`select-toggle-btn${acctViewBySymbol ? ' active' : ''}`}
                    onClick={() => setAcctViewBySymbol((v) => !v)}
                    title={acctViewBySymbol ? '切換為分類顯示' : '切換為標的分組'}
                  >
                    顯示切換
                  </button>
                </>
              )}
              <CustomSelect
                value={sortBy}
                onChange={setSortBy}
                options={[
                  { value: 'netLiquidation', label: '淨值-從高到低' },
                  { value: 'alpha', label: '按字母排列' },
                  { value: 'margin', label: '潛在融資-從高到低' },
                  { value: 'cash', label: '現金-從多到少' },
                  { value: 'returnRate', label: '報酬率-從高到低' }
                ]}
              />
            </>
          )}
        </div>

        {groupViewMode ? (
          /* Group Cards View */
          symbolGroups.length === 0 && uncategorizedPositions.length === 0 ? (
            <div className="empty-state">尚無批次交易，請選取期權後建立</div>
          ) : (
            <div className="group-cards-grid" ref={groupGridRef}>
              {symbolGroups.map((g, gIdx) => {
                if (filterGroupIndex !== '' && String(gIdx) !== filterGroupIndex) return null
                if (filterGroupSymbol !== '' && g.symbol !== filterGroupSymbol) return null
                const groupPosKeys = new Set(g.posKeys)
                const groupPositionsAll = positions
                  .filter((p) => {
                    if (g.autoParams) {
                      const symbolMatch = g.autoParams.symbols.includes(p.symbol)
                      if (!symbolMatch) return false
                      const rights = g.autoParams.rights || (g.autoParams.right ? [g.autoParams.right] : [])
                      const rightMatch =
                        (rights.includes('STK') && p.secType === 'STK') ||
                        (rights.includes('C') && p.secType === 'OPT' && (p.right === 'C' || p.right === 'CALL')) ||
                        (rights.includes('P') && p.secType === 'OPT' && (p.right === 'P' || p.right === 'PUT'))
                      if (!rightMatch) return false
                      const accountMatch = g.autoParams.accounts && g.autoParams.accounts.includes(p.account)
                      return !!accountMatch
                    }
                    return groupPosKeys.has(posKey(p))
                  })
                  .sort((a, b) => {
                    if (a.secType !== b.secType) return a.secType === 'STK' ? -1 : 1
                    if (a.secType === 'OPT' && b.secType === 'OPT') {
                      if (a.symbol !== b.symbol) return a.symbol.localeCompare(b.symbol)
                      const rightA = a.right === 'P' || a.right === 'PUT' ? 'P' : 'C'
                      const rightB = b.right === 'P' || b.right === 'PUT' ? 'P' : 'C'
                      if (rightA !== rightB) return rightB.localeCompare(rightA)
                      const aAlias = formatAccountName(accounts.find((x) => x.accountId === a.account)?.alias || a.account)
                      const bAlias = formatAccountName(accounts.find((x) => x.accountId === b.account)?.alias || b.account)
                      if (aAlias !== bAlias) return aAlias.localeCompare(bAlias)
                      const expiryComp = (a.expiry || '').localeCompare(b.expiry || '')
                      if (expiryComp !== 0) return expiryComp
                      return (a.strike || 0) - (b.strike || 0)
                    }
                    if (a.symbol !== b.symbol) return a.symbol.localeCompare(b.symbol)
                    const aAlias = formatAccountName(accounts.find((x) => x.accountId === a.account)?.alias || a.account)
                    const bAlias = formatAccountName(accounts.find((x) => x.accountId === b.account)?.alias || b.account)
                    return aAlias.localeCompare(bAlias)
                  })
                // Option-right filter (group view): hide groups with no option of
                // the selected right; within shown groups, drop the other right's
                // options. Stocks stay as strategy context.
                const matchesGroupRight = (p: PositionData): boolean =>
                  p.right === filterGroupRight ||
                  p.right === (filterGroupRight === 'C' ? 'CALL' : 'PUT')
                // 股票: keep only groups that hold a stock leg, and show just the
                // stock rows. Otherwise (PUT/CALL) hide groups with no option of
                // that right and drop the other right's options.
                if (filterGroupRight === 'STK') {
                  if (!groupPositionsAll.some((p) => p.secType === 'STK')) return null
                } else if (
                  filterGroupRight &&
                  !groupPositionsAll.some((p) => p.secType === 'OPT' && matchesGroupRight(p))
                ) {
                  return null
                }
                const groupPositions =
                  filterGroupRight === 'STK'
                    ? groupPositionsAll.filter((p) => p.secType === 'STK')
                    : filterGroupRight
                      ? groupPositionsAll.filter((p) => p.secType !== 'OPT' || matchesGroupRight(p))
                      : groupPositionsAll
                // Per-position "traded today" marker: a single position row turns
                // its left border blue when today's IB executions include a fill on
                // that EXACT contract (account+symbol+secType+expiry+strike+right) —
                // e.g. the new leg just opened by a roll. `executions` is already
                // today-only; normR folds C/CALL and P/PUT.
                const normR = (r?: string): string =>
                  r === 'C' || r === 'CALL' ? 'C' : r === 'P' || r === 'PUT' ? 'P' : ''
                const rolledTodayKeys = new Set(
                  executions.map(
                    (e) =>
                      `${e.account}|${e.symbol}|${e.secType}|${e.expiry || ''}|${e.strike || ''}|${normR(e.right)}`
                  )
                )
                const isRolledToday = (p: PositionData): boolean =>
                  rolledTodayKeys.has(
                    `${p.account}|${p.symbol}|${p.secType}|${p.expiry || ''}|${p.strike || ''}|${normR(p.right)}`
                  )
                return (
                  <div
                    key={g.id}
                    className={`account-card${selectedGroupId === g.id ? ' account-card-selected' : ''}`}
                    onMouseDownCapture={(e) => {
                      const t = e.target as HTMLElement
                      dragFromNoteRef.current = !!t.closest?.('.report-note')
                    }}
                    onMouseDown={(e) => {
                      if (e.detail > 1) e.preventDefault()
                    }}
                    onClick={() => {
                      if (cardClickTimerRef.current) {
                        clearTimeout(cardClickTimerRef.current)
                      }
                      cardClickTimerRef.current = setTimeout(() => {
                        setSelectedGroupId((prev) => (prev === g.id ? null : g.id))
                        cardClickTimerRef.current = null
                      }, 220)
                    }}
                    onDoubleClick={() => {
                      if (cardClickTimerRef.current) {
                        clearTimeout(cardClickTimerRef.current)
                        cardClickTimerRef.current = null
                      }
                      const target = String(gIdx)
                      setFilterGroupIndex((prev) => (prev === target ? '' : target))
                    }}
                    draggable={editingNoteCardId !== g.id && hoverNoteCardId !== g.id}
                    onDragStart={(e) => {
                      // Fallback: cancel the card drag if a gesture still started
                      // inside the note (e.g. hover state hadn't applied yet).
                      if (dragFromNoteRef.current) {
                        e.preventDefault()
                        return
                      }
                      e.dataTransfer.effectAllowed = 'move'
                      e.dataTransfer.setData('text/plain', String(gIdx))
                      ;(e.currentTarget as HTMLElement).style.opacity = '0.4'
                    }}
                    onDragEnd={(e) => {
                      ;(e.currentTarget as HTMLElement).style.opacity = '1'
                    }}
                    onDragOver={(e) => {
                      e.preventDefault()
                      e.dataTransfer.dropEffect = 'move'
                      ;(e.currentTarget as HTMLElement).style.boxShadow = '0 0 0 2px #2563eb'
                    }}
                    onDragLeave={(e) => {
                      ;(e.currentTarget as HTMLElement).style.boxShadow = ''
                    }}
                    onDrop={(e) => {
                      e.preventDefault()
                      ;(e.currentTarget as HTMLElement).style.boxShadow = ''
                      const fromIdx = parseInt(e.dataTransfer.getData('text/plain'), 10)
                      if (isNaN(fromIdx) || fromIdx === gIdx) return
                      const next = [...symbolGroups]
                      const [moved] = next.splice(fromIdx, 1)
                      next.splice(gIdx, 0, moved)
                      onReorderSymbolGroups?.(next)
                    }}
                  >
                    <div
                      className="account-header"
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span
                          style={{
                            backgroundColor: '#dcfce7',
                            padding: '2px 6px',
                            borderRadius: '3px',
                            fontWeight: 600,
                            fontSize: '14px',
                            color: '#333'
                          }}
                        >
                          {gIdx + 1}.
                        </span>
                        <span className="account-id">{g.name}</span>
                      </div>
                      {(() => {
                        const accountCount = new Set(groupPositions.map((p) => p.account)).size
                        return (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: 'auto', marginRight: '12px' }}>
                            <span style={{ backgroundColor: '#e0e7ff', color: '#3730a3', fontSize: '12px', fontWeight: 600, padding: '2px 6px', borderRadius: '4px' }}>
                              {accountCount} 個帳戶
                            </span>
                            {g.autoParams && (
                              <span style={{ backgroundColor: '#e0e7ff', color: '#3730a3', fontSize: '12px', fontWeight: 600, padding: '2px 6px', borderRadius: '4px' }}>
                                自動
                              </span>
                            )}
                          </div>
                        )
                      })()}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        {/* Add-note button: only when this group has no note yet. */}
                        {onUpdateSymbolGroup && !g.note && (
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            style={{ cursor: 'pointer', opacity: 0.7 }}
                            onClick={(e) => {
                              e.stopPropagation()
                              setNoteEditorFor(`grp:${g.id}`)
                            }}
                          >
                            <title>新增註解</title>
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4Z" />
                          </svg>
                        )}
                        {onUpdateSymbolGroup &&
                          (() => {
                            const obsOpt = groupPositions.filter((p) => p.secType === 'OPT')
                            const canObserve =
                              obsOpt.length > 0 &&
                              new Set(obsOpt.map((p) => p.symbol)).size === 1 &&
                              new Set(
                                obsOpt.map((p) =>
                                  p.right === 'C' || p.right === 'CALL' ? 'C' : 'P'
                                )
                              ).size === 1
                            if (!canObserve) return null
                            return (
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="16"
                                height="16"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                style={{ cursor: 'pointer', opacity: 0.7 }}
                                onClick={() => {
                                  const cur = Array.isArray(g.rollWatch)
                                    ? g.rollWatch
                                    : g.rollWatch
                                      ? [g.rollWatch]
                                      : []
                                  if (cur.length >= 4) {
                                    setRollWarnMsg({
                                      title: '展期觀察已達上限',
                                      message:
                                        '每個群組最多只能設定 4 個展期觀察，請先移除其中一個再新增。'
                                    })
                                    return
                                  }
                                  setSelectedPositions(new Set(obsOpt.map((p) => posKey(p))))
                                  setObserveGroupId(g.id)
                                  setRollInitialTarget(null)
                                  setShowRollDialog(true)
                                }}
                              >
                                <title>展期觀察</title>
                                <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                                <circle cx="12" cy="12" r="3" />
                              </svg>
                            )
                          })()}
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
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
                          xmlns="http://www.w3.org/2000/svg"
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          style={{ cursor: 'pointer', opacity: 0.7 }}
                          onClick={() => {
                            setDeleteGroupConfirm({ id: g.id, name: g.name })
                          }}
                        >
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          <line x1="10" y1="11" x2="10" y2="17" />
                          <line x1="14" y1="11" x2="14" y2="17" />
                        </svg>
                      </div>
                    </div>
                    {/* Per-group free-form note. Same UX as the account-card
                        note: click anywhere to edit, IME-safe textarea,
                        ticker pills with underlying spot prices. */}
                    {onUpdateSymbolGroup && (
                      <div
                        onMouseEnter={() => setHoverNoteCardId(g.id)}
                        onMouseLeave={() =>
                          setHoverNoteCardId((p) => (p === g.id ? null : p))
                        }
                      >
                        <ReportNoteBox
                          value={g.note}
                          quotes={quotes}
                          onSave={(v) => onUpdateSymbolGroup({ ...g, note: v })}
                          open={noteEditorFor === `grp:${g.id}`}
                          onClose={() =>
                            setNoteEditorFor((p) => (p === `grp:${g.id}` ? null : p))
                          }
                          onResize={bumpMasonry}
                          onEditingChange={(ed) =>
                            setEditingNoteCardId((prev) =>
                              ed ? g.id : prev === g.id ? null : prev
                            )
                          }
                          onComposingChange={(c) => {
                            noteComposingRef.current = c
                            // On composition end, re-run masonry now that the
                            // pause is lifted so the card catches up.
                            if (!c) bumpMasonry()
                          }}
                        />
                      </div>
                    )}
                    {/* 觀察列: manual watches on top (order 1), default rules below
                        (order 2), via a flex column so they don't need reordering. */}
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <div style={{ order: 2 }}>
                    {/* 預設觀察規則: derive observation rows from the enabled default
                        rules, applied to the group's current short option. Shown
                        ALONGSIDE any manually-saved watches (not replaced by them). */}
                    {(() => {
                      const normRight = (r: string): 'C' | 'P' =>
                        r === 'C' || r === 'CALL' ? 'C' : 'P'
                      const optPos = groupPositions.filter(
                        (p) => p.secType === 'OPT' && !!p.expiry && p.strike != null
                      )
                      if (optPos.length === 0) return null
                      // Single-symbol groups only. The contracts may differ
                      // across accounts (some already rolled), so derive the
                      // observations from the soonest-expiring leg — that's the
                      // most urgent to manage. Tie-break by lowest strike.
                      const symbols = new Set(optPos.map((p) => p.symbol))
                      if (symbols.size !== 1) return null
                      const src = [...optPos].sort((a, b) => {
                        const ec = (a.expiry || '').localeCompare(b.expiry || '')
                        if (ec !== 0) return ec
                        return (a.strike ?? 0) - (b.strike ?? 0)
                      })[0]
                      if (!src.expiry || src.strike == null) return null
                      // These default rules are QQQ-specific — skip other symbols.
                      if (src.symbol !== 'QQQ') return null
                      const right = normRight(src.right || '')
                      // Pick the rule set by where the price sits vs the strike:
                      //   落後 (breached/ITM)            → 'breached'
                      //   領先 < LEAD_THRESHOLD_PCT%      → 'leadNear'
                      //   領先 ≥ LEAD_THRESHOLD_PCT%      → 'leadFar'
                      // No quote yet → assume comfortably leading ('leadFar').
                      const px = quotes[src.symbol]
                      let category:
                        | 'leadFar'
                        | 'leadMid'
                        | 'leadNear'
                        | 'breachedNear'
                        | 'breachedFar' = 'leadFar'
                      if (px != null && px > 0) {
                        const behind = right === 'C' ? px - src.strike : src.strike - px
                        if (behind > 0) {
                          const breachPct = (behind / px) * 100
                          category =
                            breachPct < BREACH_THRESHOLD_PCT ? 'breachedNear' : 'breachedFar'
                        } else {
                          const leadPct = (Math.abs(behind) / px) * 100
                          category =
                            leadPct > LEAD_HIGH_PCT
                              ? 'leadFar'
                              : leadPct < LEAD_LOW_PCT
                                ? 'leadNear'
                                : 'leadMid'
                        }
                      }
                      const rules = getEnabledObserveRules(category)
                      if (rules.length === 0) return null
                      // Each rule only applies when the position's remaining DTE
                      // satisfies its condition (e.g. DTE > 2 or DTE < 2).
                      const curDte = tradingDaysUntil(src.expiry) ?? 0
                      return rules
                        .filter((rule) => {
                          if (!rule.hasDte) return true // no DTE gate → always on
                          return rule.op === '<' ? curDte < rule.dte : curDte > rule.dte
                        })
                        .map((rule, ri) => {
                        // 展 N 點 = signed delta. 追 N 點 = chase the breach
                        // direction: +N for calls (price above), −N for puts.
                        const strikeDelta = rule.chase
                          ? right === 'C'
                            ? rule.points
                            : -rule.points
                          : rule.points
                        const target = {
                          expiry: addTradingDays(src.expiry!, rule.days),
                          strike: src.strike! + strikeDelta,
                          right
                        }
                        return (
                          <RollWatchChunk
                            key={`auto-${ri}`}
                            symbol={src.symbol}
                            source={{ expiry: src.expiry!, strike: src.strike!, right }}
                            target={target}
                            isShort={src.quantity < 0}
                            chase={rule.chase}
                            points={rule.points}
                            onGo={() => {
                              const optKeys = groupPositions
                                .filter((p) => p.secType === 'OPT')
                                .map((p) => posKey(p))
                              setSelectedPositions(new Set(optKeys))
                              setObserveGroupId(null)
                              setRollInitialTarget(target)
                              setShowRollDialog(true)
                            }}
                          />
                        )
                      })
                    })()}
                    </div>
                    <div style={{ order: 1 }}>
                    {/* 展期觀察: up to 3 saved roll targets → one live A→B row each. */}
                    {onUpdateSymbolGroup &&
                      (() => {
                        const watches = Array.isArray(g.rollWatch)
                          ? g.rollWatch
                          : g.rollWatch
                            ? [g.rollWatch]
                            : []
                        if (watches.length === 0) return null
                        const normRight = (r: string): 'C' | 'P' =>
                          r === 'C' || r === 'CALL' ? 'C' : 'P'
                        return watches.map((watch, wi) => {
                          const src = groupPositions.find(
                            (p) =>
                              p.secType === 'OPT' &&
                              normRight(p.right || '') === watch.right &&
                              !!p.expiry &&
                              p.strike != null
                          )
                          if (!src || !src.expiry || src.strike == null) return null
                          const isDragging =
                            watchDrag?.groupId === g.id && watchDrag.from === wi
                          return (
                            <div
                              key={`${watch.expiry}-${watch.strike}-${watch.right}-${wi}`}
                              draggable={watches.length > 1}
                              onDragStart={(e) => {
                                // Don't let this bubble to the card's group-reorder
                                // drag handlers (which dim the whole card).
                                e.stopPropagation()
                                setWatchDrag({ groupId: g.id, from: wi })
                                e.dataTransfer.effectAllowed = 'move'
                              }}
                              onDragOver={(e) => {
                                if (watchDrag?.groupId === g.id) {
                                  e.preventDefault()
                                  e.stopPropagation()
                                }
                              }}
                              onDrop={(e) => {
                                e.preventDefault()
                                e.stopPropagation()
                                if (!watchDrag || watchDrag.groupId !== g.id) return
                                const from = watchDrag.from
                                setWatchDrag(null)
                                if (from === wi) return
                                const arr = [...watches]
                                const [moved] = arr.splice(from, 1)
                                arr.splice(wi, 0, moved)
                                onUpdateSymbolGroup({ ...g, rollWatch: arr })
                              }}
                              onDragEnd={(e) => {
                                e.stopPropagation()
                                setWatchDrag(null)
                              }}
                              className={watches.length > 1 ? 'roll-watch-drag' : undefined}
                              style={{ opacity: isDragging ? 0.4 : 1 }}
                            >
                              <RollWatchChunk
                                symbol={src.symbol}
                                source={{
                                  expiry: src.expiry,
                                  strike: src.strike,
                                  right: watch.right
                                }}
                                target={watch}
                                isShort={src.quantity < 0}
                                onGo={() => {
                                  const optKeys = groupPositions
                                    .filter((p) => p.secType === 'OPT')
                                    .map((p) => posKey(p))
                                  setSelectedPositions(new Set(optKeys))
                                  setObserveGroupId(null)
                                  setRollInitialTarget({
                                    expiry: watch.expiry,
                                    strike: watch.strike,
                                    right: watch.right
                                  })
                                  setShowRollDialog(true)
                                }}
                                onClear={() => {
                                  const cur = Array.isArray(g.rollWatch)
                                    ? g.rollWatch
                                    : g.rollWatch
                                      ? [g.rollWatch]
                                      : []
                                  const next = cur.filter((_, i) => i !== wi)
                                  onUpdateSymbolGroup({
                                    ...g,
                                    rollWatch: next.length ? next : undefined
                                  })
                                }}
                              />
                            </div>
                          )
                        })
                      })()}
                    </div>
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        padding: '4px 0 0'
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {(() => {
                        if (groupPositions.length === 0) return null
                        const checkedSet = groupChecked[g.id]
                        const hasChecked = checkedSet && checkedSet.size > 0
                        const effectivePositions = hasChecked
                          ? groupPositions.filter((p) => checkedSet.has(posKey(p)))
                          : groupPositions
                        const setGroupKeys = (): void => {
                          const keys = new Set(effectivePositions.map((p) => posKey(p)))
                          setSelectedPositions(keys)
                        }
                        const checkedCount = hasChecked ? checkedSet.size : 0
                        const checkedLabel = checkedCount > 0 ? ` (${checkedCount})` : ''
                        const allOpt = effectivePositions.every((p) => p.secType === 'OPT')
                        const allStk = effectivePositions.every((p) => p.secType === 'STK')
                        if (allOpt) {
                          const rights = new Set(
                            effectivePositions.map((p) =>
                              (p.right || '').toUpperCase().replace('CALL', 'C').replace('PUT', 'P')
                            )
                          )
                          const symbols = new Set(effectivePositions.map((p) => p.symbol))
                          const canRoll = rights.size === 1 && symbols.size === 1
                          return (
                            <>
                              {canRoll && (
                                <button
                                  className="select-toggle-btn"
                                  style={{
                                    fontSize: '13px',
                                    padding: '2px 10px',
                                    lineHeight: '1.4'
                                  }}
                                  onClick={() => {
                                    attemptRoll(effectivePositions.filter((p) => p.secType === 'OPT'))
                                  }}
                                >
                                  展期{checkedLabel}
                                </button>
                              )}
                              <button
                                className="select-toggle-btn"
                                style={{ fontSize: '13px', padding: '2px 10px', lineHeight: '1.4' }}
                                onClick={() => {
                                  setGroupKeys()
                                  setShowCloseOptionDialog(true)
                                }}
                              >
                                平倉{checkedLabel}
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
                                onClick={() => {
                                  setGroupKeys()
                                  setShowTransferDialog(true)
                                }}
                              >
                                轉倉{checkedLabel}
                              </button>
                              <button
                                className="select-toggle-btn"
                                style={{ fontSize: '13px', padding: '2px 10px', lineHeight: '1.4' }}
                                onClick={() => {
                                  setGroupKeys()
                                  setShowCloseDialog(true)
                                }}
                              >
                                平倉{checkedLabel}
                              </button>
                            </>
                          )
                        }
                        const optPositions = effectivePositions.filter((p) => p.secType === 'OPT')
                        const stkPositions = effectivePositions.filter((p) => p.secType === 'STK')
                        const setStkKeys = (): void => {
                          setSelectedPositions(new Set(stkPositions.map((p) => posKey(p))))
                        }
                        const canRollMixed =
                          optPositions.length > 0 &&
                          (() => {
                            const rights = new Set(
                              optPositions.map((p) =>
                                (p.right || '')
                                  .toUpperCase()
                                  .replace('CALL', 'C')
                                  .replace('PUT', 'P')
                              )
                            )
                            const symbols = new Set(optPositions.map((p) => p.symbol))
                            const sides = new Set(
                              optPositions.map((p) => (p.quantity < 0 ? 'SELL' : 'BUY'))
                            )
                            return rights.size === 1 && symbols.size === 1 && sides.size === 1
                          })()
                        const canTransferMixed =
                          stkPositions.length > 0 && stkPositions.every((p) => p.quantity > 0)
                        return (
                          <>
                            {canRollMixed && (
                              <button
                                className="select-toggle-btn"
                                style={{ fontSize: '13px', padding: '2px 10px', lineHeight: '1.4' }}
                                onClick={() => {
                                  attemptRoll(optPositions)
                                }}
                              >
                                展期{checkedLabel}
                              </button>
                            )}
                            {canTransferMixed && (
                              <button
                                className="select-toggle-btn"
                                style={{ fontSize: '13px', padding: '2px 10px', lineHeight: '1.4' }}
                                onClick={() => {
                                  setStkKeys()
                                  setShowTransferDialog(true)
                                }}
                              >
                                轉倉{checkedLabel}
                              </button>
                            )}
                          </>
                        )
                      })()}
                      {groupPositions.length > 0 && (
                        <button
                          className="select-toggle-btn"
                          style={{
                            fontSize: '13px',
                            padding: '4px 6px',
                            lineHeight: '1',
                            backgroundColor: checkModeGroups.has(g.id) ? '#2563eb' : undefined,
                            color: checkModeGroups.has(g.id) ? '#fff' : undefined,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}
                          title="勾選"
                          onClick={() => {
                            setCheckModeGroups((prev) => {
                              const next = new Set(prev)
                              if (next.has(g.id)) {
                                next.delete(g.id)
                                setGroupChecked((gc) => {
                                  const copy = { ...gc }
                                  delete copy[g.id]
                                  return copy
                                })
                              } else {
                                next.add(g.id)
                              }
                              return next
                            })
                          }}
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <polyline points="9 11 12 14 22 4" />
                            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                          </svg>
                        </button>
                      )}
                    </div>
                    {groupPositions.length === 0 ? (
                      <div style={{ padding: '12px', fontSize: '12px', color: '#999' }}>
                        無匹配持倉
                      </div>
                    ) : (
                      (() => {
                        const stkPos = groupPositions.filter((p) => p.secType !== 'OPT')
                        // Sort by expiry asc (nearest first), then by strike asc.
                        // This naturally clusters identical (expiry, strike)
                        // contracts together so the separator lines only
                        // appear between real group boundaries.
                        const optPos = groupPositions
                          .filter((p) => p.secType === 'OPT')
                          .slice()
                          .sort((a, b) => {
                            const expA = a.expiry || ''
                            const expB = b.expiry || ''
                            if (expA !== expB) return expA < expB ? -1 : 1
                            return (a.strike || 0) - (b.strike || 0)
                          })
                        const currentCheckedSet = groupChecked[g.id] || new Set<string>()
                        const toggleCheck = (pk: string): void => {
                          setGroupChecked((prev) => {
                            const cur = new Set(prev[g.id] || [])
                            if (cur.has(pk)) cur.delete(pk)
                            else cur.add(pk)
                            return { ...prev, [g.id]: cur }
                          })
                        }
                        const renderRow = (
                          pos: PositionData,
                          idx: number,
                          showDays: boolean,
                          total: number
                        ): React.ReactNode => {
                          const isOption = pos.secType === 'OPT'
                          const key = `${pos.symbol}|${pos.expiry || ''}|${pos.strike || ''}|${pos.right || ''}`
                          const lastPrice = isOption
                            ? (optionQuotes[key] ?? 0)
                            : (quotes[pos.symbol] ?? 0)
                          const displayAvg = isOption ? pos.avgCost / 100 : pos.avgCost
                          const icCost = initialCosts[`${pos.account}|${pos.symbol}`]
                          const costBasis = !isOption && icCost != null ? icCost : pos.avgCost
                          const pnl = isOption
                            ? (lastPrice - costBasis / 100) * pos.quantity * 100
                            : (lastPrice - costBasis) * pos.quantity
                          const days = tradingDaysUntil(pos.expiry)
                          const pk = posKey(pos)
                          const isChecked = currentCheckedSet.has(pk)
                          const inCheckMode = checkModeGroups.has(g.id)
                          return (
                            <tr
                              key={idx}
                              onClick={inCheckMode ? () => toggleCheck(pk) : undefined}
                              style={inCheckMode ? { cursor: 'pointer' } : undefined}
                            >
                              <td
                                style={{
                                  textAlign: 'left',
                                  color: '#888',
                                  fontSize: '12px',
                                  whiteSpace: 'nowrap',
                                  paddingLeft: '8px',
                                  // Cell border wins over the table's gray border via
                                  // border-collapse, so this turns ONLY this row's left
                                  // edge blue when the contract traded today.
                                  borderLeft: isRolledToday(pos) ? '3px solid #2563eb' : undefined
                                }}
                              >
                                {checkModeGroups.has(g.id) && (
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={() => toggleCheck(pk)}
                                    onClick={(e) => e.stopPropagation()}
                                    style={{
                                      cursor: 'pointer',
                                      accentColor: '#2563eb',
                                      marginRight: '6px',
                                      verticalAlign: 'middle'
                                    }}
                                  />
                                )}
                                {total - idx}.
                              </td>
                              <td
                                style={{
                                  fontSize: '13px',
                                  textAlign: 'left',
                                  whiteSpace: 'nowrap'
                                }}
                              >
                                {formatAccountName(
                                  accounts.find((a) => a.accountId === pos.account)?.alias ||
                                  pos.account
                                )}
                              </td>
                              <td className="pos-symbol">
                                {formatPositionSymbol(pos)}
                                {(() => {
                                  const d = strikeDistanceLabel(pos)
                                  return d ? (
                                    <span style={{ color: d.color, fontWeight: 500 }}>
                                      {d.text}
                                    </span>
                                  ) : null
                                })()}
                              </td>
                              {showDays && (
                                <td
                                  style={{
                                    color: '#fff',
                                    fontWeight: 500,
                                    backgroundColor: pos.quantity >= 0 ? '#1a6b3a' : '#dc2626'
                                  }}
                                >
                                  {pos.quantity.toLocaleString()}
                                </td>
                              )}
                              {showDays && (
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
                              )}
                              {!showDays && (
                                <td
                                  style={{
                                    color: '#fff',
                                    fontWeight: 500,
                                    backgroundColor: pos.quantity >= 0 ? '#1a6b3a' : '#dc2626'
                                  }}
                                >
                                  {pos.quantity.toLocaleString()}
                                </td>
                              )}
                              {!showDays &&
                                (() => {
                                  const icKey = `${pos.account}|${pos.symbol}`
                                  const ic = initialCosts[icKey]
                                  return (
                                    <td>{ic != null ? ic.toFixed(2) : displayAvg.toFixed(2)}</td>
                                  )
                                })()}
                              {showDays && <td>{displayAvg.toFixed(2)}</td>}
                              <td>{lastPrice ? lastPrice.toFixed(2) : '-'}</td>
                              <td
                                style={{
                                  color: '#fff',
                                  fontWeight: 500,
                                  backgroundColor: pnl >= 0 ? '#1a6b3a' : '#dc2626'
                                }}
                              >
                                {pnl.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                              </td>
                            </tr>
                          )
                        }
                        return (
                          <>
                            {stkPos.length > 0 && (
                              <div className="positions-section">
                                <table className="positions-table">
                                  <thead>
                                    <tr>
                                      <th style={{ width: '5%', textAlign: 'left', paddingLeft: '8px' }}>
                                        {checkModeGroups.has(g.id) && (
                                          <input
                                            type="checkbox"
                                            checked={
                                              stkPos.length > 0 &&
                                              stkPos.every((p) => currentCheckedSet.has(posKey(p)))
                                            }
                                            onChange={() => {
                                              const allChecked = stkPos.every((p) =>
                                                currentCheckedSet.has(posKey(p))
                                              )
                                              setGroupChecked((prev) => {
                                                const cur = new Set(prev[g.id] || [])
                                                stkPos.forEach((p) => {
                                                  if (allChecked) cur.delete(posKey(p))
                                                  else cur.add(posKey(p))
                                                })
                                                return { ...prev, [g.id]: cur }
                                              })
                                            }}
                                            onClick={(e) => e.stopPropagation()}
                                            style={{
                                              cursor: 'pointer',
                                              accentColor: '#2563eb',
                                              verticalAlign: 'middle'
                                            }}
                                          />
                                        )}
                                      </th>
                                      <th style={{ width: '12%', textAlign: 'left' }}></th>
                                      <th style={{ width: '26%', textAlign: 'left' }}>股票</th>
                                      <th style={{ width: '9%' }}>持倉</th>
                                      <th style={{ width: '12%' }}>成本</th>
                                      <th style={{ width: '13%' }}>現價</th>
                                      <th style={{ width: '11%' }}>盈虧</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {stkPos.map((pos, idx) => renderRow(pos, idx, false, stkPos.length))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                            {optPos.length > 0 && (
                              <div className="positions-section">
                                <table className="positions-table">
                                  <thead>
                                    <tr>
                                      <th style={{ width: '5%', textAlign: 'left', paddingLeft: '8px' }}>
                                        {checkModeGroups.has(g.id) && (
                                          <input
                                            type="checkbox"
                                            checked={
                                              optPos.length > 0 &&
                                              optPos.every((p) => currentCheckedSet.has(posKey(p)))
                                            }
                                            onChange={() => {
                                              const allChecked = optPos.every((p) =>
                                                currentCheckedSet.has(posKey(p))
                                              )
                                              setGroupChecked((prev) => {
                                                const cur = new Set(prev[g.id] || [])
                                                optPos.forEach((p) => {
                                                  if (allChecked) cur.delete(posKey(p))
                                                  else cur.add(posKey(p))
                                                })
                                                return { ...prev, [g.id]: cur }
                                              })
                                            }}
                                            onClick={(e) => e.stopPropagation()}
                                            style={{
                                              cursor: 'pointer',
                                              accentColor: '#2563eb',
                                              verticalAlign: 'middle'
                                            }}
                                          />
                                        )}
                                      </th>
                                      <th style={{ width: '12%', textAlign: 'left' }}></th>
                                      <th style={{ width: '26%', textAlign: 'left' }}>期權</th>
                                      <th style={{ width: '9%' }}>持倉</th>
                                      <th style={{ width: '8%' }}>到期</th>
                                      <th style={{ width: '8%' }}>均價</th>
                                      <th style={{ width: '9%' }}>現價</th>
                                      <th style={{ width: '11%' }}>盈虧</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {optPos.map((pos, idx) => {
                                      const prevPos = idx > 0 ? optPos[idx - 1] : null
                                      const needsSep =
                                        prevPos &&
                                        (prevPos.expiry !== pos.expiry ||
                                          prevPos.strike !== pos.strike)
                                      return (
                                        <React.Fragment key={idx}>
                                          {needsSep && (
                                            <tr>
                                              <td
                                                colSpan={8}
                                                style={{
                                                  padding: 0,
                                                  height: '3px',
                                                  backgroundColor: '#fff3c4'
                                                }}
                                              />
                                            </tr>
                                          )}
                                          {renderRow(pos, idx, true, optPos.length)}
                                        </React.Fragment>
                                      )
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </>
                        )
                      })()
                    )}
                  </div>
                )
              })}
              {/* 未歸類標的 virtual group — rendered last so it sinks to the
                  bottom of the masonry layout (after the numbered groups). */}
              {filterGroupIndex === '' &&
                filterGroupSymbol === '' &&
                filterGroupRight === '' &&
                uncategorizedPositions.length > 0 &&
                (() => {
                  const ucStkPos = uncategorizedPositions.filter((p) => p.secType !== 'OPT')
                  const ucOptPos = uncategorizedPositions.filter((p) => p.secType === 'OPT')
                  const ucTotalPnl = uncategorizedPositions.reduce((sum, pos) => {
                    const isOpt = pos.secType === 'OPT'
                    const key = `${pos.symbol}|${pos.expiry || ''}|${pos.strike || ''}|${pos.right || ''}`
                    const lp = isOpt ? (optionQuotes[key] ?? 0) : (quotes[pos.symbol] ?? 0)
                    const ic = initialCosts[`${pos.account}|${pos.symbol}`]
                    const costBasis = !isOpt && ic != null ? ic : pos.avgCost
                    const pnl = isOpt
                      ? (lp - costBasis / 100) * pos.quantity * 100
                      : (lp - costBasis) * pos.quantity
                    return sum + pnl
                  }, 0)
                  const renderUcRow = (
                    pos: PositionData,
                    idx: number,
                    showDays: boolean,
                    total: number
                  ): React.ReactNode => {
                    const isOption = pos.secType === 'OPT'
                    const key = `${pos.symbol}|${pos.expiry || ''}|${pos.strike || ''}|${pos.right || ''}`
                    const lastPrice = isOption
                      ? (optionQuotes[key] ?? 0)
                      : (quotes[pos.symbol] ?? 0)
                    const displayAvg = isOption ? pos.avgCost / 100 : pos.avgCost
                    const icCost = initialCosts[`${pos.account}|${pos.symbol}`]
                    const costBasis = !isOption && icCost != null ? icCost : pos.avgCost
                    const pnl = isOption
                      ? (lastPrice - costBasis / 100) * pos.quantity * 100
                      : (lastPrice - costBasis) * pos.quantity
                    const days = tradingDaysUntil(pos.expiry)
                    return (
                      <tr key={idx}>
                        <td
                          style={{
                            textAlign: 'left',
                            color: '#888',
                            fontSize: '12px',
                            whiteSpace: 'nowrap',
                            paddingLeft: '8px'
                          }}
                        >
                          {total - idx}
                        </td>
                        <td style={{ fontSize: '13px', textAlign: 'left' }}>
                          {formatAccountName(
                            accounts.find((a) => a.accountId === pos.account)?.alias || pos.account
                          )}
                        </td>
                        <td className="pos-symbol">{formatPositionSymbol(pos)}</td>
                        {showDays && (
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
                        )}
                        <td
                          style={{
                            color: '#fff',
                            fontWeight: 500,
                            backgroundColor: pos.quantity >= 0 ? '#1a6b3a' : '#dc2626'
                          }}
                        >
                          {pos.quantity.toLocaleString()}
                        </td>
                        {!showDays &&
                          (() => {
                            const icKey = `${pos.account}|${pos.symbol}`
                            const ic = initialCosts[icKey]
                            return <td>{ic != null ? ic.toFixed(2) : '-'}</td>
                          })()}
                        <td>{displayAvg.toFixed(2)}</td>
                        <td>{lastPrice ? lastPrice.toFixed(2) : '-'}</td>
                        <td
                          style={{
                            color: '#fff',
                            fontWeight: 500,
                            backgroundColor: pnl >= 0 ? '#1a6b3a' : '#dc2626'
                          }}
                        >
                          {pnl.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                        </td>
                      </tr>
                    )
                  }
                  return (
                    <div className="account-card">
                      <div
                        className="account-header"
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span className="account-id" style={{ color: '#2563eb' }}>
                            未歸類標的
                          </span>
                        </div>
                        <span
                          style={{
                            fontSize: '14px',
                            fontWeight: 600,
                            marginLeft: 'auto',
                            marginRight: '12px',
                            color: ucTotalPnl >= 0 ? '#1a6b3a' : '#c0392b'
                          }}
                        >
                          {ucTotalPnl >= 0 ? '+' : ''}
                          {Math.round(ucTotalPnl).toLocaleString()}
                        </span>
                      </div>
                      {ucStkPos.length > 0 && (
                        <div className="positions-section">
                          <table className="positions-table" style={{ backgroundColor: '#fffbe6' }}>
                            <thead>
                              <tr>
                                <th style={{ width: '5%', textAlign: 'left', paddingLeft: '8px' }}></th>
                                <th style={{ width: '14%', textAlign: 'left' }}></th>
                                <th style={{ width: '18%', textAlign: 'left' }}>股票</th>
                                <th style={{ width: '10%' }}>持倉</th>
                                <th style={{ width: '11%' }}>成本</th>
                                <th style={{ width: '11%' }}>調整後</th>
                                <th style={{ width: '13%' }}>現價</th>
                                <th style={{ width: '13%' }}>盈虧</th>
                              </tr>
                            </thead>
                            <tbody>
                              {ucStkPos.map((pos, idx) => renderUcRow(pos, idx, false, ucStkPos.length))}
                            </tbody>
                          </table>
                        </div>
                      )}
                      {ucOptPos.length > 0 && (
                        <div className="positions-section">
                          <table className="positions-table" style={{ backgroundColor: '#fffbe6' }}>
                            <thead>
                              <tr>
                                <th style={{ width: '5%', textAlign: 'left', paddingLeft: '8px' }}></th>
                                <th style={{ width: '12%', textAlign: 'left' }}></th>
                                <th style={{ width: '22%', textAlign: 'left' }}>期權</th>
                                <th style={{ width: '8%' }}>天數</th>
                                <th style={{ width: '8%' }}>持倉</th>
                                <th style={{ width: '11%' }}>均價</th>
                                <th style={{ width: '11%' }}>現價</th>
                                <th style={{ width: '11%' }}>盈虧</th>
                              </tr>
                            </thead>
                            <tbody>
                              {ucOptPos.map((pos, idx) => {
                                const prevPos = idx > 0 ? ucOptPos[idx - 1] : null
                                const needsSep =
                                  prevPos &&
                                  (prevPos.expiry !== pos.expiry || prevPos.strike !== pos.strike)
                                return (
                                  <React.Fragment key={idx}>
                                    {needsSep && (
                                      <tr>
                                        <td
                                          colSpan={8}
                                          style={{
                                            padding: 0,
                                            height: '3px',
                                            backgroundColor: '#fff3c4'
                                          }}
                                        />
                                      </tr>
                                    )}
                                    {renderUcRow(pos, idx, true, ucOptPos.length)}
                                  </React.Fragment>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )
                })()}
            </div>
          )
        ) : accounts.length === 0 ? (
          <div className="empty-state">{loading ? '正在載入帳戶資料...' : '未找到帳戶資料'}</div>
        ) : (
          <>
          {/* Consolidated open-orders card across ALL accounts. Each row's
              first column is the account name. */}
          {!selectMode && openOrders.length > 0 && (
            <div className="account-card" style={{ marginBottom: 16 }}>
              <div className="account-header">
                <span className="account-id">
                  委託單 ({filteredOpenOrders.length}
                  {filteredOpenOrders.length !== openOrders.length
                    ? ` / ${openOrders.length}`
                    : ''}
                  )
                </span>
                <div
                  style={{
                    marginLeft: 'auto',
                    display: 'flex',
                    gap: 8,
                    alignItems: 'center'
                  }}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setOrderFilterAccount('')
                      setOrderFilterSymbol('')
                      setOrderFilterType('')
                      setOrderFilterFill('')
                    }}
                    title="清除所有篩選"
                    style={{
                      padding: 0,
                      width: 30,
                      height: 30,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      border: '1px solid #d1d5db',
                      borderRadius: 6,
                      background: '#fff',
                      cursor: 'pointer',
                      color: '#374151',
                      boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)'
                    }}
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M13.013 3H2l8 9.46V19l4 2v-8.54l.9-1.055" />
                      <path d="m22 3-5 5" />
                      <path d="m17 3 5 5" />
                    </svg>
                  </button>
                  <CustomSelect
                    value={orderFilterAccount}
                    onChange={setOrderFilterAccount}
                    options={orderAccountOptions}
                    className={`order-filter-select dropdown-no-scroll${orderFilterAccount ? ' active' : ''}`}
                  />
                  <CustomSelect
                    value={orderFilterSymbol}
                    onChange={setOrderFilterSymbol}
                    options={orderSymbolOptions}
                    className={`order-filter-select${orderFilterSymbol ? ' active' : ''}`}
                  />
                  <CustomSelect
                    value={orderFilterType}
                    onChange={(v) =>
                      setOrderFilterType(v as '' | 'STK' | 'CALL' | 'PUT')
                    }
                    options={orderTypeOptions}
                    className={`order-filter-select${orderFilterType ? ' active' : ''}`}
                  />
                  <CustomSelect
                    value={orderFilterFill}
                    onChange={(v) =>
                      setOrderFilterFill(v as '' | 'filled' | 'unfilled')
                    }
                    options={[
                      { value: '', label: '全部交易' },
                      { value: 'filled', label: '已成交' },
                      { value: 'unfilled', label: '未成交' }
                    ]}
                    className={`order-filter-select${orderFilterFill ? ' active' : ''}`}
                  />
                <button
                  className="select-toggle-btn"
                  style={{
                    height: 30,
                    padding: '0 12px',
                    fontSize: '13px'
                  }}
                  title="取消所有工作中委託(含 TWS 手動下的)"
                  onClick={() => setCancelAllConfirm(true)}
                >
                  取消全部委託
                </button>
                <button
                  type="button"
                  onClick={() => setOrdersCollapsed((v) => !v)}
                  title={ordersCollapsed ? '展開委託單' : '收合委託單'}
                  style={{
                    padding: 0,
                    width: 30,
                    height: 30,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: '1px solid #d1d5db',
                    borderRadius: 6,
                    background: '#fff',
                    cursor: 'pointer',
                    color: '#6b7280'
                  }}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{
                      transform: ordersCollapsed ? 'rotate(-90deg)' : 'none',
                      transition: 'transform 0.15s'
                    }}
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
                </div>
              </div>
              {!ordersCollapsed && (
              <div className="positions-section order-section">
                <table
                  className="positions-table"
                  style={{ backgroundColor: '#fffbe6' }}
                >
                  <thead>
                    <tr>
                      <th style={{ width: '8%', textAlign: 'left' }}></th>
                      <th style={{ width: '16%', textAlign: 'left' }}>標的</th>
                      <th style={{ width: '11%', textAlign: 'left' }}>說明</th>
                      <th style={{ width: '6%' }}>行動</th>
                      <th style={{ width: '8%' }}>數量</th>
                      <th style={{ width: '8%' }}>買價</th>
                      <th style={{ width: '8%' }}>賣價</th>
                      <th style={{ width: '7%' }}>中間</th>
                      <th style={{ width: '7%' }}>限價</th>
                      <th style={{ width: '8%' }}>成交價</th>
                      <th style={{ width: '7%' }}>傭金</th>
                      <th style={{ width: '8%' }}>狀態</th>
                      <th style={{ width: '7%' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const sorted = [...filteredOpenOrders].sort((a, b) => {
                        // 1. 委託時間（first-seen timestamp，desc = 新單在上）
                        const aKey = a.permId > 0 ? `p:${a.permId}` : `o:${a.orderId}`
                        const bKey = b.permId > 0 ? `p:${b.permId}` : `o:${b.orderId}`
                        const aT = orderSeenAtRef.current.get(aKey) ?? 0
                        const bT = orderSeenAtRef.current.get(bKey) ?? 0
                        if (aT !== bT) return bT - aT
                        // 2. 標的字母
                        const symCmp = (a.symbol || '').localeCompare(b.symbol || '')
                        if (symCmp !== 0) return symCmp
                        // 3. 帳戶 alias 字母
                        const an = formatAccountName(
                          accounts.find((x) => x.accountId === a.account)?.alias || a.account
                        )
                        const bn = formatAccountName(
                          accounts.find((x) => x.accountId === b.account)?.alias || b.account
                        )
                        return an.localeCompare(bn)
                      })

                      // Group orders that share the same 標的 + 行動 (i.e. one
                      // batch placed across many accounts), preserving sort
                      // order. A multi-order group collapses to its first row.
                      const batchKey = (o: OpenOrderData): string =>
                        `${o.symbol}|${o.secType}|${o.comboDescription || ''}|${o.expiry || ''}|${o.strike || ''}|${o.right || ''}|${o.action}|${o.orderType}`
                      const groups: { key: string; orders: OpenOrderData[] }[] = []
                      const idxByKey = new Map<string, number>()
                      for (const o of sorted) {
                        const k = batchKey(o)
                        let gi = idxByKey.get(k)
                        if (gi === undefined) {
                          gi = groups.length
                          idxByKey.set(k, gi)
                          groups.push({ key: k, orders: [] })
                        }
                        groups[gi].orders.push(o)
                      }

                      // Within each batch, order accounts alphabetically by
                      // alias (so the rows — and the collapsed representative —
                      // read A→Z instead of by arrival time).
                      const aliasOf = (o: OpenOrderData): string =>
                        formatAccountName(
                          accounts.find((x) => x.accountId === o.account)?.alias || o.account
                        )
                      for (const g of groups) {
                        g.orders.sort((a, b) => aliasOf(a).localeCompare(aliasOf(b)))
                      }

                      return groups.flatMap((g) => {
                        if (g.orders.length === 1) return [renderOrderRow(g.orders[0])]
                        const collapsed = !expandedBatches.has(g.key)
                        const toggle = {
                          count: g.orders.length,
                          collapsed,
                          orders: g.orders,
                          onToggle: () =>
                            setExpandedBatches((prev) => {
                              const next = new Set(prev)
                              if (next.has(g.key)) next.delete(g.key)
                              else next.add(g.key)
                              return next
                            })
                        }
                        if (collapsed) return [renderOrderRow(g.orders[0], toggle)]
                        return g.orders.map((o, i) =>
                          renderOrderRow(o, i === 0 ? toggle : undefined)
                        )
                      })
                    })()}
                  </tbody>
                </table>
              </div>
              )}
            </div>
          )}
          <div
            style={
              filterAccount
                ? {
                    display: 'grid',
                    gridTemplateColumns: '40fr 60fr',
                    gap: 16,
                    alignItems: 'stretch'
                  }
                : undefined
            }
          >
          <div
            className="accounts-grid"
            style={filterAccount ? { gridTemplateColumns: '1fr' } : undefined}
          >
            {orderedAccounts.map((account) => (
              <div
                key={account.accountId}
                className={`account-card${!filterAccount && selectedAccount === account.accountId ? ' account-card-selected' : ''}`}
                // Suppress browser's default "select the word under cursor" on
                // dblclick — otherwise text like "報酬率" gets highlighted every
                // time the user double-clicks to toggle the filter.
                onMouseDown={(e) => {
                  if (e.detail > 1) e.preventDefault()
                }}
                onClick={() => {
                  if (cardClickTimerRef.current) {
                    clearTimeout(cardClickTimerRef.current)
                  }
                  cardClickTimerRef.current = setTimeout(() => {
                    setSelectedAccount((prev) =>
                      prev === account.accountId ? null : account.accountId
                    )
                    cardClickTimerRef.current = null
                  }, 220)
                }}
                onDoubleClick={() => {
                  if (cardClickTimerRef.current) {
                    clearTimeout(cardClickTimerRef.current)
                    cardClickTimerRef.current = null
                  }
                  if (selectMode) return
                  setFilterAccount((prev) =>
                    prev === account.accountId ? '' : account.accountId
                  )
                }}
              >
                <div className="account-header">
                  <span className="account-id">
                    {formatAccountName(account.alias || account.accountId)}
                  </span>

                  <div style={{ display: 'flex', gap: '3px', alignItems: 'center', marginRight: -2 }}>
                    {showOperationMode && operationModes?.[account.accountId] && (
                      <span className="account-type-label">
                        {operationModes[account.accountId]}
                      </span>
                    )}
                    {showAccountType && TRADING_TYPE_OPTIONS.find(
                         (o) => o.value === (accountTypes?.[account.accountId] || 'reg_t')
                       )?.label && (
                      <span className="account-type-label">
                        {TRADING_TYPE_OPTIONS.find(
                          (o) => o.value === (accountTypes?.[account.accountId] || 'reg_t')
                        )?.label}
                      </span>
                    )}
                    {!selectMode && (() => {
                      const rate = returnRates?.[account.accountId]
                      if (rate === undefined) return null
                      if (rate === null)
                        return (
                          <span className="account-type-label" style={{ color: '#888' }}>
                            報酬率 --
                          </span>
                        )
                      const sign = rate >= 0 ? '+' : ''
                      return (
                        <span className="account-type-label" style={{ fontWeight: 600 }}>
                          報酬率 {sign}
                          {rate.toFixed(2)}%
                        </span>
                      )
                    })()}
                    {!selectMode && (
                      // Icon group: spaced like the batch-card header icons
                      // (gap 12px), kept slightly apart from the text labels.
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '12px',
                          marginLeft: '6px'
                        }}
                      >
                        <button
                          className="ai-advisor-btn icon-btn"
                          title="AI 交易建議"
                          onClick={(e) => {
                            e.stopPropagation()
                            setShowAiAdvisor(account.accountId)
                          }}
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M9 18h6" />
                            <path d="M10 22h4" />
                            <path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14" />
                          </svg>
                        </button>
                        {/* Add-note button: only shown when the account has no
                            note yet. Once a note exists, the box itself is the
                            entry point (click to edit). */}
                        {onSetReportNote && !reportNotes[account.accountId] && (
                          <button
                            className="ai-advisor-btn icon-btn"
                            title="新增註解"
                            onClick={(e) => {
                              e.stopPropagation()
                              setNoteEditorFor(`acct:${account.accountId}`)
                            }}
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              width="16"
                              height="16"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4Z" />
                            </svg>
                          </button>
                        )}
                      </div>
                    )}
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
                    {(() => {
                      if (account.totalCashValue < 0 && fedRate !== null) {
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
                            title={`BM ${fedRate.toFixed(2)}% + ${spread}% = ${(fedRate + spread).toFixed(2)}% p.a.`}
                          >
                            <span className="metric-label">日利息</span>
                            <span className="metric-value" style={{ color: '#b91c1c' }}>
                              -{dailyInterest.toFixed(0)}
                            </span>
                          </div>
                        )
                      }
                      if (
                        account.totalCashValue > 0 &&
                        account.netLiquidation >= 100_000 &&
                        fedRate !== null
                      ) {
                        const eligibleCash = Math.max(0, account.totalCashValue - 10_000)
                        const annualRatePct = Math.max(0, fedRate - 0.5)
                        const dailyCredit = (eligibleCash * (annualRatePct / 100)) / 360
                        if (dailyCredit > 0) {
                          return (
                            <div
                              className="metric"
                              title={`BM ${fedRate.toFixed(2)}% − 0.5% = ${annualRatePct.toFixed(2)}% p.a. on $${eligibleCash.toLocaleString()} (cash − $10K)`}
                            >
                              <span className="metric-label">日利息</span>
                              <span className="metric-value">+{dailyCredit.toFixed(0)}</span>
                            </div>
                          )
                        }
                      }
                      return (
                        <div className="metric">
                          <span className="metric-label">日利息</span>
                          <span className="metric-value">0</span>
                        </div>
                      )
                    })()}
                    <div className="metric">
                      <span className="metric-label">融資率</span>
                      <span className="metric-value">
                        {account.totalCashValue >= 0
                          ? '0'
                          : account.netLiquidation > 0
                            ? `${((-account.totalCashValue / account.netLiquidation) * 100).toFixed(1)}%`
                            : '-'}
                      </span>
                    </div>
                    {(() => {
                      const shortPuts = positions.filter(
                        (p) =>
                          p.account === account.accountId &&
                          p.secType === 'OPT' &&
                          (p.right === 'P' || p.right === 'PUT') &&
                          p.quantity < 0
                      )
                      const putTotal = shortPuts.reduce(
                        (sum, p) => sum + (p.strike || 0) * 100 * Math.abs(p.quantity),
                        0
                      )
                      const cash = account.totalCashValue
                      // 潛在融資 = (賣方總承接金額 − 現金) ÷ 淨值: if every short PUT were
                      // assigned, the cash you'd still need to borrow as a % of equity.
                      // Spare cash lowers it; an existing margin loan (negative cash)
                      // raises it. marginLimit is a leverage ratio so the threshold is −1.
                      const potentialPct =
                        account.netLiquidation > 0
                          ? (putTotal - cash) / account.netLiquidation
                          : null
                      return (
                        <div
                          className="metric"
                          title="計算說明"
                          style={{
                            cursor: 'pointer',
                            ...(potentialPct !== null && potentialPct > marginLimit - 1
                              ? { backgroundColor: '#ffe4e6', borderRadius: '4px' }
                              : undefined)
                          }}
                          onClick={(e) => {
                            e.stopPropagation()
                            const puts = shortPuts.map((p) => ({
                              label: `${p.symbol} ${p.strike}P × ${Math.abs(p.quantity)}口`,
                              notional: (p.strike || 0) * 100 * Math.abs(p.quantity)
                            }))
                            setMarginExplain({
                              name: formatAccountName(account.alias || account.accountId),
                              cash,
                              netLiq: account.netLiquidation,
                              currency: account.currency,
                              puts,
                              putTotal,
                              pct: potentialPct !== null ? potentialPct * 100 : null
                            })
                          }}
                        >
                          <span className="metric-label">潛在融資</span>
                          <span className="metric-value">
                            {potentialPct !== null
                              ? `${(potentialPct * 100).toFixed(0)}%`
                              : '-'}
                          </span>
                        </div>
                      )
                    })()}
                  </div>
                )}

                {/* 裸賣 CALL warning — uncovered short calls per underlying.
                    Mirrors the website daily-trades badge; placed right under
                    the metrics so it's the first thing read on the card. */}
                {!selectMode && (() => {
                  const nakedCalls = nakedByAccount.get(account.accountId)
                  if (!nakedCalls || nakedCalls.length === 0) return null
                  return (
                    <div className="naked-call-warnings">
                      {nakedCalls.map((c) => (
                        <div key={c.u} className="naked-call-badge">
                          ⚠ 請儘速處理裸賣 {c.u} CALL：{c.short}口 vs{' '}
                          {c.shares.toLocaleString('en-US')} 股
                          {c.long > 0 ? ` + ${c.long}口長倉` : ''}
                        </div>
                      ))}
                    </div>
                  )
                })()}

                {/* Daily-report note (from website USERS.report_note).
                    Always rendered when the account is editable so the user
                    can also CREATE a new note inline. */}
                {onSetReportNote && (
                  <ReportNoteBox
                    value={reportNotes[account.accountId]}
                    quotes={quotes}
                    onSave={(v) => onSetReportNote(account.accountId, v)}
                    open={noteEditorFor === `acct:${account.accountId}`}
                    onClose={() =>
                      setNoteEditorFor((p) =>
                        p === `acct:${account.accountId}` ? null : p
                      )
                    }
                  />
                )}

                {/* Stock Positions (category view) */}
                {!acctViewBySymbol &&
                  selectMode !== 'OPT' &&
                  getPositionsForAccount(account.accountId).filter((p) => p.secType !== 'OPT')
                    .length > 0 && (
                    <div className="positions-section">
                      <table className="positions-table">
                        <thead>
                          <tr>
                            <th style={{ width: '32%', textAlign: 'left' }}></th>
                            <th style={{ width: '11%' }}>持倉</th>
                            <th style={{ width: '16%' }}>成本</th>
                            <th style={{ width: '16%' }}>現價</th>
                            <th style={{ width: '14%' }}>盈虧</th>
                          </tr>
                        </thead>
                        <tbody>
                          {getPositionsForAccount(account.accountId)
                            .filter((p) => p.secType !== 'OPT')
                            .map((pos, idx) => (
                              <tr
                                key={idx}
                                className={`pos-hoverable-row ${
                                  stkContextMenu && posKey(stkContextMenu.pos) === posKey(pos)
                                    ? 'force-active'
                                    : ''
                                } ${
                                  selectMode === 'STK'
                                    ? `selectable-row${selectedPositions.has(posKey(pos)) ? ' selected' : ''}`
                                    : ''
                                }`}
                                onClick={
                                  selectMode === 'STK'
                                    ? () => togglePosition(posKey(pos))
                                    : undefined
                                }
                                onContextMenu={(e) => {
                                  e.preventDefault()
                                  setSelectedPositions(new Set([posKey(pos)]))
                                  setStkContextMenu({ x: e.clientX, y: e.clientY, pos })
                                }}
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
                                <td
                                  style={{
                                    color: '#fff',
                                    fontWeight: 500,
                                    backgroundColor: pos.quantity > 0 ? '#1a6b3a' : '#dc2626'
                                  }}
                                >
                                  {pos.quantity.toLocaleString()}
                                </td>
                                {(() => {
                                  const icKey = `${pos.account}|${pos.symbol}`
                                  const ic = initialCosts[icKey]
                                  return <td>{ic != null ? ic.toFixed(2) : '-'}</td>
                                })()}
                                <td>{quotes[pos.symbol] ? quotes[pos.symbol].toFixed(2) : '-'}</td>
                                {(() => {
                                  const icKey = `${pos.account}|${pos.symbol}`
                                  const icCost = initialCosts[icKey]
                                  const costBasis = icCost != null ? icCost : pos.avgCost
                                  const stkPnl = quotes[pos.symbol]
                                    ? (quotes[pos.symbol] - costBasis) * pos.quantity
                                    : null
                                  return (
                                    <td
                                      style={
                                        stkPnl != null
                                          ? {
                                              color: '#fff',
                                              fontWeight: 500,
                                              backgroundColor: stkPnl >= 0 ? '#1a6b3a' : '#dc2626'
                                            }
                                          : undefined
                                      }
                                    >
                                      {stkPnl != null
                                        ? stkPnl.toLocaleString('en-US', {
                                            maximumFractionDigits: 0
                                          })
                                        : '-'}
                                    </td>
                                  )
                                })()}
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                {/* Option Positions (category view) */}
                {!acctViewBySymbol &&
                  selectMode !== 'STK' &&
                  getPositionsForAccount(account.accountId).filter((p) => p.secType === 'OPT')
                    .length > 0 && (
                    <div className="positions-section">
                      <table className="positions-table">
                        <thead>
                          <tr>
                            <th style={{ width: '32%', textAlign: 'left' }}></th>
                            <th style={{ width: '11%' }}>持倉</th>
                            <th style={{ width: '11%' }}>到期</th>
                            <th style={{ width: '10%' }}>均價</th>
                            <th style={{ width: '11%' }}>現價</th>
                            <th style={{ width: '14%' }}>盈虧</th>
                          </tr>
                        </thead>
                        <tbody>
                          {getPositionsForAccount(account.accountId)
                            .filter((p) => p.secType === 'OPT')
                            .map((pos, idx) => (
                              <tr
                                key={idx}
                                className={`pos-hoverable-row ${
                                  optContextMenu && posKey(optContextMenu.pos) === posKey(pos)
                                    ? 'force-active'
                                    : ''
                                } ${
                                  selectMode === 'OPT'
                                    ? `selectable-row${selectedPositions.has(posKey(pos)) ? ' selected' : ''}`
                                    : ''
                                }`}
                                onClick={
                                  selectMode === 'OPT'
                                    ? () => togglePosition(posKey(pos))
                                    : undefined
                                }
                                onContextMenu={(e) => {
                                  e.preventDefault()
                                  setSelectedPositions(new Set([posKey(pos)]))
                                  setOptContextMenu({ x: e.clientX, y: e.clientY, pos })
                                }}
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
                                  {filterAccount && (() => {
                                    const r =
                                      pos.right === 'C' || pos.right === 'CALL' ? 'C' : 'P'
                                    const gid =
                                      optionGroups[
                                        `${pos.account}|${pos.expiry}|${pos.strike}|${r}`
                                      ]
                                    if (!gid) return null
                                    return (
                                      <span
                                        className="option-group-pill"
                                        style={{ marginLeft: 6, cursor: 'pointer' }}
                                        title="點擊開啟群組明細"
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          setGroupDetailDialog({
                                            account: pos.account,
                                            group: gid
                                          })
                                        }}
                                      >
                                        {gid}
                                      </span>
                                    )
                                  })()}
                                </td>
                                <td
                                  style={{
                                    color: '#fff',
                                    fontWeight: 500,
                                    backgroundColor: pos.quantity > 0 ? '#1a6b3a' : '#dc2626'
                                  }}
                                >
                                  {pos.quantity.toLocaleString()}
                                </td>
                                {(() => {
                                  const days = tradingDaysUntil(pos.expiry)
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
                                        <td
                                          style={{
                                            color: '#fff',
                                            fontWeight: 500,
                                            backgroundColor: pnl >= 0 ? '#1a6b3a' : '#dc2626'
                                          }}
                                        >
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

                {/* By-underlying view */}
                {acctViewBySymbol &&
                  !selectMode &&
                  (() => {
                    const acctPositions = getPositionsForAccount(account.accountId)
                    // Group by underlying symbol
                    const symbolMap = new Map<
                      string,
                      { stk: PositionData[]; opt: PositionData[] }
                    >()
                    for (const p of acctPositions) {
                      if (!symbolMap.has(p.symbol)) symbolMap.set(p.symbol, { stk: [], opt: [] })
                      const entry = symbolMap.get(p.symbol)!
                      if (p.secType === 'OPT') entry.opt.push(p)
                      else entry.stk.push(p)
                    }
                    const symbols = Array.from(symbolMap.keys()).sort((a, b) => {
                      const getPriority = (sym: string) => {
                        if (sym === 'QQQ') return 0
                        if (sym === 'TQQQ') return 1
                        if (sym === 'SQQQ') return 2
                        const entry = symbolMap.get(sym)!
                        const hasStk = entry.stk.length > 0
                        const hasOpt = entry.opt.length > 0
                        if (hasStk && hasOpt) return 10
                        if (!hasStk && hasOpt) return 20
                        if (hasStk && !hasOpt) return 30
                        return 40
                      }
                      const priorityA = getPriority(a)
                      const priorityB = getPriority(b)
                      if (priorityA !== priorityB) return priorityA - priorityB
                      return a.localeCompare(b)
                    })
                    if (symbols.length === 0) return null
                    const elements: React.JSX.Element[] = []
                    const standaloneStocks: PositionData[] = []

                    symbols.forEach((sym) => {
                      const { stk, opt } = symbolMap.get(sym)!
                      if (opt.length === 0 && stk.length > 0) {
                        standaloneStocks.push(...stk)
                        return
                      }

                      // Compute total PnL for this underlying
                      let totalPnl = 0
                      for (const p of stk) {
                        const icCost = initialCosts[`${p.account}|${p.symbol}`]
                        const cb = icCost != null ? icCost : p.avgCost
                        if (quotes[p.symbol]) totalPnl += (quotes[p.symbol] - cb) * p.quantity
                      }
                      for (const p of opt) {
                        const key = `${p.symbol}|${p.expiry}|${p.strike}|${p.right}`
                        const lp = optionQuotes[key]
                        if (lp != null && lp > 0)
                          totalPnl += (lp - p.avgCost / 100) * p.quantity * 100
                      }
                      elements.push(
                        <div
                          key={sym}
                          className="positions-section"
                          style={{ marginBottom: '6px' }}
                        >
                          <table className="positions-table" style={{ tableLayout: 'fixed' }}>
                            <thead>
                              <tr>
                                <th style={{ width: '32%', textAlign: 'left' }}></th>
                                <th style={{ width: '12%' }}>持倉</th>
                                <th style={{ width: '12%' }}>到期</th>
                                <th style={{ width: '15%' }}>均價</th>
                                <th style={{ width: '15%' }}>現價</th>
                                <th style={{ width: '14%' }}>盈虧</th>
                              </tr>
                            </thead>
                            <tbody>
                              {stk.map((pos, idx) => {
                                const icKey = `${pos.account}|${pos.symbol}`
                                const ic = initialCosts[icKey]
                                const costBasis = ic != null ? ic : pos.avgCost
                                const stkPnl = quotes[pos.symbol]
                                  ? (quotes[pos.symbol] - costBasis) * pos.quantity
                                  : null
                                return (
                                  <tr
                                    key={`stk-${idx}`}
                                    className={`pos-hoverable-row ${stkContextMenu && posKey(stkContextMenu.pos) === posKey(pos) ? 'force-active' : ''}`}
                                    onContextMenu={(e) => {
                                      e.preventDefault()
                                      setSelectedPositions(new Set([posKey(pos)]))
                                      setStkContextMenu({ x: e.clientX, y: e.clientY, pos })
                                    }}
                                  >
                                    <td className="pos-symbol" style={{ width: '32%' }}>
                                      {formatPositionSymbol(pos)}
                                    </td>
                                    <td
                                      style={{
                                        width: '12%',
                                        color: '#fff',
                                        fontWeight: 500,
                                        backgroundColor: pos.quantity > 0 ? '#1a6b3a' : '#dc2626'
                                      }}
                                    >
                                      {pos.quantity.toLocaleString()}
                                    </td>
                                    <td style={{ width: '12%' }}> </td>
                                    <td style={{ width: '15%' }}>{costBasis.toFixed(2)}</td>
                                    <td style={{ width: '15%' }}>
                                      {quotes[pos.symbol] ? quotes[pos.symbol].toFixed(2) : '-'}
                                    </td>
                                    <td
                                      style={{
                                        width: '14%',
                                        ...(stkPnl != null
                                          ? {
                                              color: '#fff',
                                              fontWeight: 500,
                                              backgroundColor: stkPnl >= 0 ? '#1a6b3a' : '#dc2626'
                                            }
                                          : {})
                                      }}
                                    >
                                      {stkPnl != null
                                        ? stkPnl.toLocaleString('en-US', {
                                            maximumFractionDigits: 0
                                          })
                                        : '-'}
                                    </td>
                                  </tr>
                                )
                              })}
                              {opt.map((pos, idx) => {
                                const days = tradingDaysUntil(pos.expiry)
                                const oKey = `${pos.symbol}|${pos.expiry}|${pos.strike}|${pos.right}`
                                const lastPrice = optionQuotes[oKey]
                                const avgUnit = pos.avgCost / 100
                                const optPnl =
                                  lastPrice != null && lastPrice > 0
                                    ? (lastPrice - avgUnit) * pos.quantity * 100
                                    : null
                                return (
                                  <tr
                                    key={`opt-${idx}`}
                                    className={`pos-hoverable-row ${optContextMenu && posKey(optContextMenu.pos) === posKey(pos) ? 'force-active' : ''}`}
                                    onContextMenu={(e) => {
                                      e.preventDefault()
                                      setSelectedPositions(new Set([posKey(pos)]))
                                      setOptContextMenu({ x: e.clientX, y: e.clientY, pos })
                                    }}
                                  >
                                    <td className="pos-symbol" style={{ width: '32%' }}>
                                      {formatPositionSymbol(pos)}
                                    </td>
                                    <td
                                      style={{
                                        width: '12%',
                                        color: '#fff',
                                        fontWeight: 500,
                                        backgroundColor: pos.quantity > 0 ? '#1a6b3a' : '#dc2626'
                                      }}
                                    >
                                      {pos.quantity.toLocaleString()}
                                    </td>
                                    <td
                                      style={{
                                        width: '12%',
                                        ...(days === 0
                                          ? { backgroundColor: '#fff0f0' }
                                          : days === 1
                                            ? { backgroundColor: '#e8f4fd' }
                                            : {})
                                      }}
                                    >
                                      {days !== null ? days : '-'}
                                    </td>
                                    <td style={{ width: '15%' }}>{avgUnit.toFixed(2)}</td>
                                    <td style={{ width: '15%' }}>
                                      {lastPrice != null && lastPrice > 0
                                        ? lastPrice.toFixed(2)
                                        : '-'}
                                    </td>
                                    <td
                                      style={{
                                        width: '14%',
                                        ...(optPnl != null
                                          ? {
                                              color: '#fff',
                                              fontWeight: 500,
                                              backgroundColor: optPnl >= 0 ? '#1a6b3a' : '#dc2626'
                                            }
                                          : {})
                                      }}
                                    >
                                      {optPnl != null ? Math.round(optPnl).toLocaleString() : '-'}
                                    </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      )
                    })

                    if (standaloneStocks.length > 0) {
                      elements.push(
                        <div
                          key="standalone-stocks"
                          className="positions-section"
                          style={{ marginBottom: '6px' }}
                        >
                          <table className="positions-table" style={{ tableLayout: 'fixed' }}>
                            <thead>
                              <tr>
                                <th style={{ width: '32%', textAlign: 'left' }}></th>
                                <th style={{ width: '12%' }}>持倉</th>
                                <th style={{ width: '12%' }}>到期</th>
                                <th style={{ width: '15%' }}>均價</th>
                                <th style={{ width: '15%' }}>現價</th>
                                <th style={{ width: '14%' }}>盈虧</th>
                              </tr>
                            </thead>
                            <tbody>
                              {standaloneStocks.map((pos, idx) => {
                                const icKey = `${pos.account}|${pos.symbol}`
                                const ic = initialCosts[icKey]
                                const costBasis = ic != null ? ic : pos.avgCost
                                const stkPnl = quotes[pos.symbol]
                                  ? (quotes[pos.symbol] - costBasis) * pos.quantity
                                  : null
                                return (
                                  <tr
                                    key={`stk-standalone-${idx}`}
                                    className={`pos-hoverable-row ${stkContextMenu && posKey(stkContextMenu.pos) === posKey(pos) ? 'force-active' : ''}`}
                                    onContextMenu={(e) => {
                                      e.preventDefault()
                                      setSelectedPositions(new Set([posKey(pos)]))
                                      setStkContextMenu({ x: e.clientX, y: e.clientY, pos })
                                    }}
                                  >
                                    <td className="pos-symbol" style={{ width: '32%' }}>
                                      {formatPositionSymbol(pos)}
                                    </td>
                                    <td
                                      style={{
                                        width: '12%',
                                        color: '#fff',
                                        fontWeight: 500,
                                        backgroundColor: pos.quantity > 0 ? '#1a6b3a' : '#dc2626'
                                      }}
                                    >
                                      {pos.quantity.toLocaleString()}
                                    </td>
                                    <td style={{ width: '12%' }}> </td>
                                    <td style={{ width: '15%' }}>{costBasis.toFixed(2)}</td>
                                    <td style={{ width: '15%' }}>
                                      {quotes[pos.symbol] ? quotes[pos.symbol].toFixed(2) : '-'}
                                    </td>
                                    <td
                                      style={{
                                        width: '14%',
                                        ...(stkPnl != null
                                          ? {
                                              color: '#fff',
                                              fontWeight: 500,
                                              backgroundColor: stkPnl >= 0 ? '#1a6b3a' : '#dc2626'
                                            }
                                          : {})
                                      }}
                                    >
                                      {stkPnl != null
                                        ? stkPnl.toLocaleString('en-US', {
                                            maximumFractionDigits: 0
                                          })
                                        : '-'}
                                    </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      )
                    }

                    return elements
                  })()}

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
                            const grouped = new Map<string, (typeof filtered)[0]>()
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
                                        style={{
                                          color: '#956b3a',
                                          fontWeight: 400,
                                          margin: '0 3px'
                                        }}
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
                                const isOptionExpiry =
                                  exec.orderId === 0 && exec.price === 0 && exec.secType === 'OPT'
                                // Check if there's a matching stock trade at the strike price → assigned
                                const isAssigned =
                                  isOptionExpiry &&
                                  executions.some(
                                    (e) =>
                                      e.account === exec.account &&
                                      e.secType === 'STK' &&
                                      e.symbol === exec.symbol &&
                                      Math.abs(e.avgPrice - (exec.strike || 0)) < 0.01
                                  )
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
                                      {isOptionExpiry && (
                                        <span
                                          style={
                                            isAssigned
                                              ? {
                                                  color: '#fff',
                                                  backgroundColor: '#d35400',
                                                  fontWeight: 600,
                                                  marginLeft: 6,
                                                  fontSize: '1em',
                                                  padding: '4px 6px',
                                                  margin: '-4px 0 -4px 6px'
                                                }
                                              : {
                                                  color: '#1a6baa',
                                                  fontWeight: 600,
                                                  marginLeft: 6,
                                                  fontSize: '0.92em'
                                                }
                                          }
                                        >
                                          {isAssigned ? '被行權' : '(到期)'}
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
                                    <td
                                      style={{
                                        color: '#fff',
                                        fontWeight: 500,
                                        backgroundColor: exec.side === 'BOT' ? '#1a6b3a' : '#dc2626'
                                      }}
                                    >
                                      {exec.quantity}
                                    </td>
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
          {filterAccount && (accountGroupsLoading || accountGroups !== null) && (
            <div style={{ position: 'relative', minHeight: 0 }}>
            <div
              className="trade-groups-panel"
              style={{
                marginTop: 0,
                position: 'absolute',
                inset: 0,
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden'
              }}
            >
              <div className="trade-groups-header">
                <div className="trade-groups-title">
                  期權交易群組
                  {accountGroupsLoading && (
                    <span style={{ marginLeft: 8, fontSize: 12, color: '#888' }}>讀取中...</span>
                  )}
                </div>
                {accountGroupsSummary && (
                  <div className="trade-groups-summary">
                    <div className="trade-groups-summary-chip">
                      盈虧{' '}
                      <span className={accountGroupsSummary.totalProfit >= 0 ? 'tg-pos' : 'tg-neg'}>
                        {accountGroupsSummary.totalProfit > 0 ? '+' : ''}
                        {Math.round(accountGroupsSummary.totalProfit).toLocaleString('en-US')}
                      </span>
                    </div>
                  </div>
                )}
              </div>
              {accountGroupsError ? (
                <div className="empty-state" style={{ padding: '16px', color: '#c0392b' }}>
                  讀取失敗：{accountGroupsError}
                </div>
              ) : accountGroups && accountGroups.length === 0 ? (
                <div className="empty-state" style={{ padding: '16px' }}>
                  {accountGroupsLoading ? '' : '目前沒有群組資料'}
                </div>
              ) : (
                <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
                <table className="trade-groups-table">
                  <thead>
                    <tr>
                      <th style={{ width: '40px', textAlign: 'center' }}></th>
                      <th>群組</th>
                      <th style={{ width: '60px', textAlign: 'center' }}>筆數</th>
                      <th style={{ width: '80px', textAlign: 'center' }}>起始日</th>
                      <th style={{ minWidth: '200px' }}>最後交易</th>
                      <th style={{ width: '130px' }}>持股成本</th>
                      <th style={{ width: '90px', textAlign: 'center' }}>盈虧</th>
                      <th style={{ width: '70px', textAlign: 'center' }}>狀態</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(accountGroups || []).map((g, idx) => {
                      // Insert an empty spacer row at the Active → Terminated
                      // transition, mirroring the divider on the website.
                      const prev = idx > 0 ? (accountGroups || [])[idx - 1] : null
                      const isStatusBoundary =
                        prev && prev.status === 'Active' && g.status === 'Terminated'
                      const startDate = (() => {
                        if (!g.startDate) return ''
                        const d = new Date(g.startDate * 1000)
                        return `${String(d.getFullYear()).slice(-2)}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
                      })()
                      const renderLatest = () => {
                        const lt = g.latestTrade
                        if (!lt) return '-'
                        const qty = lt.quantity != null
                          ? `${lt.quantity}${lt.type === 'STK' ? '股' : '口'}`
                          : ''
                        if (lt.type === 'STK') {
                          const assignedTxt = lt.is_assigned ? '，被行權' : ''
                          const priceTxt = lt.underlying_price != null
                            ? ` (均價 ${lt.underlying_price.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}${assignedTxt})`
                            : assignedTxt
                          return (
                            <>
                              {qty && <span className="trade-groups-qty">{qty}</span>}
                              {lt.underlying}{priceTxt}
                            </>
                          )
                        }
                        const right = lt.type === 'PUT' ? 'P' : 'C'
                        const exp = lt.to_date
                          ? (() => {
                              const d = new Date(lt.to_date * 1000)
                              return `${MONTHS[d.getMonth()]}${d.getDate()}'${String(d.getFullYear()).slice(-2)}`
                            })()
                          : ''
                        return (
                          <>
                            {qty && <span className="trade-groups-qty">{qty}</span>}
                            {lt.underlying} {exp} <span style={{ textDecoration: 'underline' }}>{lt.strike_price}{right}</span>
                          </>
                        )
                      }
                      const opBadge = (() => {
                        const op = g.latestTrade?.operation || 'Open'
                        const baseStyle: React.CSSProperties = {
                          marginLeft: 8,
                          padding: '0 6px',
                          borderRadius: 4,
                          fontSize: 11,
                          fontWeight: 500,
                          lineHeight: '1.2'
                        }
                        if (op === 'Assigned') return <span style={{ ...baseStyle, background: '#fde2e2', color: '#c0392b' }}>{op}</span>
                        if (op === 'Expired') return <span style={{ ...baseStyle, background: '#dcfce7', color: '#166534', borderRadius: 12 }}>{op}</span>
                        if (op === 'Transferred') return <span style={{ ...baseStyle, background: '#e0f2fe', color: '#075985', borderRadius: 12 }}>{op}</span>
                        if (op === 'Closed') return <span style={{ ...baseStyle, background: '#e5e7eb', color: '#374151', borderRadius: 12 }}>{op}</span>
                        if (op === 'Open') return null
                        return <span style={{ ...baseStyle, color: '#9ca3af' }}>{op}</span>
                      })()
                      const numClass = (v: number, inverted = false) =>
                        v === 0 ? '' : (inverted ? (v > 0 ? 'tg-neg' : 'tg-pos') : (v > 0 ? 'tg-pos' : 'tg-neg'))
                      const fmt = (v: number, withSign = true) =>
                        v === 0 ? '-' : (withSign && v > 0 ? '+' : '') + Math.round(v).toLocaleString('en-US')
                      return (
                        <React.Fragment key={g.name}>
                          {isStatusBoundary && (
                            <tr className="trade-groups-divider">
                              <td colSpan={8} />
                            </tr>
                          )}
                        <tr
                          className="trade-groups-row"
                          onClick={() => {
                            if (!filterAccount) return
                            setGroupDetailDialog({ account: filterAccount, group: g.name })
                          }}
                          title="點擊開啟群組明細"
                        >
                          <td style={{ textAlign: 'center', color: '#888' }}>{(accountGroups || []).length - idx}.</td>
                          <td style={{ fontWeight: 600, fontSize: 12 }}>{g.name}</td>
                          <td style={{ textAlign: 'center' }}>{g.count}</td>
                          <td style={{ textAlign: 'center' }}>{startDate}</td>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            {renderLatest()}{opBadge}
                          </td>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            {g.holdingShares !== 0
                              ? <>股{Math.abs(g.holdingShares).toLocaleString('en-US')}，<span style={{ textDecoration: 'underline' }}>均{g.holdingAvgPrice.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span></>
                              : '-'}
                          </td>
                          <td className={`tg-center ${numClass(g.profit)}`}>{fmt(g.profit)}</td>
                          <td style={{ textAlign: 'center' }}>
                            <span className={g.status === 'Active' ? 'tg-status-active' : 'tg-status-terminated'}>
                              {g.status === 'Active' ? '進行中' : '已終止'}
                            </span>
                          </td>
                        </tr>
                        </React.Fragment>
                      )
                    })}
                  </tbody>
                </table>
                </div>
              )}
            </div>
            </div>
          )}
          </div>
          </>
        )}
      </div>
      <RollOptionDialog
        open={showRollDialog}
        onClose={() => {
          setShowRollDialog(false)
          setObserveGroupId(null)
          setRollInitialTarget(null)
        }}
        selectedPositions={positions.filter((p) => selectedPositions.has(posKey(p)))}
        accounts={accounts}
        observeMode={observeGroupId !== null}
        initialTarget={rollInitialTarget ?? undefined}
        onObserve={(target) => {
          const g = symbolGroups.find((x) => x.id === observeGroupId)
          if (g) {
            const cur = Array.isArray(g.rollWatch)
              ? g.rollWatch
              : g.rollWatch
                ? [g.rollWatch]
                : []
            // Drop an exact duplicate, append the new target, keep the last 4.
            const next = [
              ...cur.filter(
                (w) =>
                  !(
                    w.expiry === target.expiry &&
                    w.strike === target.strike &&
                    w.right === target.right
                  )
              ),
              target
            ].slice(-4)
            onUpdateSymbolGroup?.({ ...g, rollWatch: next })
          }
          setObserveGroupId(null)
        }}
        onRollComplete={(rolledPositions, target) => {
          // Store intent: will be applied once IB confirms the fill via position updates
          setPendingRollUpdate({ rolledPositions, target })
        }}
      />
      {marginExplain &&
        (() => {
          const money = (v: number): string => formatCurrency(v, marginExplain.currency)
          // 現金 is signed: a negative balance (existing margin loan) increases what
          // you'd still need to borrow, so render it as "+ |cash|" in the equation.
          const cashTerm =
            marginExplain.cash < 0
              ? `+ ${money(-marginExplain.cash)}`
              : `− ${money(marginExplain.cash)}`
          const row = (label: string, value: string, bold = false): React.JSX.Element => (
            <div
              style={{
                display: 'flex',
                gap: 2,
                padding: '3px 0',
                fontWeight: bold ? 700 : 400
              }}
            >
              <span>{label}：</span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</span>
            </div>
          )
          return (
            <div className="roll-dialog-overlay" onClick={() => setMarginExplain(null)}>
              <div
                className="roll-dialog"
                style={{ width: 460, maxWidth: '92vw' }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="roll-dialog-header">
                  <span style={{ fontSize: 18, lineHeight: 1 }}>📊</span>
                  <h3>潛在融資 計算說明 — {marginExplain.name}</h3>
                  <button className="roll-dialog-close" onClick={() => setMarginExplain(null)}>
                    ✕
                  </button>
                </div>
                <div
                  className="roll-dialog-body"
                  style={{ fontSize: 14, color: '#374151', lineHeight: 1.7 }}
                >
                  <p style={{ marginTop: 0 }}>
                    假設<b>賣出的所有 PUT 全被指派</b>(以履約價買進標的)，承接金額先扣掉手上現金,
                    剩下需要動用的融資佔淨值多少,就是「潛在融資」。
                  </p>
                  <div
                    style={{
                      background: '#f8f6f2',
                      borderRadius: 6,
                      padding: '10px 12px',
                      marginTop: 14,
                      marginBottom: 12
                    }}
                  >
                    潛在融資 ＝ (賣方總承接金額 − 現金) ÷ 淨值
                  </div>
                  {row('淨值', money(marginExplain.netLiq))}
                  {row('現金', money(marginExplain.cash))}
                  <div style={{ marginTop: 6 }}>
                    期權賣方總承接金額：{money(marginExplain.putTotal)}
                  </div>
                  {marginExplain.puts.length === 0 ? (
                    <div style={{ padding: '3px 0' }}>（此帳戶目前無賣出 PUT）</div>
                  ) : (
                    marginExplain.puts.map((p, i) => (
                      <div
                        key={i}
                        style={{
                          display: 'flex',
                          gap: 2,
                          padding: '2px 0 2px 12px',
                          fontSize: 13
                        }}
                      >
                        <span>{p.label}：</span>
                        <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                          {money(p.notional)}
                        </span>
                      </div>
                    ))
                  )}
                  <div style={{ borderTop: '1px solid #e5e7eb', margin: '8px 0' }} />
                  {row(
                    '潛在融資',
                    marginExplain.pct === null
                      ? '-'
                      : marginExplain.netLiq > 0
                        ? `(${money(marginExplain.putTotal)} ${cashTerm}) ÷ ${money(marginExplain.netLiq)} = ${marginExplain.pct.toFixed(0)}%`
                        : `${marginExplain.pct.toFixed(0)}%`,
                    true
                  )}
                </div>
              </div>
            </div>
          )
        })()}
      {rollWarnMsg && (
        <div className="roll-dialog-overlay" onClick={() => setRollWarnMsg(null)}>
          <div
            className="roll-dialog"
            style={{ width: 420, maxWidth: '92vw' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="roll-dialog-header">
              <span style={{ fontSize: 20, lineHeight: 1 }}>⚠️</span>
              <h3>{rollWarnMsg.title}</h3>
              <button className="roll-dialog-close" onClick={() => setRollWarnMsg(null)}>
                ✕
              </button>
            </div>
            <div
              className="roll-dialog-body"
              style={{ fontSize: 14, color: '#374151', lineHeight: 1.7 }}
            >
              {rollWarnMsg.message}
            </div>
            <div
              style={{
                padding: '12px 20px',
                borderTop: '1px solid var(--border-color)',
                display: 'flex',
                justifyContent: 'flex-end'
              }}
            >
              <button
                className="select-toggle-btn active"
                style={{ minWidth: 80 }}
                onClick={() => setRollWarnMsg(null)}
              >
                確定
              </button>
            </div>
          </div>
        </div>
      )}
      {deleteGroupConfirm && (
        <div className="roll-dialog-overlay" onClick={() => setDeleteGroupConfirm(null)}>
          <div
            className="roll-dialog"
            style={{ width: 420, maxWidth: '92vw' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="roll-dialog-header" style={{ borderBottom: 'none' }}>
              <span style={{ fontSize: 20, lineHeight: 1 }}>🗑️</span>
              <h3>刪除群組</h3>
              <button
                className="roll-dialog-close"
                onClick={() => setDeleteGroupConfirm(null)}
              >
                ✕
              </button>
            </div>
            <div
              className="roll-dialog-body"
              style={{ fontSize: 14, color: '#374151', lineHeight: 1.7 }}
            >
              確定要刪除群組「<strong>{deleteGroupConfirm.name}</strong>」嗎?
            </div>
            <div
              style={{
                padding: '12px 20px',
                display: 'flex',
                justifyContent: 'flex-end',
                gap: 8
              }}
            >
              <button
                className="select-toggle-btn"
                style={{ minWidth: 80 }}
                onClick={() => setDeleteGroupConfirm(null)}
              >
                取消
              </button>
              <button
                className="btn btn-danger"
                style={{ minWidth: 80 }}
                onClick={() => {
                  onDeleteSymbolGroup?.(deleteGroupConfirm.id)
                  setDeleteGroupConfirm(null)
                }}
              >
                刪除
              </button>
            </div>
          </div>
        </div>
      )}
      {cancelAllConfirm && (
        <div className="roll-dialog-overlay" onClick={() => setCancelAllConfirm(false)}>
          <div
            className="roll-dialog"
            style={{ width: 440, maxWidth: '92vw' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="roll-dialog-header" style={{ borderBottom: 'none' }}>
              <span style={{ fontSize: 20, lineHeight: 1 }}>⚠️</span>
              <h3>取消全部委託</h3>
              <button className="roll-dialog-close" onClick={() => setCancelAllConfirm(false)}>
                ✕
              </button>
            </div>
            <div
              className="roll-dialog-body"
              style={{ fontSize: 14, color: '#374151', lineHeight: 1.7 }}
            >
              確定要取消「<strong>全部</strong>」工作中委託嗎?
              <br />
              這會取消所有帳戶的委託,包含你在 TWS 手動下的單。
            </div>
            <div
              style={{
                padding: '12px 20px',
                display: 'flex',
                justifyContent: 'flex-end',
                gap: 8
              }}
            >
              <button
                className="select-toggle-btn"
                style={{ minWidth: 80 }}
                onClick={() => setCancelAllConfirm(false)}
              >
                取消
              </button>
              <button
                className="btn btn-danger"
                style={{ minWidth: 80 }}
                onClick={() => {
                  setCancelAllConfirm(false)
                  window.ibApi
                    .cancelAllOrders()
                    .then(() => {
                      setTimeout(() => refresh?.(), 300)
                      setTimeout(() => refresh?.(), 1000)
                      setTimeout(() => refresh?.(), 2000)
                    })
                    .catch((err: unknown) => alert('取消全部失敗: ' + String(err)))
                }}
              >
                取消全部
              </button>
            </div>
          </div>
        </div>
      )}
      {groupDetailDialog && (
        <TradeGroupDialog
          open={true}
          onClose={() => setGroupDetailDialog(null)}
          account={groupDetailDialog.account}
          alias={accounts.find((a) => a.accountId === groupDetailDialog.account)?.alias || groupDetailDialog.account}
          groupName={groupDetailDialog.group}
          d1Target={d1Target}
        />
      )}
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
            const currentSrc =
              positions.find(
                (p) => p.account === sp.account && p.symbol === sp.symbol && p.secType === 'STK'
              )?.quantity ?? 0
            const currentTgt =
              positions.find(
                (p) => p.account === sp.account && p.symbol === targetSymbol && p.secType === 'STK'
              )?.quantity ?? 0
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
        initialSymbol={optOrderInitialSymbol}
        initialAccountId={optOrderInitialAccountId}
        initialRight={optOrderInitialRight}
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

      {/* Context menu for Option Position */}
      {optContextMenu && (
        <div
          className="order-context-menu"
          style={{ position: 'fixed', top: optContextMenu.y, left: optContextMenu.x, zIndex: 9999 }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div
            className="order-context-menu-item"
            onClick={() => {
              setOptContextMenu(null)
              attemptRoll()
            }}
          >
            展期
          </div>
          <div
            className="order-context-menu-item"
            onClick={() => {
              setOptContextMenu(null)
              setShowCloseOptionDialog(true)
            }}
          >
            平倉
          </div>
        </div>
      )}

      {/* Context menu for Stock Position */}
      {stkContextMenu && (
        <div
          className="order-context-menu"
          style={{ position: 'fixed', top: stkContextMenu.y, left: stkContextMenu.x, zIndex: 9999 }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div
            className="order-context-menu-item"
            onClick={() => {
              setOptOrderInitialSymbol(stkContextMenu.pos.symbol)
              setOptOrderInitialAccountId(stkContextMenu.pos.account)
              setOptOrderInitialRight(undefined)
              setStkContextMenu(null)
              setShowOptionOrder(true)
            }}
          >
            賣期權
          </div>
          <div
            className="order-context-menu-item"
            onClick={() => {
              setStkContextMenu(null)
              setShowCloseDialog(true)
            }}
          >
            平倉
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
        onClose={() => {
          setShowAddGroup(false)
          setEditingGroup(null)
        }}
        positions={positions}
        accounts={accounts}
        uncategorizedKeys={new Set(uncategorizedPositions.map(posKey))}
        onAddGroup={onAddSymbolGroup!}
        editGroup={editingGroup}
        onUpdateGroup={onUpdateSymbolGroup}
      />
      <ObserveRulesDialog open={showObserveRules} onClose={() => setShowObserveRules(false)} />
    </>
  )
}
