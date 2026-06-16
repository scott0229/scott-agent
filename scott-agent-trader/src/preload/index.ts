import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Shape returned by /api/trader-account-groups — server-side aggregation
// of the website's 交易群組 view for one account.
export interface AccountGroupRow {
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
export interface AccountGroupsResponse {
  user?: { id: number; alias: string; name: string | null }
  year?: number
  groups: AccountGroupRow[]
  error?: string
}

export interface GroupDetailRow {
  id: number
  type: 'CALL' | 'PUT' | 'STK'
  operation: 'Open' | 'Closed' | 'Assigned' | 'Expired' | 'Transferred'
  open_date: number
  settlement_date: number | null
  quantity: number
  underlying: string
  strike_price?: number
  to_date?: number | null
  premium?: number | null
  final_profit?: number | null
  underlying_price?: number | null
  is_assigned?: boolean
  code?: string | null
  cumulative_holdings?: number
  cumulative_avg_price?: number | null
  roll_profit?: number | null
}
export interface GroupDetailResponse {
  groupName?: string
  groupStatus?: string
  rows: GroupDetailRow[]
  summary: {
    totalNetCashInflow: number
    totalOpenCostToClose: number
    totalPnL: number
  }
  error?: string
}

// IB API exposed to renderer via IPC
const ibApi = {
  // Connection
  connect: (host: string, port: number): Promise<void> =>
    ipcRenderer.invoke('ib:connect', host, port),
  disconnect: (): Promise<void> => ipcRenderer.invoke('ib:disconnect'),
  getConnectionState: (): Promise<any> => ipcRenderer.invoke('ib:getConnectionState'),
  launchGateway: (): Promise<{ launched: boolean; reason: string; exe?: string }> =>
    ipcRenderer.invoke('ib:launchGateway'),
  // IB Flex Web Service (historical trades). Plaintext token is encrypted in
  // main; only the ciphertext crosses back (stored in D1 by the renderer).
  flexEncrypt: (token: string): Promise<string> => ipcRenderer.invoke('flex:encrypt', token),
  flexFetchTrades: (tokenEnc: string, queryId: string): Promise<any[]> =>
    ipcRenderer.invoke('flex:fetchTrades', tokenEnc, queryId),
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
  onOpenOrderUpdate: (callback: (order: any) => void): (() => void) => {
    const handler = (_event: any, order: any): void => callback(order)
    ipcRenderer.on('ib:openOrderUpdate', handler)
    return () => {
      ipcRenderer.removeListener('ib:openOrderUpdate', handler)
    }
  },
  onExecutionUpdate: (callback: (exec: any) => void): (() => void) => {
    const handler = (_event: any, exec: any): void => callback(exec)
    ipcRenderer.on('ib:executionUpdate', handler)
    return () => {
      ipcRenderer.removeListener('ib:executionUpdate', handler)
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
    optionContracts: Array<{ symbol: string; expiry: string; strike: number; right: string }>,
    orders?: unknown[]
  ): Promise<{
    quotes: Record<string, number>
    optionQuotes: Record<string, number>
    orderQuotes: Record<string, { bid: number; ask: number }>
  }> => ipcRenderer.invoke('ib:subscribeQuotes', symbols, optionContracts, orders || []),
  unsubscribeQuotes: (): Promise<void> => ipcRenderer.invoke('ib:unsubscribeQuotes'),
  onQuoteUpdate: (
    callback: (data: {
      quotes: Record<string, number>
      optionQuotes: Record<string, number>
      orderQuotes: Record<string, { bid: number; ask: number }>
    }) => void
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
  cancelAllOrders: (): Promise<void> => ipcRenderer.invoke('ib:cancelAllOrders'),
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
  getOptionGroups: (
    accountIds: string[],
    d1Target?: string
  ): Promise<{ optionGroups: Record<string, string> }> =>
    ipcRenderer.invoke('settings:getOptionGroups', accountIds, d1Target),
  getReportNotes: (
    accountIds: string[],
    d1Target?: string
  ): Promise<{ reportNotes: Record<string, string> }> =>
    ipcRenderer.invoke('settings:getReportNotes', accountIds, d1Target),
  setReportNote: (
    account: string,
    reportNote: string | null,
    d1Target?: string
  ): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('settings:setReportNote', account, reportNote, d1Target),
  getGroupDetail: (
    account: string,
    group: string,
    d1Target?: string
  ): Promise<GroupDetailResponse> =>
    ipcRenderer.invoke('settings:getGroupDetail', account, group, d1Target),
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

  // Aggregated trade-groups for one account (mirrors /trade-groups on the web).
  // Returns the 11-column data the AccountOverview panel needs.
  getAccountGroups: (
    alias: string,
    year: number,
    d1Target?: string
  ): Promise<AccountGroupsResponse> =>
    ipcRenderer.invoke('trader:getAccountGroups', alias, year, d1Target),

  // Price Upload (per-symbol)
  uploadSymbol: (
    symbol: string,
    target?: 'staging' | 'production'
  ): Promise<{ success: boolean; count?: number; error?: string }> =>
    ipcRenderer.invoke('prices:uploadSymbol', symbol, target),

  // Get symbols the web app needs stock prices for
  getNeededSymbols: (target?: 'staging' | 'production'): Promise<string[]> =>
    ipcRenderer.invoke('prices:getNeededSymbols', target),

  // Get list of underlying symbols with missing underlying_price
  getMissingPriceSymbols: (target?: 'staging' | 'production'): Promise<string[]> =>
    ipcRenderer.invoke('prices:getMissingPriceSymbols', target),

  // Backfill underlying_price for one symbol (1-sec precision)
  backfillUnderlyingPrice: (
    symbol: string,
    target?: 'staging' | 'production'
  ): Promise<{ success: boolean; found: number; updated: number; error?: string }> =>
    ipcRenderer.invoke('prices:backfillUnderlyingPrice', symbol, target),

  // Asian market index by Yahoo symbol (^TWII, ^KS11, ...) — last close,
  // day change, change%. Cached 5min in main; renderer polls every 15min.
  getIndex: (
    symbol: string
  ): Promise<{
    close: number
    change: number
    changePercent: number
    ts: number
  } | null> => ipcRenderer.invoke('market:getIndex', symbol),

  // Auto-update — checked on startup + hourly. The renderer subscribes via
  // onUpdateAvailable; installUpdate downloads + extracts + launches NSIS.
  checkUpdate: (): Promise<{ version: string; downloadUrl: string; currentVersion: string } | null> =>
    ipcRenderer.invoke('trader:checkUpdate'),
  getCachedUpdate: (): Promise<{ version: string; downloadUrl: string; currentVersion: string } | null> =>
    ipcRenderer.invoke('trader:getCachedUpdate'),
  installUpdate: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('trader:installUpdate'),
  onUpdateAvailable: (
    callback: (info: { version: string; downloadUrl: string; currentVersion: string } | null) => void
  ): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, info: { version: string; downloadUrl: string; currentVersion: string } | null): void =>
      callback(info)
    ipcRenderer.on('trader:updateAvailable', handler)
    return () => {
      ipcRenderer.removeListener('trader:updateAvailable', handler)
    }
  },

  // Cleanup
  log: (...args: any[]) => ipcRenderer.send('renderer-log', ...args),

  removeAllListeners: (): void => {
    ipcRenderer.removeAllListeners('ib:connectionStatus')
    ipcRenderer.removeAllListeners('ib:orderStatus')
    ipcRenderer.removeAllListeners('ib:openOrderUpdate')
    ipcRenderer.removeAllListeners('ib:executionUpdate')
    ipcRenderer.removeAllListeners('ib:quoteUpdate')
    ipcRenderer.removeAllListeners('trader:updateAvailable')
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
