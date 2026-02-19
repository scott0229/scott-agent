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
  getQuotes: (symbols: string[]): Promise<Record<string, number>> =>
    ipcRenderer.invoke('ib:getQuotes', symbols),
  getOptionQuotes: (contracts: Array<{ symbol: string; expiry: string; strike: number; right: string }>): Promise<Record<string, number>> =>
    ipcRenderer.invoke('ib:getOptionQuotes', contracts),

  // Options
  getOptionChain: (symbol: string): Promise<any[]> =>
    ipcRenderer.invoke('ib:getOptionChain', symbol),
  getOptionGreeks: (
    symbol: string,
    expiry: string,
    strikes: number[],
    exchange?: string
  ): Promise<any[]> => ipcRenderer.invoke('ib:getOptionGreeks', symbol, expiry, strikes, exchange),
  placeOptionBatchOrders: (
    request: any,
    accountQuantities: Record<string, number>
  ): Promise<any[]> => ipcRenderer.invoke('ib:placeOptionBatchOrders', request, accountQuantities),
  placeRollOrder: (
    request: any,
    accountQuantities: Record<string, number>
  ): Promise<any[]> => ipcRenderer.invoke('ib:placeRollOrder', request, accountQuantities),
  getOpenOrders: (): Promise<any[]> => ipcRenderer.invoke('ib:getOpenOrders'),
  getExecutions: (): Promise<any[]> => ipcRenderer.invoke('ib:getExecutions'),
  modifyOrder: (req: any): Promise<void> => ipcRenderer.invoke('ib:modifyOrder', req),
  cancelOrder: (orderId: number): Promise<void> => ipcRenderer.invoke('ib:cancelOrder', orderId),

  // Cleanup
  removeAllListeners: (): void => {
    ipcRenderer.removeAllListeners('ib:connectionStatus')
    ipcRenderer.removeAllListeners('ib:orderStatus')
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
