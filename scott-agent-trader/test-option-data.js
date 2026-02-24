/**
 * Standalone test: Can we get option data from IB API?
 * Run with: node test-option-data.js
 */
const { IBApi, EventName, SecType, OptionType } = require('@stoqey/ib')

const HOST = '127.0.0.1'
const PORT = 7497
const CLIENT_ID = 99 // Use a different clientId to avoid conflicts with main app

const api = new IBApi({ host: HOST, port: PORT, clientId: CLIENT_ID })

// Test contract: QQQ call option, near ATM
const SYMBOL = 'QQQ'
const EXPIRY = '20260220' // This Friday's expiry
const STRIKE = 600
const RIGHT = OptionType.Call

console.log('=== IB Option Data Test ===')
console.log(`Symbol: ${SYMBOL}, Expiry: ${EXPIRY}, Strike: ${STRIKE}, Right: Call`)
console.log()

let connected = false

// Listen to ALL events for debugging
api.on(EventName.connected, () => {
  console.log('[CONNECTED] Successfully connected to TWS')
  connected = true
  startTest()
})

api.on(EventName.disconnected, () => {
  console.log('[DISCONNECTED]')
})

api.on(EventName.error, (err, code, reqId) => {
  console.log(`[ERROR] code=${code}, reqId=${reqId}, msg=${err.message}`)
})

api.on(EventName.tickPrice, (reqId, tickType, value, attribs) => {
  console.log(`[TICK_PRICE] reqId=${reqId}, tickType=${tickType}, value=${value}`)
})

api.on(EventName.tickSize, (reqId, tickType, value) => {
  console.log(`[TICK_SIZE] reqId=${reqId}, tickType=${tickType}, value=${value}`)
})

api.on(
  EventName.tickOptionComputation,
  (
    reqId,
    field,
    tickAttrib,
    impliedVol,
    delta,
    optPrice,
    pvDividend,
    gamma,
    vega,
    theta,
    undPrice
  ) => {
    console.log(
      `[TICK_OPTION] reqId=${reqId}, field=${field}, IV=${impliedVol}, delta=${delta}, gamma=${gamma}, vega=${vega}, theta=${theta}, undPrice=${undPrice}`
    )
  }
)

api.on(EventName.tickSnapshotEnd, (reqId) => {
  console.log(`[SNAPSHOT_END] reqId=${reqId}`)
})

api.on(EventName.tickGeneric, (reqId, tickType, value) => {
  console.log(`[TICK_GENERIC] reqId=${reqId}, tickType=${tickType}, value=${value}`)
})

api.on(EventName.tickString, (reqId, tickType, value) => {
  console.log(`[TICK_STRING] reqId=${reqId}, tickType=${tickType}, value=${value}`)
})

api.on(EventName.marketDataType, (reqId, marketDataType) => {
  console.log(`[MARKET_DATA_TYPE] reqId=${reqId}, type=${marketDataType}`)
})

function startTest() {
  console.log()
  console.log('--- Test 1: Stock quote (should work) ---')
  const stockContract = {
    symbol: SYMBOL,
    secType: SecType.STK,
    exchange: 'SMART',
    currency: 'USD'
  }

  // First test stock to confirm connection works
  api.reqMarketDataType(4) // delayed-frozen, same as quotes.ts
  api.reqMktData(1001, stockContract, '', true, false)

  // After 3 seconds, test option
  setTimeout(() => {
    console.log()
    console.log('--- Test 2: Option snapshot with marketDataType=1 (live) ---')
    api.reqMarketDataType(1)
    const optContract2 = {
      symbol: SYMBOL,
      secType: SecType.OPT,
      exchange: 'SMART',
      currency: 'USD',
      lastTradeDateOrContractMonth: EXPIRY,
      strike: STRIKE,
      right: RIGHT,
      multiplier: 100
    }
    console.log('Contract:', JSON.stringify(optContract2))
    api.reqMktData(2001, optContract2, '', true, false)
  }, 3000)

  // After 6 seconds, test with streaming mode
  setTimeout(() => {
    console.log()
    console.log('--- Test 3: Option streaming with marketDataType=1 (live) ---')
    api.reqMarketDataType(1)
    const optContract3 = {
      symbol: SYMBOL,
      secType: SecType.OPT,
      exchange: 'SMART',
      currency: 'USD',
      lastTradeDateOrContractMonth: EXPIRY,
      strike: STRIKE,
      right: RIGHT,
      multiplier: 100
    }
    api.reqMktData(3001, optContract3, '', false, false)
  }, 6000)

  // After 9 seconds, test with marketDataType=4
  setTimeout(() => {
    console.log()
    console.log('--- Test 4: Option streaming with marketDataType=4 (delayed-frozen) ---')
    api.reqMarketDataType(4)
    const optContract4 = {
      symbol: SYMBOL,
      secType: SecType.OPT,
      exchange: 'SMART',
      currency: 'USD',
      lastTradeDateOrContractMonth: EXPIRY,
      strike: STRIKE,
      right: RIGHT,
      multiplier: 100
    }
    api.reqMktData(4001, optContract4, '', false, false)
  }, 9000)

  // After 12s, test using Option class from @stoqey/ib
  setTimeout(() => {
    console.log()
    console.log('--- Test 5: Option class + streaming + marketDataType=1 ---')
    const { Option } = require('@stoqey/ib')
    api.reqMarketDataType(1)
    const optContract5 = new Option(SYMBOL, EXPIRY, STRIKE, RIGHT, 'SMART', 'USD')
    console.log('Option class contract:', JSON.stringify(optContract5))
    api.reqMktData(5001, optContract5, '', false, false)
  }, 12000)

  // After 15s, test with a different expiry (monthly)
  setTimeout(() => {
    console.log()
    console.log('--- Test 6: Monthly expiry option + streaming + marketDataType=1 ---')
    api.reqMarketDataType(1)
    const optContract6 = {
      symbol: SYMBOL,
      secType: SecType.OPT,
      exchange: 'SMART',
      currency: 'USD',
      lastTradeDateOrContractMonth: '20260320', // March monthly
      strike: STRIKE,
      right: RIGHT,
      multiplier: 100
    }
    console.log('Contract:', JSON.stringify(optContract6))
    api.reqMktData(6001, optContract6, '', false, false)
  }, 15000)

  // Cleanup and exit after 20 seconds
  setTimeout(() => {
    console.log()
    console.log('=== Test Complete ===')
    console.log('Cancelling all market data and disconnecting...')
    try {
      api.cancelMktData(1001)
      api.cancelMktData(2001)
      api.cancelMktData(3001)
      api.cancelMktData(4001)
      api.cancelMktData(5001)
      api.cancelMktData(6001)
    } catch (e) {}
    setTimeout(() => {
      api.disconnect()
      process.exit(0)
    }, 1000)
  }, 20000)
}

// Connect
console.log(`Connecting to ${HOST}:${PORT} with clientId=${CLIENT_ID}...`)
api.connect()

// Safety timeout
setTimeout(() => {
  if (!connected) {
    console.log('TIMEOUT: Could not connect to TWS in 10 seconds')
    process.exit(1)
  }
}, 10000)
