import {
  Contract,
  ContractDetails,
  Order,
  OrderAction,
  OrderType,
  SecType,
  EventName,
  OptionType,
  Execution,
  ExecutionFilter,
  TimeInForce,
  ComboLeg
} from '@stoqey/ib'
import { getIBApi } from './connection'
import { getTradingClass } from './options'

export interface BatchOrderRequest {
  symbol: string
  action: 'BUY' | 'SELL'
  orderType: 'MKT' | 'LMT'
  limitPrice?: number
  totalQuantity: number
  allocation: AllocationConfig
  outsideRth?: boolean
  preMarket?: boolean
  tif?: 'DAY' | 'GTC'
}

export interface OptionBatchOrderRequest {
  symbol: string
  action: 'BUY' | 'SELL'
  orderType: 'MKT' | 'LMT'
  limitPrice?: number
  totalQuantity: number
  expiry: string
  strike: number
  right: 'C' | 'P'
  exchange?: string
  outsideRth?: boolean
}

export interface AllocationConfig {
  method: 'equal' | 'netLiq' | 'custom'
  // For 'custom' method: accountId -> quantity
  customAllocations?: Record<string, number>
  // For 'equal' and 'netLiq': which accounts to include
  accounts: string[]
}

export interface OrderStatusUpdate {
  orderId: number
  account: string
  status: string
  filled: number
  remaining: number
  avgFillPrice: number
  symbol: string
}

let nextOrderId = 0

// Called when IB sends the next valid order ID
export function setNextOrderId(id: number): void {
  nextOrderId = id
}

export function getNextOrderId(): number {
  return nextOrderId++
}

// Place stock orders for individual accounts
export async function placeBatchOrders(
  request: BatchOrderRequest,
  accountQuantities: Record<string, number>
): Promise<OrderStatusUpdate[]> {
  const api = getIBApi()
  if (!api) {
    throw new Error('Not connected to IB')
  }

  const contract: Contract = {
    symbol: request.symbol,
    secType: SecType.STK,
    exchange: 'SMART',
    currency: 'USD'
  }

  const results: OrderStatusUpdate[] = []
  const orderIds: number[] = []

  // Place an order for each account
  for (const [accountId, quantity] of Object.entries(accountQuantities)) {
    if (quantity <= 0) continue

    const orderId = getNextOrderId()
    orderIds.push(orderId)

    const order: Order = {
      action: request.action === 'BUY' ? OrderAction.BUY : OrderAction.SELL,
      orderType: request.orderType === 'MKT' ? OrderType.MKT : OrderType.LMT,
      totalQuantity: quantity,
      account: accountId,
      outsideRth: (request.outsideRth || request.preMarket) ?? false,
      tif: request.tif === 'GTC' ? TimeInForce.GTC : TimeInForce.DAY,
      transmit: true
    }

    if (request.orderType === 'LMT' && request.limitPrice) {
      order.lmtPrice = request.limitPrice
    }

    results.push({
      orderId,
      account: accountId,
      status: 'PendingSubmit',
      filled: 0,
      remaining: quantity,
      avgFillPrice: 0,
      symbol: request.symbol
    })

    api.placeOrder(orderId, contract, order)
    console.log(
      `[IB] Placed order #${orderId} for ${accountId}: ${request.action} ${quantity} ${request.symbol} | outsideRth=${order.outsideRth} tif=${order.tif}`
    )
  }

  return results
}

// Place option orders for individual accounts
export async function placeOptionBatchOrders(
  request: OptionBatchOrderRequest,
  accountQuantities: Record<string, number>
): Promise<OrderStatusUpdate[]> {
  const api = getIBApi()
  if (!api) {
    throw new Error('Not connected to IB')
  }

  const contract: Contract = {
    symbol: request.symbol,
    secType: SecType.OPT,
    exchange: request.exchange || 'SMART',
    currency: 'USD',
    lastTradeDateOrContractMonth: request.expiry,
    strike: request.strike,
    right: request.right === 'C' ? OptionType.Call : OptionType.Put,
    multiplier: 100
  }

  const results: OrderStatusUpdate[] = []

  for (const [accountId, quantity] of Object.entries(accountQuantities)) {
    if (quantity <= 0) continue

    const orderId = getNextOrderId()

    const order: Order = {
      action: request.action === 'BUY' ? OrderAction.BUY : OrderAction.SELL,
      orderType: request.orderType === 'MKT' ? OrderType.MKT : OrderType.LMT,
      totalQuantity: quantity,
      account: accountId,
      outsideRth: request.outsideRth ?? false,
      transmit: true
    }

    if (request.orderType === 'LMT' && request.limitPrice) {
      order.lmtPrice = request.limitPrice
    }

    results.push({
      orderId,
      account: accountId,
      status: 'PendingSubmit',
      filled: 0,
      remaining: quantity,
      avgFillPrice: 0,
      symbol: `${request.symbol} ${request.expiry} ${request.strike}${request.right}`
    })

    api.placeOrder(orderId, contract, order)
    console.log(
      `[IB] Placed option order #${orderId} for ${accountId}: ${request.action} ${quantity}x ${request.symbol} ${request.expiry} ${request.strike}${request.right}`
    )
  }

  return results
}

// ── Combo (BAG) roll order helpers ──────────────────────────────

export interface RollOrderRequest {
  symbol: string
  // Close leg
  closeExpiry: string
  closeStrike: number
  closeRight: 'C' | 'P'
  // Open leg
  openExpiry: string
  openStrike: number
  openRight: 'C' | 'P'
  // Order params
  action: 'BUY' | 'SELL' // action on the CLOSE leg (BUY to close short, SELL to close long)
  limitPrice: number // net combo limit price
  outsideRth?: boolean
}

// Map orderId → readable combo description for display
const comboDescriptionMap = new Map<number, string>()

let rollReqIdCounter = 500000
function getNextRollReqId(): number {
  return rollReqIdCounter++
}

/**
 * Resolve the conId for a specific option contract.
 */
async function resolveOptionConId(
  symbol: string,
  expiry: string,
  strike: number,
  right: 'C' | 'P'
): Promise<number> {
  const api = getIBApi()
  if (!api) throw new Error('Not connected to IB')

  return new Promise((resolve, reject) => {
    const reqId = getNextRollReqId()
    let settled = false

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true
        cleanup()
        reject(new Error(`Timeout resolving conId for ${symbol} ${expiry} ${strike}${right}`))
      }
    }, 10000)

    // Resolve tradingClass from chain cache to disambiguate QQQ weekly vs monthly options
    const tradingClass = getTradingClass(symbol, expiry)
    console.log(`[IB] resolveOptionConId: ${symbol} ${expiry} ${strike}${right}, tradingClass=${tradingClass ?? 'none'}`)

    const contract: Contract = {
      symbol,
      secType: SecType.OPT,
      exchange: 'SMART',
      currency: 'USD',
      lastTradeDateOrContractMonth: expiry,
      strike,
      right: right === 'C' ? OptionType.Call : OptionType.Put,
      multiplier: 100
    }

    // Set tradingClass when available — required for QQQ to distinguish weekly/monthly series
    if (tradingClass) {
      contract.tradingClass = tradingClass
    }

    const cleanup = (): void => {
      api.removeListener(EventName.contractDetails, onDetails)
      api.removeListener(EventName.contractDetailsEnd, onDetailsEnd)
      api.removeListener(EventName.error, onErr)
    }

    const onDetails = (id: number, details: ContractDetails): void => {
      if (id !== reqId) return
      if (settled) return
      settled = true
      clearTimeout(timeout)
      cleanup()
      const conId = details.contract?.conId
      if (!conId) {
        reject(new Error(`No conId in contract details for ${symbol} ${expiry} ${strike}${right}`))
      } else {
        console.log(`[IB] Resolved conId=${conId} for ${symbol} ${expiry} ${strike}${right}`)
        resolve(conId)
      }
    }

    const onDetailsEnd = (id: number): void => {
      if (id !== reqId) return
      // contractDetailsEnd fired without a matching contractDetails → no contract found
      if (!settled) {
        settled = true
        clearTimeout(timeout)
        cleanup()
        reject(new Error(`No contract found for ${symbol} ${expiry} ${strike}${right}`))
      }
    }

    const onErr = (err: Error, _code: number, id: number): void => {
      if (id !== reqId) return
      if (settled) return
      settled = true
      clearTimeout(timeout)
      cleanup()
      reject(
        new Error(
          `Failed to resolve conId for ${symbol} ${expiry} ${strike}${right}: ${err.message}`
        )
      )
    }

    api.on(EventName.contractDetails, onDetails)
    api.on(EventName.contractDetailsEnd, onDetailsEnd)
    api.on(EventName.error, onErr)
    api.reqContractDetails(reqId, contract)
  })
}

/**
 * Place a combo (BAG) roll order: close one option leg + open another as a single order.
 * One order is placed per account.
 */
export async function placeRollOrder(
  request: RollOrderRequest,
  accountQuantities: Record<string, number>
): Promise<OrderStatusUpdate[]> {
  const api = getIBApi()
  if (!api) throw new Error('Not connected to IB')

  // 1. Resolve conIds for both legs in parallel
  console.log(
    `[IB] Resolving conIds for roll: close=${request.symbol} ${request.closeExpiry} ${request.closeStrike}${request.closeRight}, open=${request.openExpiry} ${request.openStrike}${request.openRight}`
  )
  const [closeConId, openConId] = await Promise.all([
    resolveOptionConId(
      request.symbol,
      request.closeExpiry,
      request.closeStrike,
      request.closeRight
    ),
    resolveOptionConId(request.symbol, request.openExpiry, request.openStrike, request.openRight)
  ])

  // 2. Build combo (BAG) contract
  const closeAction = request.action === 'BUY' ? OrderAction.BUY : OrderAction.SELL
  const openAction = request.action === 'BUY' ? OrderAction.SELL : OrderAction.BUY

  const comboLegs: ComboLeg[] = [
    {
      conId: closeConId,
      ratio: 1,
      action: closeAction,
      exchange: 'SMART'
    },
    {
      conId: openConId,
      ratio: 1,
      action: openAction,
      exchange: 'SMART'
    }
  ]

  const comboContract: Contract = {
    symbol: request.symbol,
    secType: SecType.BAG,
    exchange: 'SMART',
    currency: 'USD',
    comboLegs
  }

  // 3. Place one order per account
  const results: OrderStatusUpdate[] = []

  for (const [accountId, quantity] of Object.entries(accountQuantities)) {
    if (quantity <= 0) continue

    const orderId = getNextOrderId()

    // Build readable combo description for UI display
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
    const fmtExp = (e: string): string => {
      const m = months[parseInt(e.substring(4, 6)) - 1]
      const d = e.substring(6, 8)
      return `${m}${d}`
    }
    const closePrefix = closeAction === 'BUY' ? '+' : '-'
    const openPrefix = openAction === 'BUY' ? '+' : '-'
    const comboDesc = `${closePrefix}${fmtExp(request.closeExpiry)} ${request.closeStrike}${request.closeRight} → ${openPrefix}${fmtExp(request.openExpiry)} ${request.openStrike}${request.openRight}`
    comboDescriptionMap.set(orderId, comboDesc)

    const order: Order = {
      action: OrderAction.BUY,
      orderType: OrderType.LMT,
      totalQuantity: quantity,
      lmtPrice: request.limitPrice,
      account: accountId,
      outsideRth: request.outsideRth ?? false,
      transmit: true
    }

    results.push({
      orderId,
      account: accountId,
      status: 'PendingSubmit',
      filled: 0,
      remaining: quantity,
      avgFillPrice: 0,
      symbol: `${request.symbol} ROLL ${request.closeExpiry}→${request.openExpiry}`
    })

    api.placeOrder(orderId, comboContract, order)
    console.log(
      `[IB] Placed combo roll order #${orderId} for ${accountId}: ${quantity}x ${request.symbol} close ${request.closeExpiry}/${request.closeStrike}${request.closeRight} → open ${request.openExpiry}/${request.openStrike}${request.openRight} @ ${request.limitPrice}`
    )
  }

  return results
}

// Listen for order status updates
export function setupOrderStatusListener(callback: (update: OrderStatusUpdate) => void): void {
  const api = getIBApi()
  if (!api) return

  api.on(
    EventName.orderStatus,
    (orderId: number, status: string, filled: number, remaining: number, avgFillPrice: number) => {
      callback({
        orderId,
        account: '', // Will be filled by openOrder event
        status,
        filled,
        remaining,
        avgFillPrice,
        symbol: ''
      })
    }
  )
}

// Modify an existing open order (quantity and/or price)
export interface ModifyOrderRequest {
  orderId: number
  account: string
  symbol: string
  secType: string
  action: string
  orderType: string
  quantity: number
  limitPrice: number
  expiry?: string
  strike?: number
  right?: string
}

export function modifyOrder(req: ModifyOrderRequest): void {
  const api = getIBApi()
  if (!api) throw new Error('Not connected to IB')

  const contract: Contract = {
    symbol: req.symbol,
    secType: req.secType === 'OPT' ? SecType.OPT : SecType.STK,
    exchange: 'SMART',
    currency: 'USD'
  }

  if (req.secType === 'OPT') {
    contract.lastTradeDateOrContractMonth = req.expiry
    contract.strike = req.strike
    contract.right = req.right === 'C' || req.right === 'CALL' ? OptionType.Call : OptionType.Put
    contract.multiplier = 100
  }

  const order: Order = {
    action: req.action === 'BUY' ? OrderAction.BUY : OrderAction.SELL,
    orderType: req.orderType === 'MKT' ? OrderType.MKT : OrderType.LMT,
    totalQuantity: req.quantity,
    account: req.account,
    transmit: true
  }

  if (req.orderType === 'LMT') {
    order.lmtPrice = req.limitPrice
  }

  api.placeOrder(req.orderId, contract, order)
  console.log(
    `[IB] Modified order #${req.orderId}: ${req.action} ${req.quantity} ${req.symbol} @ ${req.limitPrice}`
  )
}

export function cancelOrder(orderId: number): void {
  const api = getIBApi()
  if (!api) throw new Error('Not connected to IB')
  api.cancelOrder(orderId)
  console.log(`[IB] Cancelled order #${orderId}`)
}

// Setup next valid ID listener
export function setupNextOrderIdListener(): void {
  const api = getIBApi()
  if (!api) return

  api.on(EventName.nextValidId, (id: number) => {
    console.log(`[IB] Next valid order ID: ${id}`)
    setNextOrderId(id)
  })
}

// Open order data
export interface OpenOrder {
  orderId: number
  account: string
  symbol: string
  secType: string
  action: string
  quantity: number
  orderType: string
  limitPrice: number
  status: string
  expiry?: string
  strike?: number
  right?: string
  comboDescription?: string
}

// Fetch all open orders across all FA sub-accounts
export async function requestOpenOrders(): Promise<OpenOrder[]> {
  const api = getIBApi()
  if (!api) throw new Error('Not connected to IB')

  // Phase 1: Collect all open orders
  const orders: OpenOrder[] = []
  // Track combo legs for BAG orders that need resolution
  const bagOrderLegs = new Map<number, ComboLeg[]>()

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      cleanup()
      console.log(`[IB] Open orders timeout, returning ${orders.length} orders`)
      resolve()
    }, 10000)

    const onOpenOrder = (
      orderId: number,
      contract: Contract,
      order: Order,
      orderState: any
    ): void => {
      const status = orderState?.status || 'Unknown'
      // Skip fully filled or cancelled orders
      if (status === 'Filled' || status === 'Cancelled' || status === 'Inactive') return

      // For BAG orders, save combo legs for later resolution
      if (contract.secType === 'BAG' && !comboDescriptionMap.has(orderId)) {
        const legs = (contract as any).comboLegs as ComboLeg[] | undefined
        if (legs && legs.length > 0) {
          bagOrderLegs.set(orderId, legs)
        }
      }

      const orderEntry: OpenOrder = {
        orderId,
        account: order.account || '',
        symbol: contract.symbol || '',
        secType: contract.secType || '',
        action: order.action || '',
        quantity:
          typeof order.totalQuantity === 'number'
            ? order.totalQuantity
            : Number(order.totalQuantity) || 0,
        orderType: order.orderType || '',
        limitPrice: order.lmtPrice || 0,
        status,
        expiry: contract.lastTradeDateOrContractMonth || undefined,
        strike: contract.strike || undefined,
        right: contract.right || undefined,
        comboDescription:
          contract.secType === 'BAG' ? comboDescriptionMap.get(orderId) || undefined : undefined
      }

      // Deduplicate: IB may fire onOpenOrder multiple times for the same orderId
      const existingIdx = orders.findIndex((o) => o.orderId === orderId)
      if (existingIdx >= 0) {
        orders[existingIdx] = orderEntry
      } else {
        orders.push(orderEntry)
      }
      console.log(
        `[IB] Open order received: orderId=${orderId} symbol=${contract.symbol} qty=${order.totalQuantity} price=${order.lmtPrice}`
      )
    }

    const onOpenOrderEnd = (): void => {
      clearTimeout(timeout)
      cleanup()
      console.log(`[IB] Open orders received: ${orders.length}`)
      resolve()
    }

    function cleanup(): void {
      api!.off(EventName.openOrder, onOpenOrder)
      api!.off(EventName.openOrderEnd, onOpenOrderEnd)
    }

    api.on(EventName.openOrder, onOpenOrder)
    api.on(EventName.openOrderEnd, onOpenOrderEnd)
    api.reqOpenOrders()
    console.log('[IB] Requesting all open orders')
  })

  // Phase 2: Resolve combo leg conIds for BAG orders without cached descriptions
  if (bagOrderLegs.size > 0) {
    // Collect all unique conIds that need resolution
    const allConIds = new Set<number>()
    for (const legs of bagOrderLegs.values()) {
      for (const leg of legs) {
        if (leg.conId) allConIds.add(leg.conId)
      }
    }

    // Resolve each conId to contract details
    const conIdDetails = new Map<number, { expiry: string; strike: number; right: string }>()
    console.log(`[IB] Resolving ${allConIds.size} conIds for BAG order legs...`)

    for (const conId of allConIds) {
      try {
        const reqId = getNextRollReqId()
        const details = await new Promise<{ expiry: string; strike: number; right: string } | null>(
          (res) => {
            const t = setTimeout(() => {
              api.removeListener(EventName.contractDetails, onDetails)
              api.removeListener(EventName.error, onErr)
              res(null)
            }, 5000)

            const onDetails = (id: number, d: any): void => {
              if (id !== reqId) return
              clearTimeout(t)
              api.removeListener(EventName.contractDetails, onDetails)
              api.removeListener(EventName.error, onErr)
              const c = d?.contract || d?.summary
              if (c) {
                res({
                  expiry: c.lastTradeDateOrContractMonth || '',
                  strike: c.strike || 0,
                  right: c.right || ''
                })
              } else {
                res(null)
              }
            }

            const onErr = (_err: Error, _code: number, id: number): void => {
              if (id !== reqId) return
              clearTimeout(t)
              api.removeListener(EventName.contractDetails, onDetails)
              api.removeListener(EventName.error, onErr)
              res(null)
            }

            api.on(EventName.contractDetails, onDetails)
            api.on(EventName.error, onErr)
            api.reqContractDetails(reqId, { conId })
          }
        )
        if (details) conIdDetails.set(conId, details)
      } catch {
        // ignore resolution errors
      }
    }

    // Build descriptions for each BAG order
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
    const fmtExp = (e: string): string => {
      const m = months[parseInt(e.substring(4, 6)) - 1]
      const d = e.substring(6, 8)
      return `${m}${d}`
    }
    for (const [orderId, legs] of bagOrderLegs.entries()) {
      const legDescs = legs.map((leg) => {
        const d = leg.conId ? conIdDetails.get(leg.conId) : undefined
        if (!d) return '?'
        const r = d.right === 'C' || d.right === 'CALL' ? 'C' : 'P'
        const prefix = leg.action === 'BUY' ? '+' : '-'
        return `${prefix}${fmtExp(d.expiry)} ${d.strike}${r}`
      })
      const desc = legDescs.join(' → ')
      comboDescriptionMap.set(orderId, desc)

      // Update the order object
      const order = orders.find((o) => o.orderId === orderId)
      if (order) order.comboDescription = desc
    }
  }

  return orders
}

// Execution (filled) data
export interface ExecutionData {
  execId: string
  orderId: number
  account: string
  symbol: string
  secType: string
  side: string
  quantity: number
  price: number
  avgPrice: number
  time: string
  expiry?: string
  strike?: number
  right?: string
  comboDescription?: string
}

// Fetch today's executions across all FA sub-accounts
let execReqId = 90000
export async function requestExecutions(): Promise<ExecutionData[]> {
  const api = getIBApi()
  if (!api) throw new Error('Not connected to IB')

  const reqId = execReqId++

  return new Promise((resolve) => {
    const executions: ExecutionData[] = []

    const timeout = setTimeout(() => {
      cleanup()
      console.log(`[IB] Executions timeout, returning ${executions.length} executions`)
      resolve(executions)
    }, 10000)

    const onExecDetails = (_reqId: number, contract: Contract, execution: Execution): void => {
      if (_reqId !== reqId) return

      executions.push({
        execId: execution.execId || '',
        orderId: execution.orderId || 0,
        account: execution.acctNumber || '',
        symbol: contract.symbol || '',
        secType: contract.secType || '',
        side: execution.side || '',
        quantity: execution.shares || 0,
        price: execution.price || 0,
        avgPrice: execution.avgPrice || 0,
        time: execution.time || '',
        expiry: contract.lastTradeDateOrContractMonth || undefined,
        strike: contract.strike || undefined,
        right: contract.right || undefined,
        comboDescription:
          contract.secType === 'BAG' && (contract as any).comboLegsDescription
            ? (contract as any).comboLegsDescription
            : undefined
      })
    }

    const onExecDetailsEnd = (_reqId: number): void => {
      if (_reqId !== reqId) return
      clearTimeout(timeout)
      cleanup()
      console.log(`[IB] Executions received: ${executions.length}`)
      resolve(executions)
    }

    function cleanup(): void {
      api!.off(EventName.execDetails, onExecDetails)
      api!.off(EventName.execDetailsEnd, onExecDetailsEnd)
    }

    api.on(EventName.execDetails, onExecDetails)
    api.on(EventName.execDetailsEnd, onExecDetailsEnd)

    // Use US Eastern time for today's date
    const etNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }))
    const todayStr = `${etNow.getFullYear()}${String(etNow.getMonth() + 1).padStart(2, '0')}${String(etNow.getDate()).padStart(2, '0')}-00:00:00`
    const filter: ExecutionFilter = { time: todayStr }
    api.reqExecutions(reqId, filter)
    console.log(`[IB] Requesting executions since ${todayStr}`)
  })
}
