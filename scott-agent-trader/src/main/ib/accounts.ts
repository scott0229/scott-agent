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
      if (accountName === accountId && key === 'AccountOrGroup' && value && value !== accountId) {
        alias = value
      }
    }

    const endHandler = (account: string): void => {
      if (account === accountId && !resolved) {
        resolved = true
        api.removeListener(EventName.updateAccountValue, valueHandler)
        api.removeListener(EventName.accountDownloadEnd, endHandler)
        // Unsubscribe
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

export function clearAliasCache(): void {
  aliasCache.clear()
}

// Request account aliases for all accounts (parallel + cached)
async function requestAccountAliases(accountIds: string[]): Promise<Map<string, string>> {
  const aliasMap = new Map<string, string>()
  const uncached: string[] = []

  // Use cached values first
  for (const id of accountIds) {
    if (aliasCache.has(id)) {
      aliasMap.set(id, aliasCache.get(id)!)
    } else {
      uncached.push(id)
    }
  }

  // Fetch remaining in parallel
  if (uncached.length > 0) {
    const results = await Promise.all(
      uncached.map(async (id) => ({ id, alias: await requestSingleAccountAlias(id) }))
    )
    for (const { id, alias } of results) {
      if (alias) {
        aliasCache.set(id, alias)
        aliasMap.set(id, alias)
      }
    }
  }

  return aliasMap
}



// Build account data map from summary items
function buildAccountMap(summaryItems: AccountSummaryItem[]): Map<string, AccountData> {
  const accountMap = new Map<string, AccountData>()
  for (const item of summaryItems) {
    if (!accountMap.has(item.account)) {
      accountMap.set(item.account, {
        accountId: item.account,
        alias: '',
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
export async function requestAccountSummary(
  reqId: number = 9001,
  group: string = 'All'
): Promise<AccountData[]> {
  return requestAccountSummaryRaw(reqId, group)
}

// Fetch aliases for a list of account IDs (called separately by the renderer)
export async function requestAccountAliasesForIds(
  accountIds: string[]
): Promise<Record<string, string>> {
  const aliasMap = await requestAccountAliases(accountIds)
  return Object.fromEntries(aliasMap)
}

// Raw account summary request (without aliases)
function requestAccountSummaryRaw(
  reqId: number,
  group: string
): Promise<AccountData[]> {
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
        resolve(Array.from(buildAccountMap(summaryItems).values()))
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
        resolve(Array.from(buildAccountMap(summaryItems).values()))
      } else {
        reject(new Error('Timeout requesting account summary'))
      }
    }, 15000)

    api.reqAccountSummary(reqId, group, tags)
  })
}


// Request positions for all accounts
export function requestPositions(): Promise<PositionData[]> {
    return new Promise((resolve, reject) => {
        const api = getIBApi()
        if (!api) {
            reject(new Error('Not connected to IB'))
            return
        }

        const positions: PositionData[] = []

        const posHandler = (
            account: string,
            contract: any,
            pos: number,
            avgCost: number
        ): void => {
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

        const endHandler = (): void => {
            api.removeListener(EventName.position, posHandler)
            api.removeListener(EventName.positionEnd, endHandler)
            resolve(positions)
        }

        api.on(EventName.position, posHandler)
        api.on(EventName.positionEnd, endHandler)

        // Timeout after 15 seconds
        setTimeout(() => {
            api.removeListener(EventName.position, posHandler)
            api.removeListener(EventName.positionEnd, endHandler)
            resolve(positions) // Return what we have
        }, 15000)

        api.reqPositions()
    })
}
