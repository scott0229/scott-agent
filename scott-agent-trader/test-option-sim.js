/**
 * Test that simulates app conditions:
 * - Same clientId as app (1)
 * - reqMarketDataType(4) for stock quotes happening concurrently
 * - 22 option contracts
 */
const { IBApi, EventName, SecType, OptionType, Option } = require('@stoqey/ib')

// Use same clientId as the app to test under same conditions
const api = new IBApi({ host: '127.0.0.1', port: 7497, clientId: 97 })

console.log('=== App-Simulation Test ===')

let optionTickCount = 0
let stockTickCount = 0

api.on(EventName.connected, () => {
  console.log('[CONNECTED]')
  
  api.on(EventName.error, (err, code, reqId) => {
    console.log(`[ERROR] reqId=${reqId}, code=${code}`)
  })
  api.on(EventName.tickPrice, (reqId, tickType, value) => {
    if (reqId >= 200000) {
      optionTickCount++
      if (optionTickCount <= 10) {
        console.log(`[OPT_TICK] reqId=${reqId}, type=${tickType}, value=${value}`)
      }
    } else {
      stockTickCount++
      if (stockTickCount <= 5) {
        console.log(`[STK_TICK] reqId=${reqId}, type=${tickType}, value=${value}`)
      }
    }
  })
  api.on(EventName.tickSnapshotEnd, (reqId) => {
    console.log(`[SNAP_END] reqId=${reqId}`)
  })
  api.on(EventName.marketDataType, (reqId, type) => {
    if (reqId >= 200000 || reqId >= 80000) {
      console.log(`[MKT_TYPE] reqId=${reqId}, type=${type}`)
    }
  })

  // Step 1: Start stock quotes (simulating auto-refresh)
  console.log('\n--- Step 1: Stock quotes with mktDataType=4 ---')
  api.reqMarketDataType(4)
  const stocks = ['QQQ', 'TQQQ', 'PLTR', 'QLD', 'SOFI']
  stocks.forEach((sym, i) => {
    const contract = { symbol: sym, secType: SecType.STK, exchange: 'SMART', currency: 'USD' }
    api.reqMktData(80000 + i, contract, '', true, false)
  })

  // Step 2: After 2s, request option data (simulating user opening option chain)
  setTimeout(() => {
    console.log('\n--- Step 2: Option data with mktDataType=1 ---')
    api.reqMarketDataType(1)
    
    // Create 22 option requests (11 strikes x 2 C/P)
    const strikes = [585, 590, 595, 598, 600, 602, 605, 608, 610, 615, 620]
    let reqId = 200000
    strikes.forEach(strike => {
      ['C', 'P'].forEach(right => {
        const contract = new Option('QQQ', '20260223', strike, right === 'C' ? OptionType.Call : OptionType.Put, 'SMART', 'USD')
        api.reqMktData(reqId, contract, '', false, false)
        reqId++
      })
    })
    console.log(`Sent ${reqId - 200000} option requests (reqIds 200000-${reqId-1})`)
  }, 2000)

  // Step 3: After 4s, do another stock quote refresh (simulating auto-refresh)
  setTimeout(() => {
    console.log('\n--- Step 3: Another stock quote refresh ---')
    api.reqMarketDataType(4)
    stocks.forEach((sym, i) => {
      const contract = { symbol: sym, secType: SecType.STK, exchange: 'SMART', currency: 'USD' }
      api.reqMktData(80010 + i, contract, '', true, false)
    })
  }, 4000)

  // Report after 8 seconds
  setTimeout(() => {
    console.log(`\n=== Results after 8s ===`)
    console.log(`Option ticks received: ${optionTickCount}`)
    console.log(`Stock ticks received: ${stockTickCount}`)
    
    // Cancel all
    for (let id = 200000; id < 200022; id++) {
      try { api.cancelMktData(id) } catch(e) {}
    }
    
    setTimeout(() => {
      api.disconnect()
      process.exit(0)
    }, 1000)
  }, 8000)
})

api.connect()
setTimeout(() => { console.log('TIMEOUT'); process.exit(1) }, 15000)
