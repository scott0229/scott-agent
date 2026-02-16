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
    netLiquidation: number
    availableFunds: number
    totalCashValue: number
    currency: string
}

export interface PositionData {
    account: string
    symbol: string
    secType: string
    quantity: number
    avgCost: number
    marketValue?: number
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

// Request account summary for all accounts
export function requestAccountSummary(
    reqId: number = 9001,
    group: string = 'All'
): Promise<AccountData[]> {
    return new Promise((resolve, reject) => {
        const api = getIBApi()
        if (!api) {
            reject(new Error('Not connected to IB'))
            return
        }

        const summaryItems: AccountSummaryItem[] = []
        const tags = 'NetLiquidation,AvailableFunds,TotalCashValue'

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

                // Group by account
                const accountMap = new Map<string, AccountData>()
                for (const item of summaryItems) {
                    if (!accountMap.has(item.account)) {
                        accountMap.set(item.account, {
                            accountId: item.account,
                            netLiquidation: 0,
                            availableFunds: 0,
                            totalCashValue: 0,
                            currency: item.currency
                        })
                    }
                    const acct = accountMap.get(item.account)!
                    const val = parseFloat(item.value) || 0
                    if (item.tag === 'NetLiquidation') acct.netLiquidation = val
                    if (item.tag === 'AvailableFunds') acct.availableFunds = val
                    if (item.tag === 'TotalCashValue') acct.totalCashValue = val
                }

                resolve(Array.from(accountMap.values()))
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
                // Return whatever we got
                const accountMap = new Map<string, AccountData>()
                for (const item of summaryItems) {
                    if (!accountMap.has(item.account)) {
                        accountMap.set(item.account, {
                            accountId: item.account,
                            netLiquidation: 0,
                            availableFunds: 0,
                            totalCashValue: 0,
                            currency: item.currency
                        })
                    }
                    const acct = accountMap.get(item.account)!
                    const val = parseFloat(item.value) || 0
                    if (item.tag === 'NetLiquidation') acct.netLiquidation = val
                    if (item.tag === 'AvailableFunds') acct.availableFunds = val
                    if (item.tag === 'TotalCashValue') acct.totalCashValue = val
                }
                resolve(Array.from(accountMap.values()))
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
                    avgCost
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
