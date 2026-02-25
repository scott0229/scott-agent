import { ElectronAPI } from '@electron-toolkit/preload'

interface OptionChainParams {
  exchange: string
  underlyingConId: number
  tradingClass: string
  multiplier: string
  expirations: string[]
  strikes: number[]
}

interface OptionGreek {
  strike: number
  right: 'C' | 'P'
  expiry: string
  bid: number
  ask: number
  last: number
  delta: number
  gamma: number
  theta: number
  vega: number
  impliedVol: number
  openInterest: number
}

interface OpenOrder {
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

interface ExecutionData {
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

interface IBApi {
  connect: (host: string, port: number) => Promise<void>
  disconnect: () => Promise<void>
  getConnectionState: () => Promise<{
    status: 'disconnected' | 'connecting' | 'connected' | 'error'
    host: string
    port: number
    errorMessage?: string
  }>
  onConnectionStatus: (callback: (state: any) => void) => () => void
  getManagedAccounts: () => Promise<string[]>
  getAccountSummary: () => Promise<
    Array<{
      accountId: string
      alias: string
      accountType: string
      netLiquidation: number
      availableFunds: number
      totalCashValue: number
      grossPositionValue: number
      currency: string
    }>
  >
  getPositions: () => Promise<
    Array<{
      account: string
      symbol: string
      secType: string
      quantity: number
      avgCost: number
      expiry?: string
      strike?: number
      right?: string
    }>
  >
  getAccountAliases: (accountIds: string[], port: number) => Promise<Record<string, string>>
  getCachedAliases: (port: number) => Promise<Record<string, string>>
  getStockQuote: (symbol: string) => Promise<{ bid: number; ask: number; last: number }>
  getQuotes: (symbols: string[]) => Promise<Record<string, number>>
  getOptionQuotes: (
    contracts: Array<{ symbol: string; expiry: string; strike: number; right: string }>
  ) => Promise<Record<string, number>>
  getHistoricalData: (req: {
    symbol: string
    secType?: string
    endDateTime?: string
    durationString?: string
    barSizeSetting?: string
    whatToShow?: string
    useRTH?: number
  }) => Promise<
    Array<{
      time: string
      open: number
      high: number
      low: number
      close: number
      volume?: number
    }>
  >
  placeBatchOrders: (
    request: any,
    accountQuantities: Record<string, number>
  ) => Promise<
    Array<{
      orderId: number
      account: string
      status: string
      filled: number
      remaining: number
      avgFillPrice: number
      symbol: string
    }>
  >
  onOrderStatus: (callback: (update: any) => void) => () => void

  // Options
  getOptionChain: (symbol: string) => Promise<OptionChainParams[]>
  getOptionGreeks: (
    symbol: string,
    expiry: string,
    strikes: number[],
    exchange?: string
  ) => Promise<OptionGreek[]>
  requestPreload: (symbol: string, expiry: string, strikes: number[]) => Promise<void>
  getCachedGreeks: (symbol: string, expiry: string) => Promise<OptionGreek[]>
  placeOptionBatchOrders: (
    request: any,
    accountQuantities: Record<string, number>
  ) => Promise<
    Array<{
      orderId: number
      account: string
      status: string
      filled: number
      remaining: number
      avgFillPrice: number
      symbol: string
    }>
  >
  placeRollOrder: (
    request: any,
    accountQuantities: Record<string, number>
  ) => Promise<
    Array<{
      orderId: number
      account: string
      status: string
      filled: number
      remaining: number
      avgFillPrice: number
      symbol: string
    }>
  >
  getOpenOrders: () => Promise<OpenOrder[]>
  getExecutions: () => Promise<ExecutionData[]>
  modifyOrder: (req: {
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
  }) => Promise<void>
  cancelOrder: (orderId: number) => Promise<void>
  getFedFundsRate: () => Promise<number>

  // AI Advisor
  getAiAdvice: (request: {
    account: {
      accountId: string
      alias: string
      netLiquidation: number
      totalCashValue: number
      grossPositionValue: number
    }
    positions: Array<{
      symbol: string
      secType: string
      quantity: number
      avgCost: number
      expiry?: string
      strike?: number
      right?: string
    }>
    optionQuotes: Record<string, number>
    quotes: Record<string, number>
  }) => Promise<{
    recommendations: Array<{
      position: string
      action: 'roll' | 'hold' | 'close'
      targetExpiry?: string
      targetStrike?: number
      estimatedCredit?: string
      reason: string
    }>
    summary: string
    error?: string
  }>

  removeAllListeners: () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    ibApi: IBApi
  }
}
