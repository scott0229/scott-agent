import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { connect, disconnect, getConnectionState, onConnectionStatusChange } from './ib/connection'
import { requestManagedAccounts, requestAccountSummary, requestPositions } from './ib/accounts'
import {
  placeBatchOrders,
  placeOptionBatchOrders,
  setupNextOrderIdListener,
  setupOrderStatusListener
} from './ib/orders'
import { requestOptionChain, requestOptionGreeks } from './ib/options'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow!.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// === IPC Handlers ===

function setupIpcHandlers(): void {
  // Connection
  ipcMain.handle('ib:connect', async (_event, host: string, port: number) => {
    connect({ host, port, clientId: 1 })
    // Wait a bit for connection to establish
    return new Promise((resolve) => setTimeout(resolve, 1000))
  })

  ipcMain.handle('ib:disconnect', async () => {
    disconnect()
  })

  ipcMain.handle('ib:getConnectionState', async () => {
    return getConnectionState()
  })

  // Forward connection status changes to renderer
  onConnectionStatusChange((state) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('ib:connectionStatus', state)
    }
  })

  // Accounts
  ipcMain.handle('ib:getManagedAccounts', async () => {
    return requestManagedAccounts()
  })

  ipcMain.handle('ib:getAccountSummary', async () => {
    return requestAccountSummary()
  })

  ipcMain.handle('ib:getPositions', async () => {
    return requestPositions()
  })

  // Orders
  ipcMain.handle(
    'ib:placeBatchOrders',
    async (_event, request, accountQuantities: Record<string, number>) => {
      return placeBatchOrders(request, accountQuantities)
    }
  )

  // Options
  ipcMain.handle('ib:getOptionChain', async (_event, symbol: string) => {
    return requestOptionChain(symbol)
  })

  ipcMain.handle(
    'ib:getOptionGreeks',
    async (_event, symbol: string, expiry: string, strikes: number[], exchange?: string) => {
      return requestOptionGreeks(symbol, expiry, strikes, exchange)
    }
  )

  ipcMain.handle(
    'ib:placeOptionBatchOrders',
    async (_event, request, accountQuantities: Record<string, number>) => {
      return placeOptionBatchOrders(request, accountQuantities)
    }
  )
}

// === App Lifecycle ===

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.scott-agent.trader')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  setupIpcHandlers()
  createWindow()

  // Setup IB event listeners when connected
  onConnectionStatusChange((state) => {
    if (state.status === 'connected') {
      setupNextOrderIdListener()
      setupOrderStatusListener((update) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('ib:orderStatus', update)
        }
      })
    }
  })

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  disconnect()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
