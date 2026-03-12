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
import { requestOptionChain, requestOptionGreeks, cancelOptionGreeksSubscriptions } from './ib/options'
import { getStockQuote, getQuotes, getOptionQuotes } from './ib/quotes'
import { getHistoricalData } from './ib/historical'
import { getCachedAliases, setCachedAliases } from './aliasCache'
import { getFedFundsRate } from './rates'
import { getAiAdvice } from './ai/advisor'

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

  ipcMain.on('renderer-log', (_event, ...args) => {
    console.log('[RENDERER]', ...args)
    const fs = require('fs')
    const path = require('path')
    try {
      fs.appendFileSync(
        path.join(process.cwd(), 'debugroll.log'),
        '[RENDERER] ' + args.join(' ') + '\n'
      )
    } catch (e) {}
  })

  // Options
  ipcMain.handle('ib:getOptionChain', async (_event, symbol: string) => {
    return requestOptionChain(symbol)
  })

  ipcMain.handle(
    'ib:getOptionGreeks',
    async (_event, symbol: string, expiry: string, strikes: number[], exchange?: string) => {
      const result = await requestOptionGreeks(symbol, expiry, strikes, exchange)
      const withData = result.filter(g => g.bid > 0 || g.ask > 0 || g.last > 0 || g.delta !== 0)
      console.log(`[IPC] getOptionGreeks → ${symbol} ${expiry}: ${result.length} items, ${withData.length} with data`)
      return result
    }
  )


  ipcMain.handle('ib:cancelOptionGreeksSubscriptions', async (_event, symbol: string) => {
    cancelOptionGreeksSubscriptions(symbol)
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
  const SETTINGS_TARGETS = [
    {
      label: 'staging',
      url: 'https://staging.scott-agent.com/api/trader-settings',
      apiKey: 'MZ12MUOIJXFNK7LZ'
    },
    {
      label: 'production',
      url: 'https://scott-agent.com/api/trader-settings',
      apiKey: 'R1TIoxXSri38FVn63eolduORz-NXUNyqoptyIx07'
    }
  ]

  // Track detected group so settings are per-group
  let detectedGroup: string = 'advisor'
  let resolveGroupReady: () => void
  const groupReady = new Promise<void>((r) => {
    resolveGroupReady = r
  })
  // Auto-resolve after 5s in case group detection never fires
  setTimeout(() => resolveGroupReady(), 5000)

  ipcMain.handle('settings:get', async (_event, d1Target?: string) => {
    try {
      await groupReady
      const targetLabel = d1Target || 'staging'
      const t = SETTINGS_TARGETS.find((t) => t.label === targetLabel) || SETTINGS_TARGETS[0]
      const url = `${t.url}?group=${encodeURIComponent(detectedGroup)}`
      console.log('[settings:get] url=', url, 'group=', detectedGroup, 'target=', t.label)
      const res = await fetch(url)
      const json = await res.json()
      console.log(
        '[settings:get] response margin_limit=',
        json?.settings?.margin_limit,
        'watch_symbols=',
        json?.settings?.watch_symbols
      )
      return json
    } catch {
      return { settings: null }
    }
  })

  ipcMain.handle('settings:put', async (_event, key: string, value: unknown, d1Target?: string) => {
    try {
      await groupReady
      const targetLabel = d1Target || 'staging'
      const t = SETTINGS_TARGETS.find((t) => t.label === targetLabel) || SETTINGS_TARGETS[0]
      console.log('[settings:put] key=', key, 'group=', detectedGroup, 'target=', t.label)
      const url = `${t.url}?group=${encodeURIComponent(detectedGroup)}`
      const res = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t.apiKey}` },
        body: JSON.stringify({ key, value })
      })
      const json = await res.json()
      console.log('[settings:put] response:', res.status, JSON.stringify(json))
      return json
    } catch {
      return { success: false }
    }
  })

  // Detect account group from IB account IDs
  const GROUP_URL = 'https://staging.scott-agent.com/api/trader-group'
  const GROUP_API_KEY = 'MZ12MUOIJXFNK7LZ'

  ipcMain.handle('settings:detectGroup', async (_event, accountIds: string[]) => {
    try {
      const params = new URLSearchParams({ accounts: accountIds.join(',') })
      const res = await fetch(`${GROUP_URL}?${params}`, {
        headers: { Authorization: `Bearer ${GROUP_API_KEY}` }
      })
      const result = await res.json()
      // Store detected group for settings API calls
      if (result.group && result.group !== 'unknown') {
        detectedGroup = result.group
      }
      resolveGroupReady()
      return result
    } catch {
      return { group: 'unknown', label: '未知群組' }
    }
  })

  // Fetch account types (帳戶能力) from D1 USERS table
  ipcMain.handle(
    'settings:getAccountTypes',
    async (_event, accountIds: string[], d1Target?: string) => {
      try {
        const targetLabel = d1Target || 'staging'
        const t = SETTINGS_TARGETS.find((t) => t.label === targetLabel) || SETTINGS_TARGETS[0]
        const baseUrl = t.url.replace('/api/trader-settings', '/api/trader-account-types')
        const params = new URLSearchParams({ accounts: accountIds.join(',') })
        const res = await fetch(`${baseUrl}?${params}`, {
          headers: { Authorization: `Bearer ${t.apiKey}` }
        })
        const result = await res.json()
        console.log('[settings:getAccountTypes] result:', JSON.stringify(result))
        return result
      } catch {
        return { accountTypes: {} }
      }
    }
  )

  // Upload 1-year daily closing prices for ONE symbol to D1 (both staging & production)
  const UPLOAD_TARGETS = [
    {
      label: 'staging',
      apiKey: 'MZ12MUOIJXFNK7LZ',
      bulk: 'https://staging.scott-agent.com/api/market-data/bulk',
      clearCache: 'https://staging.scott-agent.com/api/market-data/clear-cache',
      backfill: 'https://staging.scott-agent.com/api/options/backfill-prices',
      neededSymbols: 'https://staging.scott-agent.com/api/market-data/needed-symbols'
    },
    {
      label: 'production',
      apiKey: 'R1TIoxXSri38FVn63eolduORz-NXUNyqoptyIx07',
      bulk: 'https://scott-agent.com/api/market-data/bulk',
      clearCache: 'https://scott-agent.com/api/market-data/clear-cache',
      backfill: 'https://scott-agent.com/api/options/backfill-prices',
      neededSymbols: 'https://scott-agent.com/api/market-data/needed-symbols'
    }
  ]

  // Fetch the list of symbols the web app needs stock prices for
  ipcMain.handle(
    'prices:getNeededSymbols',
    async (_event, target?: 'staging' | 'production') => {
      const effectiveTarget = target || 'staging'
      const t = UPLOAD_TARGETS.find((t) => t.label === effectiveTarget) || UPLOAD_TARGETS[0]
      try {
        const url = `${t.neededSymbols}?group=${encodeURIComponent(detectedGroup)}`
        console.log(`[getNeededSymbols] url=${url}`)
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${t.apiKey}` }
        })
        if (!res.ok) {
          console.warn(`[getNeededSymbols] error: ${res.status}`)
          return []
        }
        const json = (await res.json()) as { symbols?: string[] }
        console.log(`[getNeededSymbols] symbols=`, json.symbols)
        return json.symbols || []
      } catch (err) {
        console.error(`[getNeededSymbols] catch:`, err)
        return []
      }
    }
  )

  ipcMain.handle(
    'prices:uploadSymbol',
    async (_event, symbol: string, target?: 'staging' | 'production') => {
      const effectiveTarget = target || 'staging'
      const targets = UPLOAD_TARGETS.filter((t) => t.label === effectiveTarget)
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

        // Upload to selected target(s) in parallel
        const results = await Promise.allSettled(
          targets.map(async (t) => {
            const hdrs = { 'Content-Type': 'application/json', Authorization: `Bearer ${t.apiKey}` }
            const bulkUrl = `${t.bulk}?group=${encodeURIComponent(detectedGroup)}`
            const res = await fetch(bulkUrl, { method: 'POST', headers: hdrs, body })
            if (!res.ok)
              throw new Error(`${t.label}: ${await res.text().catch(() => res.statusText)}`)
            return t.label
          })
        )

        const failures = results.filter((r) => r.status === 'rejected')
        if (failures.length === targets.length) {
          const msgs = failures.map((r) => (r as PromiseRejectedResult).reason?.message).join('; ')
          return { success: false, error: `Upload failed: ${msgs}` }
        }
        if (failures.length > 0) {
          failures.forEach((r) =>
            console.warn('[upload] partial fail:', (r as PromiseRejectedResult).reason?.message)
          )
        }

        // Clear cache on selected environments
        for (const t of targets) {
          const hdrs = { 'Content-Type': 'application/json', Authorization: `Bearer ${t.apiKey}` }
          const cacheUrl = `${t.clearCache}?group=${encodeURIComponent(detectedGroup)}`
          fetch(cacheUrl, {
            method: 'POST',
            headers: hdrs,
            body: JSON.stringify({ symbols: [symbol] })
          }).catch((e) => console.warn(`[clear-cache][${t.label}] notify failed:`, e))
        }

        // ── Backfill underlying_price in OPTIONS table (best-effort) ──
        // For each target, find OPTIONS records missing underlying_price for this symbol,
        // fetch 1-min intraday bars from IB for each relevant date, and update.
        for (const t of targets) {
          try {
            const hdrs = {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${t.apiKey}`
            }
            const bfUrl = `${t.backfill}?symbol=${encodeURIComponent(symbol)}&group=${encodeURIComponent(detectedGroup)}`
            const bfRes = await fetch(bfUrl, { headers: hdrs })
            if (!bfRes.ok) {
              console.warn(`[backfill][${t.label}] GET failed: ${bfRes.status}`)
              continue
            }
            const { options: missingOpts } = (await bfRes.json()) as {
              options: { id: number; open_date: number }[]
            }
            if (!missingOpts || missingOpts.length === 0) {
              console.log(`[backfill][${t.label}] No missing underlying_price for ${symbol}`)
              continue
            }

            console.log(
              `[backfill][${t.label}] Found ${missingOpts.length} options missing underlying_price for ${symbol}`
            )

            // Group by trading date (YYYYMMDD) — open_date is Unix timestamp (seconds)
            const byDate = new Map<string, { id: number; open_date: number }[]>()
            for (const opt of missingOpts) {
              // Convert open_date (UTC seconds) to YYYYMMDD in US Eastern (approximate with UTC-5)
              const dateObj = new Date(opt.open_date * 1000)
              const yyyy = dateObj.getUTCFullYear()
              const mm = String(dateObj.getUTCMonth() + 1).padStart(2, '0')
              const dd = String(dateObj.getUTCDate()).padStart(2, '0')
              const dateKey = `${yyyy}${mm}${dd}`
              if (!byDate.has(dateKey)) byDate.set(dateKey, [])
              byDate.get(dateKey)!.push(opt)
            }

            const updates: { id: number; underlying_price: number }[] = []

            for (const [dateKey, opts] of byDate) {
              try {
                // Fetch 1-min bars for this day from IB
                // endDateTime format: 'YYYYMMDD 23:59:59'
                const intradayBars = await getHistoricalData({
                  symbol,
                  durationString: '1 D',
                  barSizeSetting: '1 min',
                  endDateTime: `${dateKey} 23:59:59`,
                  useRTH: 1,
                  whatToShow: 'TRADES'
                })

                if (intradayBars.length === 0) {
                  console.warn(`[backfill] No intraday bars for ${symbol} on ${dateKey}`)
                  continue
                }

                // Parse bar times to Unix seconds for matching
                const parsedBars = intradayBars.map((bar) => {
                  const t = String(bar.time)
                  let barSec: number
                  if (/^\d{8}\s/.test(t)) {
                    // Format: "YYYYMMDD HH:mm:ss"
                    const y = t.substring(0, 4)
                    const m = t.substring(4, 6)
                    const d = t.substring(6, 8)
                    const rest = t.substring(9) // "HH:mm:ss"
                    barSec = Math.floor(
                      new Date(`${y}-${m}-${d}T${rest}Z`).getTime() / 1000
                    )
                  } else {
                    barSec = Math.floor(new Date(t).getTime() / 1000)
                  }
                  return { sec: barSec, close: bar.close }
                })

                // For each option, find the closest 1-min bar
                for (const opt of opts) {
                  let bestBar = parsedBars[0]
                  let bestDiff = Math.abs(opt.open_date - parsedBars[0].sec)
                  for (const pb of parsedBars) {
                    const diff = Math.abs(opt.open_date - pb.sec)
                    if (diff < bestDiff) {
                      bestDiff = diff
                      bestBar = pb
                    }
                  }
                  updates.push({ id: opt.id, underlying_price: bestBar.close })
                }

                // IB pacing: wait 2s between intraday requests to respect rate limits
                if (byDate.size > 1) {
                  await new Promise((r) => setTimeout(r, 2000))
                }
              } catch (dayErr) {
                console.warn(
                  `[backfill] Failed to get intraday for ${symbol} ${dateKey}:`,
                  dayErr instanceof Error ? dayErr.message : dayErr
                )
              }
            }

            // Send batch update
            if (updates.length > 0) {
              const postRes = await fetch(bfUrl, {
                method: 'POST',
                headers: hdrs,
                body: JSON.stringify({ updates })
              })
              if (postRes.ok) {
                const postJson = await postRes.json()
                console.log(
                  `[backfill][${t.label}] Updated ${postJson.updated} underlying_price records for ${symbol}`
                )
              } else {
                console.warn(`[backfill][${t.label}] POST failed: ${postRes.status}`)
              }
            }
          } catch (bfErr) {
            console.warn(
              `[backfill][${t.label}] Error:`,
              bfErr instanceof Error ? bfErr.message : bfErr
            )
          }
        }

        return { success: true, count: rows.length }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        return { success: false, error: msg }
      }
    }
  )

  // Fetch distinct underlying symbols with missing underlying_price
  ipcMain.handle(
    'prices:getMissingPriceSymbols',
    async (_event, target?: 'staging' | 'production') => {
      const effectiveTarget = target || 'staging'
      const t = UPLOAD_TARGETS.find((t) => t.label === effectiveTarget) || UPLOAD_TARGETS[0]
      try {
        const hdrs = {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${t.apiKey}`
        }
        const url = `${t.backfill}?group=${encodeURIComponent(detectedGroup)}`
        console.log(`[getMissingPriceSymbols] url=${url}`)
        const res = await fetch(url, { headers: hdrs })
        console.log(`[getMissingPriceSymbols] status=${res.status}`)
        if (!res.ok) {
          const errText = await res.text()
          console.warn(`[getMissingPriceSymbols] error: ${errText}`)
          return []
        }
        const json = (await res.json()) as { symbols?: string[] }
        console.log(`[getMissingPriceSymbols] symbols=`, json.symbols)
        return json.symbols || []
      } catch (err) {
        console.error(`[getMissingPriceSymbols] catch:`, err)
        return []
      }
    }
  )

  // Backfill underlying_price for one symbol using 1-second IB bars
  ipcMain.handle(
    'prices:backfillUnderlyingPrice',
    async (_event, symbol: string, target?: 'staging' | 'production') => {
      const effectiveTarget = target || 'staging'
      const t = UPLOAD_TARGETS.find((t) => t.label === effectiveTarget) || UPLOAD_TARGETS[0]
      try {
        const hdrs = {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${t.apiKey}`
        }
        const bfUrl = `${t.backfill}?symbol=${encodeURIComponent(symbol)}&group=${encodeURIComponent(detectedGroup)}`
        const bfRes = await fetch(bfUrl, { headers: hdrs })
        if (!bfRes.ok) {
          return { success: false, found: 0, updated: 0, error: `API error: ${bfRes.status}` }
        }
        const { options: missingOpts } = (await bfRes.json()) as {
          options: { id: number; open_date: number }[]
        }
        if (!missingOpts || missingOpts.length === 0) {
          return { success: true, found: 0, updated: 0 }
        }

        console.log(
          `[backfill-btn][${t.label}] Found ${missingOpts.length} missing underlying_price for ${symbol}`
        )

        const updates: { id: number; underlying_price: number }[] = []

        // ── Batch by 1-day window to minimise IB requests (1-min bars) ──
        const WINDOW = 86400 // 1 day in seconds
        const sorted = [...missingOpts].sort((a, b) => a.open_date - b.open_date)
        const groups: { start: number; end: number; opts: typeof missingOpts }[] = []
        for (const opt of sorted) {
          const last = groups[groups.length - 1]
          if (last && opt.open_date - last.start < WINDOW) {
            last.end = Math.max(last.end, opt.open_date)
            last.opts.push(opt)
          } else {
            groups.push({ start: opt.open_date, end: opt.open_date, opts: [opt] })
          }
        }
        console.log(
          `[backfill-btn][${t.label}] Grouped ${missingOpts.length} records into ${groups.length} time-windows for ${symbol}`
        )

        // Format Unix epoch → IB endDateTime string
        // NOTE: open_date in DB stores ET time as naive UTC, so we use UTC methods
        // which gives the correct ET time string for IB
        const fmtDt = (sec: number): string => {
          const d = new Date(sec * 1000)
          const Y = d.getUTCFullYear()
          const M = String(d.getUTCMonth() + 1).padStart(2, '0')
          const D = String(d.getUTCDate()).padStart(2, '0')
          const h = String(d.getUTCHours()).padStart(2, '0')
          const m = String(d.getUTCMinutes()).padStart(2, '0')
          const s = String(d.getUTCSeconds()).padStart(2, '0')
          return `${Y}${M}${D}-${h}:${m}:${s}`
        }

        for (let gi = 0; gi < groups.length; gi++) {
          const grp = groups[gi]
          try {
            // endDateTime = latest record + 30s buffer
            const endSec = grp.end + 30
            // duration covers earliest to latest + padding, min 60s
            const dur = Math.max(60, grp.end - grp.start + 60)

            console.log(
              `[backfill-btn] Window ${gi + 1}/${groups.length}: ${grp.opts.length} records, ` +
                `${dur}s duration, end=${fmtDt(endSec)}`
            )

            const secBars = await getHistoricalData({
              symbol,
              durationString: `${dur} S`,
              barSizeSetting: '1 min',
              endDateTime: fmtDt(endSec),
              useRTH: 1,
              whatToShow: 'TRADES'
            })

            if (secBars.length === 0) {
              console.warn(`[backfill-btn] No bars for window ${gi + 1}`)
              continue
            }

            console.log(
              `[backfill-btn] Window ${gi + 1}: got ${secBars.length} bars, ` +
                `first=${JSON.stringify(secBars[0].time)} (type=${typeof secBars[0].time}), ` +
                `last=${JSON.stringify(secBars[secBars.length - 1].time)}`
            )

            // Parse bar times once for this window
            // IB bar.time formats observed:
            //   number: unix seconds
            //   "YYYYMMDD  HH:MM:SS": dense date string (ET)
            //   "YYYY MM DD HH:MM:SS timezone": spaced date with timezone (e.g. "2026 02 21 04:55:00 Asia/Taipei")
            //   ISO string: fallback
            // NOTE: open_date in DB stores ET time as naive UTC, so we parse bar time
            //   and strip timezone, treating the local time digits as UTC for correct matching.
            const parsedBars = secBars.map((bar) => {
              let barSec: number
              if (typeof bar.time === 'number') {
                barSec = bar.time
              } else {
                const ts = String(bar.time).trim()
                // Try "YYYY MM DD HH:MM:SS timezone" format (IB 1-min bars)
                const spacedMatch = ts.match(/^(\d{4})\s+(\d{2})\s+(\d{2})\s+(\d{2}:\d{2}:\d{2})/)
                if (spacedMatch) {
                  // Treat as naive UTC (matches how open_date is stored)
                  barSec = Math.floor(
                    new Date(`${spacedMatch[1]}-${spacedMatch[2]}-${spacedMatch[3]}T${spacedMatch[4]}Z`).getTime() / 1000
                  )
                } else if (/^\d{8}\s/.test(ts)) {
                  // Format: "20260306  10:06:17" — dense date
                  const y = ts.substring(0, 4)
                  const mo = ts.substring(4, 6)
                  const da = ts.substring(6, 8)
                  const rest = ts.substring(9).trim()
                  barSec = Math.floor(new Date(`${y}-${mo}-${da}T${rest}Z`).getTime() / 1000)
                } else {
                  barSec = Math.floor(new Date(ts).getTime() / 1000)
                }
              }
              return { sec: barSec, close: bar.close }
            })

            // Match every record in this group to closest bar
            for (const opt of grp.opts) {
              let bestBar = parsedBars[0]
              let bestDiff = Math.abs(opt.open_date - parsedBars[0].sec)
              for (const pb of parsedBars) {
                const diff = Math.abs(opt.open_date - pb.sec)
                if (diff < bestDiff) {
                  bestDiff = diff
                  bestBar = pb
                }
              }
              updates.push({ id: opt.id, underlying_price: bestBar.close })
              // Debug: show the open_date as decoded time
              const od = new Date(opt.open_date * 1000)
              const odStr = `${od.getUTCFullYear()}${String(od.getUTCMonth() + 1).padStart(2, '0')}${String(od.getUTCDate()).padStart(2, '0')}-${String(od.getUTCHours()).padStart(2, '0')}:${String(od.getUTCMinutes()).padStart(2, '0')}:${String(od.getUTCSeconds()).padStart(2, '0')}`
              const bd = new Date(bestBar.sec * 1000)
              const bdStr = `${bd.getUTCFullYear()}${String(bd.getUTCMonth() + 1).padStart(2, '0')}${String(bd.getUTCDate()).padStart(2, '0')}-${String(bd.getUTCHours()).padStart(2, '0')}:${String(bd.getUTCMinutes()).padStart(2, '0')}:${String(bd.getUTCSeconds()).padStart(2, '0')}`
              console.log(
                `[backfill-btn]   id=${opt.id}: open_date=${odStr} matched_bar=${bdStr} price=${bestBar.close}, diff=${bestDiff}s`
              )
            }

            // IB pacing: wait 2s between window requests (not per record)
            if (gi < groups.length - 1) {
              await new Promise((r) => setTimeout(r, 10000))
            }
          } catch (grpErr) {
            console.warn(
              `[backfill-btn] Window ${gi + 1} failed:`,
              grpErr instanceof Error ? grpErr.message : grpErr
            )
          }
        }

        // Send batch update
        if (updates.length > 0) {
          const postRes = await fetch(bfUrl, {
            method: 'POST',
            headers: hdrs,
            body: JSON.stringify({ updates })
          })
          if (postRes.ok) {
            const postJson = await postRes.json()
            console.log(
              `[backfill-btn][${t.label}] Updated ${postJson.updated} records for ${symbol}`
            )
            return { success: true, found: missingOpts.length, updated: postJson.updated }
          } else {
            return {
              success: false,
              found: missingOpts.length,
              updated: 0,
              error: `POST failed: ${postRes.status}`
            }
          }
        }

        return { success: true, found: missingOpts.length, updated: updates.length }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        return { success: false, found: 0, updated: 0, error: msg }
      }
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
