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

interface IBApi {
  connect: (host: string, port: number) => Promise<void>
  disconnect: () => Promise<void>
  getConnectionState: () => Promise<{
    status: 'disconnected' | 'connecting' | 'connected' | 'error'
    host: string
    port: number
    errorMessage?: string
  }>
  onConnectionStatus: (callback: (state: any) => void) => void
  getManagedAccounts: () => Promise<string[]>
  getAccountSummary: () => Promise<
    Array<{
      accountId: string
      netLiquidation: number
      availableFunds: number
      totalCashValue: number
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
  onOrderStatus: (callback: (update: any) => void) => void

  // Options
  getOptionChain: (symbol: string) => Promise<OptionChainParams[]>
  getOptionGreeks: (
    symbol: string,
    expiry: string,
    strikes: number[],
    exchange?: string
  ) => Promise<OptionGreek[]>
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

  removeAllListeners: () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    ibApi: IBApi
  }
}
