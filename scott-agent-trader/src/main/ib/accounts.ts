import { EventName, SecType } from '@stoqey/ib'
import { getIBApi } from './connection'

export interface AccountSummaryItem {
  account: string
  tag: string
  value: string
  currency: string
}

export interface AccountData {
  accountId: string
  alias: string
  accountType: string
  netLiquidation: number
  availableFunds: number
  totalCashValue: number
  grossPositionValue: number
  currency: string
}

export interface PositionData {
  account: string
  symbol: string
  secType: string
  quantity: number
  avgCost: number
  marketValue?: number
  expiry?: string
  strike?: number
  right?: string
}

// Request managed accounts list (FA accounts)
export function requestManagedAccounts(): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const api = getIBApi()
    if (!api) {
      reject(new Error('Not connected to IB'))
      return
    }

    const handler = (accountsList: string): void => {
      api.removeListener(EventName.managedAccounts, handler)
      const accounts = accountsList
        .split(',')
        .map((a) => a.trim())
        .filter((a) => a.length > 0)
      resolve(accounts)
    }

    api.on(EventName.managedAccounts, handler)

    // Timeout after 10 seconds
    setTimeout(() => {
      api.removeListener(EventName.managedAccounts, handler)
      reject(new Error('Timeout requesting managed accounts'))
    }, 10000)

    api.reqManagedAccts()
  })
}

// Request account alias for a single account using reqAccountUpdates
function requestSingleAccountAlias(accountId: string): Promise<string> {
  return new Promise((resolve) => {
    const api = getIBApi()
    if (!api) {
      resolve('')
      return
    }

    let alias = ''
    let resolved = false

    const valueHandler = (
      key: string,
      value: string,
      _currency: string,
      accountName: string
    ): void => {
      if (accountName === accountId) {
        if (key === 'AccountOrGroup' && value && value !== accountId) {
          alias = value
        }
      }
    }

    const endHandler = (account: string): void => {
      if (account === accountId && !resolved) {
        resolved = true
        api.removeListener(EventName.updateAccountValue, valueHandler)
        api.removeListener(EventName.accountDownloadEnd, endHandler)
        api.reqAccountUpdates(false, accountId)
        resolve(alias)
      }
    }

    api.on(EventName.updateAccountValue, valueHandler)
    api.on(EventName.accountDownloadEnd, endHandler)

    // Timeout after 5 seconds
    setTimeout(() => {
      if (!resolved) {
        resolved = true
        api.removeListener(EventName.updateAccountValue, valueHandler)
        api.removeListener(EventName.accountDownloadEnd, endHandler)
        api.reqAccountUpdates(false, accountId)
        resolve(alias)
      }
    }, 5000)

    api.reqAccountUpdates(true, accountId)
  })
}

// Alias cache — survives across calls, cleared on disconnect
const aliasCache = new Map<string, string>()

// Auto-incrementing reqId to avoid conflicts between concurrent summary requests
let nextSummaryReqId = 9001
let activeSummaryReqId: number | null = null

export function clearAliasCache(): void {
  aliasCache.clear()
}

// Request aliases for all accounts (parallel + cached)
async function requestAccountAliases(accountIds: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  const uncached: string[] = []

  // Use cached values first
  for (const id of accountIds) {
    if (aliasCache.has(id)) {
      result.set(id, aliasCache.get(id)!)
    } else {
      uncached.push(id)
    }
  }

  // Fetch remaining SEQUENTIALLY. reqAccountUpdates supports only ONE active
  // account subscription at a time per connection — firing them in parallel
  // makes each reqAccountUpdates(true, id) replace the previous subscription,
  // so most accounts never receive their AccountOrGroup value, time out, and
  // fall back to the raw UXXXXX id. One at a time removes the contention.
  for (const id of uncached) {
    const alias = await requestSingleAccountAlias(id)
    if (alias) {
      aliasCache.set(id, alias)
      result.set(id, alias)
    }
  }

  return result
}

// Build account data map from summary items
function buildAccountMap(summaryItems: AccountSummaryItem[]): Map<string, AccountData> {
  const accountMap = new Map<string, AccountData>()
  for (const item of summaryItems) {
    if (!accountMap.has(item.account)) {
      accountMap.set(item.account, {
        accountId: item.account,
        alias: '',
        accountType: '',
        netLiquidation: 0,
        availableFunds: 0,
        totalCashValue: 0,
        grossPositionValue: 0,
        currency: item.currency
      })
    }
    const acct = accountMap.get(item.account)!
    const val = parseFloat(item.value) || 0
    if (item.tag === 'NetLiquidation') acct.netLiquidation = val
    if (item.tag === 'AvailableFunds') acct.availableFunds = val
    if (item.tag === 'TotalCashValue') acct.totalCashValue = val
    if (item.tag === 'GrossPositionValue') acct.grossPositionValue = val
  }
  return accountMap
}

// Request account summary for all accounts (no longer blocks on alias fetch)
export async function requestAccountSummary(group: string = 'All'): Promise<AccountData[]> {
  // Cancel any in-flight summary request
  if (activeSummaryReqId !== null) {
    const api = getIBApi()
    if (api) api.cancelAccountSummary(activeSummaryReqId)
  }
  const reqId = nextSummaryReqId++
  activeSummaryReqId = reqId
  try {
    return await requestAccountSummaryRaw(reqId, group)
  } finally {
    if (activeSummaryReqId === reqId) activeSummaryReqId = null
  }
}

// Fetch aliases for a list of account IDs (called separately by the renderer)
export async function requestAccountAliasesForIds(
  accountIds: string[]
): Promise<Record<string, string>> {
  const aliasMap = await requestAccountAliases(accountIds)
  return Object.fromEntries(aliasMap)
}

// Raw account summary request (without aliases)
function requestAccountSummaryRaw(reqId: number, group: string): Promise<AccountData[]> {
  return new Promise((resolve, reject) => {
    const api = getIBApi()
    if (!api) {
      reject(new Error('Not connected to IB'))
      return
    }

    const summaryItems: AccountSummaryItem[] = []
    const tags = 'NetLiquidation,AvailableFunds,TotalCashValue,GrossPositionValue'

    const dataHandler = (
      _reqId: number,
      account: string,
      tag: string,
      value: string,
      currency: string
    ): void => {
      if (_reqId === reqId) {
        summaryItems.push({ account, tag, value, currency })
      }
    }

    const endHandler = (_reqId: number): void => {
      if (_reqId === reqId) {
        api.removeListener(EventName.accountSummary, dataHandler)
        api.removeListener(EventName.accountSummaryEnd, endHandler)
        const accounts = Array.from(buildAccountMap(summaryItems).values())
        console.log(`[IB] Account summary received: ${accounts.length} accounts`)
        resolve(accounts)
      }
    }

    api.on(EventName.accountSummary, dataHandler)
    api.on(EventName.accountSummaryEnd, endHandler)

    // Timeout after 15 seconds
    setTimeout(() => {
      api.removeListener(EventName.accountSummary, dataHandler)
      api.removeListener(EventName.accountSummaryEnd, endHandler)
      api.cancelAccountSummary(reqId)
      if (summaryItems.length > 0) {
        const accounts = Array.from(buildAccountMap(summaryItems).values())
        console.log(
          `[IB] Account summary timeout (partial): ${accounts.length} accounts, ${summaryItems.length} items`
        )
        resolve(accounts)
      } else {
        console.log('[IB] Account summary timeout: no data received')
        reject(new Error('Timeout requesting account summary'))
      }
    }, 15000)

    api.reqAccountSummary(reqId, group, tags)
  })
}

// Request positions for all accounts.
//
// reqPositions() opens a *streaming subscription*, not a one-shot request:
// after the initial snapshot + positionEnd, IB keeps pushing incremental
// (delta) updates until cancelPositions() is called. The old code never
// cancelled, so overlapping calls and stray delta cycles could let one call
// resolve on a positionEnd that belonged to a partial update — handing back a
// snapshot that was missing a leg at random (e.g. a strangle's short put would
// vanish from the card until the next complete poll).
//
// Fix: cancel the subscription the instant the snapshot completes, so every
// call is a clean one-shot; and dedupe concurrent callers onto one in-flight
// request so two polls can't interleave on the shared event stream.
let positionsInFlight: Promise<PositionData[]> | null = null

export function requestPositions(): Promise<PositionData[]> {
  if (positionsInFlight) return positionsInFlight

  positionsInFlight = new Promise<PositionData[]>((resolve, reject) => {
    const api = getIBApi()
    if (!api) {
      positionsInFlight = null
      reject(new Error('Not connected to IB'))
      return
    }

    const positions: PositionData[] = []
    let settled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const posHandler = (account: string, contract: any, pos: number, avgCost: number): void => {
      if (pos !== 0) {
        positions.push({
          account,
          symbol: contract.symbol || '',
          secType: contract.secType || SecType.STK,
          quantity: pos,
          avgCost,
          expiry: contract.lastTradeDateOrContractMonth || undefined,
          strike: contract.strike || undefined,
          right: contract.right || undefined
        })
      }
    }

    const finish = (label: string): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      api.removeListener(EventName.position, posHandler)
      api.removeListener(EventName.positionEnd, endHandler)
      try {
        // Close the streaming subscription so it can't leak delta updates into
        // the next caller's snapshot.
        api.cancelPositions()
      } catch {
        /* subscription may already be gone — ignore */
      }
      console.log(`[IB] Positions ${label}: ${positions.length}`)
      positionsInFlight = null
      resolve(positions)
    }

    const endHandler = (): void => finish('received')

    api.on(EventName.position, posHandler as any)
    api.on(EventName.positionEnd, endHandler)

    // Timeout after 15 seconds — return whatever arrived.
    timer = setTimeout(() => finish('timeout'), 15000)

    api.reqPositions()
  })

  return positionsInFlight
}
