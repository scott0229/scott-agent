import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { connect, disconnect, getConnectionState, onConnectionStatusChange } from './ib/connection'
import {
  requestManagedAccounts,
  requestAccountSummary,
  requestPositions,
  requestAccountAliasesForIds
} from './ib/accounts'
import {
  placeBatchOrders,
  placeOptionBatchOrders,
  placeRollOrder,
  modifyOrder,
  cancelOrder,
  requestExecutions,
  requestOpenOrders,
  setupNextOrderIdListener,
  setupOrderStatusListener
} from './ib/orders'
import { requestOptionChain, requestOptionGreeks, getCachedGreeks } from './ib/options'
import { getStockQuote, getQuotes, getOptionQuotes } from './ib/quotes'
import { getHistoricalData } from './ib/historical'
import { getCachedAliases, setCachedAliases } from './aliasCache'
import { getFedFundsRate } from './rates'
import { getAiAdvice } from './ai/advisor'
import { startOptionPreloader, stopOptionPreloader, preloadSymbolExpiry, getCachedStockPrice } from './ib/optionPreloader'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f5f0eb',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      webviewTag: true
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
    connect({ host, port, clientId: 0 })
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

  ipcMain.handle('ib:getAccountAliases', async (_event, accountIds: string[], port: number) => {
    const aliases = await requestAccountAliasesForIds(accountIds)
    setCachedAliases(aliases, port)
    return aliases
  })

  ipcMain.handle('ib:getCachedAliases', async (_event, port: number) => {
    return getCachedAliases(port)
  })

  // Orders
  ipcMain.handle(
    'ib:placeBatchOrders',
    async (_event, request, accountQuantities: Record<string, number>) => {
      return placeBatchOrders(request, accountQuantities)
    }
  )

  // Quotes
  ipcMain.handle('ib:getStockQuote', async (_event, symbol: string) => {
    return getStockQuote(symbol)
  })

  ipcMain.handle('ib:getQuotes', async (_event, symbols: string[]) => {
    return getQuotes(symbols)
  })

  ipcMain.handle(
    'ib:getOptionQuotes',
    async (
      _event,
      contracts: Array<{ symbol: string; expiry: string; strike: number; right: string }>
    ) => {
      return getOptionQuotes(contracts)
    }
  )

  ipcMain.handle('ib:getHistoricalData', async (_event, req) => {
    return getHistoricalData(req)
  })

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

  // On-demand preload: trigger the preloader to fetch+cache a specific symbol/expiry/strikes from IB
  ipcMain.handle(
    'ib:requestPreload',
    async (_event, symbol: string, expiry: string, strikes: number[]) => {
      await preloadSymbolExpiry(symbol, expiry, strikes)
    }
  )

  // Read-only cache access: return cached greeks without touching IB
  ipcMain.handle(
    'ib:getCachedGreeks',
    (_event, symbol: string, expiry: string) => {
      return getCachedGreeks(symbol, expiry)
    }
   )

  // Read-only cache access: return cached stock price from preloader
  ipcMain.handle('ib:getCachedStockPrice', (_event, symbol: string) => {
    return getCachedStockPrice(symbol)
  })

  ipcMain.handle(
    'ib:placeOptionBatchOrders',
    async (_event, request, accountQuantities: Record<string, number>) => {
      return placeOptionBatchOrders(request, accountQuantities)
    }
  )

  ipcMain.handle(
    'ib:placeRollOrder',
    async (_event, request, accountQuantities: Record<string, number>) => {
      return placeRollOrder(request, accountQuantities)
    }
  )

  ipcMain.handle('ib:getOpenOrders', async () => {
    return requestOpenOrders()
  })

  ipcMain.handle('ib:getExecutions', async () => {
    return requestExecutions()
  })

  ipcMain.handle('ib:modifyOrder', async (_event, req) => {
    return modifyOrder(req)
  })

  ipcMain.handle('ib:cancelOrder', async (_event, orderId: number) => {
    return cancelOrder(orderId)
  })

  // Rates
  ipcMain.handle('rates:getFedFundsRate', async () => {
    return getFedFundsRate()
  })

  // AI Advisor
  ipcMain.handle('ai:getAdvice', async (_event, request) => {
    return getAiAdvice(request)
  })

  // Settings (proxy through main process to bypass CORS)
  const SETTINGS_URL = 'https://scott-agent.com/api/trader-settings'
  const SETTINGS_API_KEY = 'R1TIoxXSri38FVn63eolduORz-NXUNyqoptyIx07'

  ipcMain.handle('settings:get', async () => {
    try {
      const res = await fetch(SETTINGS_URL)
      return await res.json()
    } catch {
      return { settings: null }
    }
  })

  ipcMain.handle('settings:put', async (_event, key: string, value: unknown) => {
    try {
      const res = await fetch(SETTINGS_URL, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${SETTINGS_API_KEY}`
        },
        body: JSON.stringify({ key, value })
      })
      return await res.json()
    } catch {
      return { success: false }
    }
  })

  // Upload 1-year daily closing prices for ONE symbol to D1 (both staging & production)
  const UPLOAD_TARGETS = [
    {
      label: 'staging',
      apiKey: 'MZ12MUOIJXFNK7LZ',
      bulk: 'https://staging.scott-agent.com/api/market-data/bulk',
      clearCache: 'https://staging.scott-agent.com/api/market-data/clear-cache'
    },
    {
      label: 'production',
      apiKey: SETTINGS_API_KEY,
      bulk: 'https://scott-agent.com/api/market-data/bulk',
      clearCache: 'https://scott-agent.com/api/market-data/clear-cache'
    }
  ]

  ipcMain.handle('prices:uploadSymbol', async (_event, symbol: string) => {
    try {
      const bars = await getHistoricalData({
        symbol,
        durationString: '1 Y',
        barSizeSetting: '1 day',
        useRTH: 1,
        whatToShow: 'TRADES'
      })

      const rows: { symbol: string; date: number; price: number }[] = bars.map((bar) => {
        const t = String(bar.time)
        const n = Number(t)
        let dateSec: number
        if (!isNaN(n) && t.length > 5) {
          dateSec = n
        } else if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
          dateSec = Math.floor(new Date(t + 'T00:00:00Z').getTime() / 1000)
        } else {
          dateSec = Math.floor(new Date(t).getTime() / 1000)
        }
        return { symbol, date: dateSec, price: bar.close }
      })

      if (rows.length === 0) return { success: false, error: '無歷史資料' }

      const body = JSON.stringify({ rows })

      // Upload to both staging & production in parallel
      const results = await Promise.allSettled(
        UPLOAD_TARGETS.map(async (t) => {
          const hdrs = { 'Content-Type': 'application/json', Authorization: `Bearer ${t.apiKey}` }
          const res = await fetch(t.bulk, { method: 'POST', headers: hdrs, body })
          if (!res.ok) throw new Error(`${t.label}: ${await res.text().catch(() => res.statusText)}`)
          return t.label
        })
      )

      const failures = results.filter((r) => r.status === 'rejected')
      if (failures.length === UPLOAD_TARGETS.length) {
        const msgs = failures.map((r) => (r as PromiseRejectedResult).reason?.message).join('; ')
        return { success: false, error: `Upload failed: ${msgs}` }
      }
      if (failures.length > 0) {
        failures.forEach((r) => console.warn('[upload] partial fail:', (r as PromiseRejectedResult).reason?.message))
      }

      // Clear cache on both environments
      for (const t of UPLOAD_TARGETS) {
        const hdrs = { 'Content-Type': 'application/json', Authorization: `Bearer ${t.apiKey}` }
        fetch(t.clearCache, { method: 'POST', headers: hdrs, body: JSON.stringify({ symbols: [symbol] }) })
          .catch((e) => console.warn(`[clear-cache][${t.label}] notify failed:`, e))
      }

      return { success: true, count: rows.length }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: msg }
    }
  })
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
      // Start background option chain preloading after connection stabilises
      setTimeout(() => startOptionPreloader(), 3000)
    } else {
      stopOptionPreloader()
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
