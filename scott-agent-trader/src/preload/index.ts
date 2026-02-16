import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// IB API exposed to renderer via IPC
const ibApi = {
  // Connection
  connect: (host: string, port: number): Promise<void> =>
    ipcRenderer.invoke('ib:connect', host, port),
  disconnect: (): Promise<void> => ipcRenderer.invoke('ib:disconnect'),
  getConnectionState: (): Promise<any> => ipcRenderer.invoke('ib:getConnectionState'),
  onConnectionStatus: (callback: (state: any) => void): void => {
    ipcRenderer.on('ib:connectionStatus', (_event, state) => callback(state))
  },

  // Accounts
  getManagedAccounts: (): Promise<string[]> => ipcRenderer.invoke('ib:getManagedAccounts'),
  getAccountSummary: (): Promise<any[]> => ipcRenderer.invoke('ib:getAccountSummary'),
  getPositions: (): Promise<any[]> => ipcRenderer.invoke('ib:getPositions'),

  // Orders
  placeBatchOrders: (request: any, accountQuantities: Record<string, number>): Promise<any[]> =>
    ipcRenderer.invoke('ib:placeBatchOrders', request, accountQuantities),
  onOrderStatus: (callback: (update: any) => void): void => {
    ipcRenderer.on('ib:orderStatus', (_event, update) => callback(update))
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
  placeOptionBatchOrders: (
    request: any,
    accountQuantities: Record<string, number>
  ): Promise<any[]> => ipcRenderer.invoke('ib:placeOptionBatchOrders', request, accountQuantities),

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
