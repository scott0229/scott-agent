/**
 * Test frozen data (type 2) vs live (type 1) for option bid/ask
 */
const { IBApi, EventName, OptionType, Option } = require('@stoqey/ib')
const api = new IBApi({ host: '127.0.0.1', port: 7497, clientId: 96 })

api.on(EventName.connected, () => {
  console.log('[CONNECTED]')
  api.on(EventName.error, (err, code, reqId) => {
    console.log(`[ERROR] reqId=${reqId}, code=${code}, msg=${err.message}`)
  })
  api.on(EventName.tickPrice, (reqId, tickType, value) => {
    const label = {1:'BID',2:'ASK',4:'LAST',6:'HIGH',7:'LOW',9:'CLOSE',14:'OPEN',
                   66:'DELAYED_BID',67:'DELAYED_ASK',68:'DELAYED_BID',69:'DELAYED_ASK',
                   70:'DELAYED_LAST',75:'DELAYED_CLOSE'}[tickType] || `TYPE_${tickType}`
    console.log(`[TICK] reqId=${reqId}, ${label}(${tickType})=${value}`)
  })
  api.on(EventName.tickSize, (reqId, tickType, value) => {
    const label = {0:'BID_SIZE',3:'ASK_SIZE',5:'LAST_SIZE',8:'VOLUME',
                   74:'DELAYED_BID_SIZE',75:'DELAYED_ASK_SIZE'}[tickType] || `SIZE_${tickType}`
    if (value > 0) console.log(`[SIZE] reqId=${reqId}, ${label}(${tickType})=${value}`)
  })
  api.on(EventName.marketDataType, (reqId, type) => {
    const label = {1:'LIVE',2:'FROZEN',3:'DELAYED',4:'DELAYED_FROZEN'}[type] || `TYPE_${type}`
    console.log(`[MKT_DATA_TYPE] reqId=${reqId}, ${label}(${type})`)
  })

  const contract = new Option('QQQ', '20260220', 600, OptionType.Call, 'SMART', 'USD')

  // Test 1: reqMarketDataType(2) = FROZEN
  console.log('\n--- Test 1: FROZEN (type 2) ---')
  api.reqMarketDataType(2)
  api.reqMktData(1001, contract, '', false, false)

  // Test 2: reqMarketDataType(4) = DELAYED_FROZEN
  setTimeout(() => {
    console.log('\n--- Test 2: DELAYED_FROZEN (type 4) ---')
    api.reqMarketDataType(4)
    api.reqMktData(2001, contract, '', false, false)
  }, 3000)

  // Test 3: reqMarketDataType(1) = LIVE
  setTimeout(() => {
    console.log('\n--- Test 3: LIVE (type 1) ---')
    api.reqMarketDataType(1)
    api.reqMktData(3001, contract, '', false, false)
  }, 6000)

  // Test 4: FROZEN snapshot
  setTimeout(() => {
    console.log('\n--- Test 4: FROZEN (type 2) + snapshot ---')
    api.reqMarketDataType(2)
    api.reqMktData(4001, contract, '', true, false)
  }, 9000)

  setTimeout(() => {
    console.log('\n=== Done ===')
    try { [1001,2001,3001,4001].forEach(id => api.cancelMktData(id)) } catch(e) {}
    setTimeout(() => { api.disconnect(); process.exit(0) }, 1000)
  }, 14000)
})

api.connect()
setTimeout(() => { console.log('TIMEOUT'); process.exit(1) }, 20000)
