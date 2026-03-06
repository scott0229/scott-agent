const { IBApi, EventName, Contract, SecType, OptionType } = require('@stoqey/ib')

const api = new IBApi({ host: '127.0.0.1', port: 7498, clientId: Math.floor(Math.random() * 1000) })
console.log('Script started, connecting to IB...')

api.on(EventName.error, (err, code, reqId) => {
  console.log(`[API ERROR] code=${code} reqId=${reqId} msg=${err.message}`)
})
api.on(EventName.disconnected, () => {
  console.log('Disconnected from IB')
})

let resolved = 0

api.on(EventName.connected, () => {
  console.log('Connected to IB')
  api.reqMarketDataType(2) // Frozen

  // Contract 1: Without tradingClass (like quotes.ts)
  const c1 = {
    symbol: 'TQQQ',
    secType: SecType.OPT,
    exchange: 'SMART',
    currency: 'USD',
    lastTradeDateOrContractMonth: '20260313',
    strike: 50,
    right: OptionType.Put
  }

  // Contract 2: With tradingClass (like options.ts)
  const c2 = {
    symbol: 'TQQQ',
    secType: SecType.OPT,
    exchange: 'SMART',
    currency: 'USD',
    lastTradeDateOrContractMonth: '20260313',
    strike: 50,
    right: OptionType.Put,
    tradingClass: 'TQQQ'
  }

  api.on(EventName.tickPrice, (reqId, tickType, value) => {
    console.log(`[tickPrice] reqId ${reqId}, tickType ${tickType}, value ${value}`)
  })
  api.on(EventName.tickOptionComputation, (reqId, field, impliedVol, delta, optPrice, pvD, gamma, vega, theta) => {
    console.log(`[tickOption] reqId ${reqId}, field ${field}, IV ${impliedVol}, d ${delta}, p ${optPrice}`)
  })
  api.on(EventName.tickSnapshotEnd, (reqId) => {
    console.log(`[tickSnapshotEnd] reqId ${reqId}`)
    resolved++
    if (resolved >= 2) process.exit(0)
  })
  api.on(EventName.error, (err, code, id) => {
    console.error(`[error] reqId ${id}, code ${code}, msg ${err.message}`)
  })

  // Both use snapshot = true
  api.reqMktData(1, c1, '', true, false)
  api.reqMktData(2, c2, '', true, false)

  setTimeout(() => {
    console.log('Timeout reached!')
    process.exit(0)
  }, 5000)
})

api.connect()
