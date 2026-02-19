import { Contract, Order, OrderAction, OrderType, SecType, EventName, OptionType, Execution, ExecutionFilter, TimeInForce } from '@stoqey/ib'
import { getIBApi } from './connection'

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
}

// Fetch all open orders across all FA sub-accounts
export async function requestOpenOrders(): Promise<OpenOrder[]> {
  const api = getIBApi()
  if (!api) throw new Error('Not connected to IB')

  return new Promise((resolve) => {
    const orders: OpenOrder[] = []

    const timeout = setTimeout(() => {
      cleanup()
      console.log(`[IB] Open orders timeout, returning ${orders.length} orders`)
      resolve(orders)
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

      orders.push({
        orderId,
        account: order.account || '',
        symbol: contract.symbol || '',
        secType: contract.secType || '',
        action: order.action || '',
        quantity: typeof order.totalQuantity === 'number' ? order.totalQuantity : Number(order.totalQuantity) || 0,
        orderType: order.orderType || '',
        limitPrice: order.lmtPrice || 0,
        status,
        expiry: contract.lastTradeDateOrContractMonth || undefined,
        strike: contract.strike || undefined,
        right: contract.right || undefined
      })
      console.log(`[IB] Open order received: orderId=${orderId} symbol=${contract.symbol} qty=${order.totalQuantity} price=${order.lmtPrice}`)
    }

    const onOpenOrderEnd = (): void => {
      clearTimeout(timeout)
      cleanup()
      console.log(`[IB] Open orders received: ${orders.length}`)
      resolve(orders)
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

    const onExecDetails = (
      _reqId: number,
      contract: Contract,
      execution: Execution
    ): void => {
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
        right: contract.right || undefined
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

    const now = new Date()
    const todayStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-00:00:00`
    const filter: ExecutionFilter = { time: todayStr }
    api.reqExecutions(reqId, filter)
    console.log(`[IB] Requesting executions since ${todayStr}`)
  })
}
