/**
 * Focused test: option data with the exact expiry the app uses
 * Run with: node test-option-focused.js
 */
const { IBApi, EventName, SecType, OptionType, Option } = require('@stoqey/ib')

const api = new IBApi({ host: '127.0.0.1', port: 7497, clientId: 98 })

console.log('=== Focused Option Data Test ===')

api.on(EventName.connected, () => {
  console.log('[CONNECTED]')
  
  // Log ALL events
  api.on(EventName.error, (err, code, reqId) => {
    console.log(`[ERROR] reqId=${reqId}, code=${code}, msg=${err.message}`)
  })
  api.on(EventName.tickPrice, (reqId, tickType, value) => {
    console.log(`[TICK_PRICE] reqId=${reqId}, type=${tickType}, value=${value}`)
  })
  api.on(EventName.tickSize, (reqId, tickType, value) => {
    console.log(`[TICK_SIZE] reqId=${reqId}, type=${tickType}, value=${value}`)
  })
  api.on(EventName.tickOptionComputation, (reqId, field, tickAttrib, iv, delta, optPrice, pvDiv, gamma, vega, theta, undPrice) => {
    console.log(`[TICK_OPT_COMP] reqId=${reqId}, field=${field}, iv=${iv}, delta=${delta}, theta=${theta}`)
  })
  api.on(EventName.tickSnapshotEnd, (reqId) => {
    console.log(`[SNAPSHOT_END] reqId=${reqId}`)
  })
  api.on(EventName.marketDataType, (reqId, type) => {
    console.log(`[MKT_DATA_TYPE] reqId=${reqId}, type=${type}`)
  })

  // Test with exact expiry the app uses: 20260223
  console.log('\n--- Test A: expiry=20260223 (app uses this), mktDataType=1, streaming ---')
  api.reqMarketDataType(1)
  const c1 = new Option('QQQ', '20260223', 600, OptionType.Call, 'SMART', 'USD')
  console.log('Contract A:', JSON.stringify(c1))
  api.reqMktData(1001, c1, '', false, false)

  // Test with mktDataType=4
  setTimeout(() => {
    console.log('\n--- Test B: expiry=20260223, mktDataType=4, streaming ---')
    api.reqMarketDataType(4)
    const c2 = new Option('QQQ', '20260223', 600, OptionType.Call, 'SMART', 'USD')
    api.reqMktData(2001, c2, '', false, false)
  }, 3000)

  // Test with mktDataType=3
  setTimeout(() => {
    console.log('\n--- Test C: expiry=20260223, mktDataType=3, streaming ---')
    api.reqMarketDataType(3)
    const c3 = new Option('QQQ', '20260223', 600, OptionType.Call, 'SMART', 'USD')
    api.reqMktData(3001, c3, '', false, false)
  }, 6000)

  // Test with snapshot mode
  setTimeout(() => {
    console.log('\n--- Test D: expiry=20260223, mktDataType=1, snapshot ---')
    api.reqMarketDataType(1)
    const c4 = new Option('QQQ', '20260223', 600, OptionType.Call, 'SMART', 'USD')
    api.reqMktData(4001, c4, '', true, false)
  }, 9000)

  // Test with a valid monthly expiry for comparison
  setTimeout(() => {
    console.log('\n--- Test E: expiry=20260320 (monthly), mktDataType=1, streaming ---')
    api.reqMarketDataType(1)
    const c5 = new Option('QQQ', '20260320', 600, OptionType.Call, 'SMART', 'USD')
    api.reqMktData(5001, c5, '', false, false)
  }, 12000)

  // Also check: what does the option chain return for QQQ?
  setTimeout(() => {
    console.log('\n--- Test F: reqSecDefOptParams for QQQ ---')
    api.on(EventName.securityDefinitionOptionParameter, (reqId, exchange, underlyingConId, tradingClass, multiplier, expirations, strikes) => {
      console.log(`[SEC_DEF_OPT] reqId=${reqId}, exchange=${exchange}, tradingClass=${tradingClass}, multiplier=${multiplier}`)
      console.log(`  expirations (first 5): ${[...expirations].slice(0, 5).join(', ')}`)
      console.log(`  strikes around 600 (nearest 5): ${[...strikes].filter(s => Math.abs(s - 600) <= 30).sort((a,b) => a-b).join(', ')}`)
    })
    api.on(EventName.securityDefinitionOptionParameterEnd, (reqId) => {
      console.log(`[SEC_DEF_OPT_END] reqId=${reqId}`)
    })
    // Need QQQ conId - use 320227 (standard QQQ conId)
    api.reqSecDefOptParams(9001, 'QQQ', '', 'STK', 320227)
  }, 15000)

  // Exit
  setTimeout(() => {
    console.log('\n=== Done ===')
    try {
      api.cancelMktData(1001)
      api.cancelMktData(2001)
      api.cancelMktData(3001)
      api.cancelMktData(4001)
      api.cancelMktData(5001)
    } catch(e) {}
    setTimeout(() => {
      api.disconnect()
      process.exit(0)
    }, 1000)
  }, 22000)
})

api.connect()
setTimeout(() => { console.log('TIMEOUT'); process.exit(1) }, 30000)
