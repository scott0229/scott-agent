import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// IB API exposed to renderer via IPC
const ibApi = {
  // Connection
  connect: (host: string, port: number): Promise<void> =>
    ipcRenderer.invoke('ib:connect', host, port),
  disconnect: (): Promise<void> => ipcRenderer.invoke('ib:disconnect'),
  getConnectionState: (): Promise<any> => ipcRenderer.invoke('ib:getConnectionState'),
  onConnectionStatus: (callback: (state: any) => void): (() => void) => {
    const handler = (_event: any, state: any): void => callback(state)
    ipcRenderer.on('ib:connectionStatus', handler)
    return () => {
      ipcRenderer.removeListener('ib:connectionStatus', handler)
    }
  },

  // Accounts
  getManagedAccounts: (): Promise<string[]> => ipcRenderer.invoke('ib:getManagedAccounts'),
  getAccountSummary: (): Promise<any[]> => ipcRenderer.invoke('ib:getAccountSummary'),
  getPositions: (): Promise<any[]> => ipcRenderer.invoke('ib:getPositions'),
  getAccountAliases: (accountIds: string[], port: number): Promise<Record<string, string>> =>
    ipcRenderer.invoke('ib:getAccountAliases', accountIds, port),
  getCachedAliases: (port: number): Promise<Record<string, string>> =>
    ipcRenderer.invoke('ib:getCachedAliases', port),

  // Orders
  placeBatchOrders: (request: any, accountQuantities: Record<string, number>): Promise<any[]> =>
    ipcRenderer.invoke('ib:placeBatchOrders', request, accountQuantities),
  onOrderStatus: (callback: (update: any) => void): (() => void) => {
    const handler = (_event: any, update: any): void => callback(update)
    ipcRenderer.on('ib:orderStatus', handler)
    return () => {
      ipcRenderer.removeListener('ib:orderStatus', handler)
    }
  },

  // Quotes
  getStockQuote: (symbol: string): Promise<{ bid: number; ask: number; last: number }> =>
    ipcRenderer.invoke('ib:getStockQuote', symbol),
  getCachedStockPrice: (symbol: string): Promise<number | null> =>
    ipcRenderer.invoke('ib:getCachedStockPrice', symbol),
  getQuotes: (symbols: string[]): Promise<Record<string, number>> =>
    ipcRenderer.invoke('ib:getQuotes', symbols),
  getOptionQuotes: (
    contracts: Array<{ symbol: string; expiry: string; strike: number; right: string }>
  ): Promise<Record<string, number>> => ipcRenderer.invoke('ib:getOptionQuotes', contracts),
  getHistoricalData: (req: any): Promise<any[]> => ipcRenderer.invoke('ib:getHistoricalData', req),

  // Streaming quotes
  subscribeQuotes: (
    symbols: string[],
    optionContracts: Array<{ symbol: string; expiry: string; strike: number; right: string }>
  ): Promise<{ quotes: Record<string, number>; optionQuotes: Record<string, number> }> =>
    ipcRenderer.invoke('ib:subscribeQuotes', symbols, optionContracts),
  unsubscribeQuotes: (): Promise<void> => ipcRenderer.invoke('ib:unsubscribeQuotes'),
  onQuoteUpdate: (
    callback: (data: { quotes: Record<string, number>; optionQuotes: Record<string, number> }) => void
  ): (() => void) => {
    const handler = (_event: any, data: any): void => callback(data)
    ipcRenderer.on('ib:quoteUpdate', handler)
    return () => {
      ipcRenderer.removeListener('ib:quoteUpdate', handler)
    }
  },

  // Options
  getOptionChain: (symbol: string): Promise<any[]> =>
    ipcRenderer.invoke('ib:getOptionChain', symbol),
  getOptionGreeks: (
    symbol: string,
    expiry: string,
    strikes: number[],
    exchange?: string
  ): Promise<any[]> => ipcRenderer.invoke('ib:getOptionGreeks', symbol, expiry, strikes, exchange),
  cancelOptionGreeksSubscriptions: (symbol: string): Promise<void> =>
    ipcRenderer.invoke('ib:cancelOptionGreeksSubscriptions', symbol),

  placeOptionBatchOrders: (
    request: any,
    accountQuantities: Record<string, number>
  ): Promise<any[]> => ipcRenderer.invoke('ib:placeOptionBatchOrders', request, accountQuantities),
  placeRollOrder: (request: any, accountQuantities: Record<string, number>): Promise<any[]> =>
    ipcRenderer.invoke('ib:placeRollOrder', request, accountQuantities),
  getOpenOrders: (): Promise<any[]> => ipcRenderer.invoke('ib:getOpenOrders'),
  getExecutions: (): Promise<any[]> => ipcRenderer.invoke('ib:getExecutions'),
  modifyOrder: (req: any): Promise<void> => ipcRenderer.invoke('ib:modifyOrder', req),
  cancelOrder: (orderId: number): Promise<void> => ipcRenderer.invoke('ib:cancelOrder', orderId),
  getFedFundsRate: (): Promise<number> => ipcRenderer.invoke('rates:getFedFundsRate'),

  // AI Advisor
  getAiAdvice: (request: any): Promise<any> => ipcRenderer.invoke('ai:getAdvice', request),

  // Settings
  getSettings: (d1Target?: string): Promise<any> => ipcRenderer.invoke('settings:get', d1Target),
  putSettings: (key: string, value: unknown, d1Target?: string): Promise<any> =>
    ipcRenderer.invoke('settings:put', key, value, d1Target),
  detectGroup: (accountIds: string[]): Promise<{ group: string; label: string; year?: number }> =>
    ipcRenderer.invoke('settings:detectGroup', accountIds),
  getAccountTypes: (
    accountIds: string[],
    d1Target?: string
  ): Promise<{ accountTypes: Record<string, string>; operationModes: Record<string, string> }> =>
    ipcRenderer.invoke('settings:getAccountTypes', accountIds, d1Target),
  getReturnRates: (
    accountIds: string[],
    d1Target?: string
  ): Promise<{ returnRates: Record<string, number | null> }> =>
    ipcRenderer.invoke('performance:getReturnRates', accountIds, d1Target),
  getInitialCosts: (
    accountIds: string[],
    d1Target?: string
  ): Promise<{ initialCosts: Record<string, number> }> =>
    ipcRenderer.invoke('trader:getInitialCosts', accountIds, d1Target),

  // Price Upload (per-symbol)
  uploadSymbol: (
    symbol: string,
    target?: 'staging' | 'production'
  ): Promise<{ success: boolean; count?: number; error?: string }> =>
    ipcRenderer.invoke('prices:uploadSymbol', symbol, target),

  // Get symbols the web app needs stock prices for
  getNeededSymbols: (
    target?: 'staging' | 'production'
  ): Promise<string[]> =>
    ipcRenderer.invoke('prices:getNeededSymbols', target),

  // Get list of underlying symbols with missing underlying_price
  getMissingPriceSymbols: (
    target?: 'staging' | 'production'
  ): Promise<string[]> =>
    ipcRenderer.invoke('prices:getMissingPriceSymbols', target),

  // Backfill underlying_price for one symbol (1-sec precision)
  backfillUnderlyingPrice: (
    symbol: string,
    target?: 'staging' | 'production'
  ): Promise<{ success: boolean; found: number; updated: number; error?: string }> =>
    ipcRenderer.invoke('prices:backfillUnderlyingPrice', symbol, target),

  // Cleanup
  log: (...args: any[]) => ipcRenderer.send('renderer-log', ...args),

  removeAllListeners: (): void => {
    ipcRenderer.removeAllListeners('ib:connectionStatus')
    ipcRenderer.removeAllListeners('ib:orderStatus')
    ipcRenderer.removeAllListeners('ib:quoteUpdate')
  }
}

// Use `contextBridge` APIs to expose Electron APIs to renderer
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('ibApi', ibApi)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.ibApi = ibApi
}
