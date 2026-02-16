import { Contract, Order, OrderAction, OrderType, SecType, EventName, OptionType } from '@stoqey/ib'
import { getIBApi } from './connection'

export interface BatchOrderRequest {
  symbol: string
  action: 'BUY' | 'SELL'
  orderType: 'MKT' | 'LMT'
  limitPrice?: number
  totalQuantity: number
  allocation: AllocationConfig
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
      `[IB] Placed order #${orderId} for ${accountId}: ${request.action} ${quantity} ${request.symbol}`
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

// Setup next valid ID listener
export function setupNextOrderIdListener(): void {
  const api = getIBApi()
  if (!api) return

  api.on(EventName.nextValidId, (id: number) => {
    console.log(`[IB] Next valid order ID: ${id}`)
    setNextOrderId(id)
  })
}
