import { useEffect, useRef, useState, useCallback } from 'react'
import {
  createChart,
  IChartApi,
  ISeriesApi,
  CandlestickSeries,
  LineSeries,
  createSeriesMarkers,
  SeriesMarker,
  Time
} from 'lightweight-charts'
import { useHistoricalData, BarData } from '../hooks/useHistoricalData'
import { runStrategy, IndicatorResult, StrategyStats } from '../indicators/etfLetfRebase'
import './QuantitativeChart.css'
import ChartSelect from './ChartSelect'

const ETF = 'QQQ'
const LETF = 'QLD'
const DURATION = '20 Y'
const BAR_SIZE = '1 month'

function parseTimeVal(bar: BarData): number {
  const t = bar.time
  const n = Number(t)
  if (!isNaN(n) && t.length > 5) return n // already unix seconds
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return Math.floor(new Date(t + 'T00:00:00Z').getTime() / 1000)
  if (/^\d{8}$/.test(t)) {
    const iso = `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}T00:00:00Z`
    return Math.floor(new Date(iso).getTime() / 1000)
  }
  return Math.floor(new Date(t).getTime() / 1000)
}

function formatDate(ms: number): string {
  if (!ms) return '-'
  return new Date(ms).toISOString().slice(0, 10)
}

function fmt(n: number, decimals = 1): string {
  return n.toFixed(decimals)
}

function fmtMoney(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  return `$${Math.round(n).toLocaleString()}`
}

export function QuantitativeChart(): React.JSX.Element {
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const bbUpRef = useRef<ISeriesApi<'Line'> | null>(null)
  const bbLowRef = useRef<ISeriesApi<'Line'> | null>(null)
  const emaRef = useRef<ISeriesApi<'Line'> | null>(null)

  const [symbol, setSymbol] = useState<'QQQ' | 'QLD'>('QQQ')
  const [result, setResult] = useState<IndicatorResult | null>(null)
  const [stats, setStats] = useState<StrategyStats | null>(null)

  const etfStore = useHistoricalData()
  const letfStore = useHistoricalData()

  // ── Chart init ───────────────────────────────────────
  useEffect(() => {
    if (!chartContainerRef.current) return

    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: chartContainerRef.current.clientHeight,
      layout: { background: { color: '#ffffff' }, textColor: '#1a1a1a' },
      grid: { vertLines: { color: '#f0f0f0' }, horzLines: { color: '#f0f0f0' } },
      timeScale: { borderColor: '#e0e0e0', timeVisible: true }
    })
    chartRef.current = chart

    // Candlestick series
    candleRef.current = chart.addSeries(CandlestickSeries, {
      upColor: '#26a69a',
      downColor: '#ef5350',
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
      borderVisible: false
    }) as ISeriesApi<'Candlestick'>

    // BB upper
    bbUpRef.current = chart.addSeries(LineSeries, {
      color: 'rgba(150,150,150,0.6)',
      lineWidth: 1,
      lineStyle: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false
    }) as ISeriesApi<'Line'>

    // BB lower
    bbLowRef.current = chart.addSeries(LineSeries, {
      color: 'rgba(150,150,150,0.6)',
      lineWidth: 1,
      lineStyle: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false
    }) as ISeriesApi<'Line'>

    // EMA
    emaRef.current = chart.addSeries(LineSeries, {
      color: 'rgba(37,99,235,0.8)',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false
    }) as ISeriesApi<'Line'>

    const handleResize = (): void => {
      if (chartContainerRef.current && chart) {
        chart.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight
        })
      }
    }
    const ro = new ResizeObserver(handleResize)
    ro.observe(chartContainerRef.current)

    return () => {
      ro.disconnect()
      chart.remove()
      chartRef.current = null
      candleRef.current = null
      bbUpRef.current = null
      bbLowRef.current = null
      emaRef.current = null
    }
  }, [])

  // ── Fetch both QQQ and QLD on mount ─────────────────
  useEffect(() => {
    etfStore.fetchData(ETF, DURATION, BAR_SIZE)
    letfStore.fetchData(LETF, DURATION, BAR_SIZE)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Run strategy when both datasets arrive ───────────
  useEffect(() => {
    if (etfStore.data.length === 0 || letfStore.data.length === 0) return
    const r = runStrategy(etfStore.data, letfStore.data)
    setResult(r)
    setStats(r.stats)
  }, [etfStore.data, letfStore.data])

  // ── Update chart when result or symbol changes ───────
  useEffect(() => {
    if (!result || !candleRef.current || !bbUpRef.current || !bbLowRef.current || !emaRef.current)
      return

    const isQQQ = symbol === 'QQQ'
    const sourceBars = isQQQ ? etfStore.data : letfStore.data
    const bbUpper = isQQQ ? result.etfBBUpper : result.letfBBUpper
    const bbLower = isQQQ ? result.etfBBLower : result.letfBBLower
    const ema = isQQQ ? result.etfEMA : result.letfEMA

    // Prepare candlestick data
    const seen = new Set<number>()
    const candleData = sourceBars
      .map((b) => {
        const t = parseTimeVal(b)
        return { time: t as Time, open: b.open, high: b.high, low: b.low, close: b.close }
      })
      .filter((d) => {
        if (seen.has(d.time as number)) return false
        seen.add(d.time as number)
        return true
      })
      .sort((a, b) => (a.time as number) - (b.time as number))

    candleRef.current.setData(candleData)

    // BB + EMA series aligned to same bars
    const bbUpData = sourceBars
      .map((b, i) => ({ time: parseTimeVal(b) as Time, value: bbUpper[i] }))
      .filter((d) => d.value !== null && !isNaN(d.value as number)) as {
      time: Time
      value: number
    }[]
    const bbLowData = sourceBars
      .map((b, i) => ({ time: parseTimeVal(b) as Time, value: bbLower[i] }))
      .filter((d) => d.value !== null && !isNaN(d.value as number)) as {
      time: Time
      value: number
    }[]
    const emaData = sourceBars
      .map((b, i) => ({ time: parseTimeVal(b) as Time, value: ema[i] }))
      .filter((d) => d.value !== null && !isNaN(d.value as number)) as {
      time: Time
      value: number
    }[]

    bbUpRef.current.setData(bbUpData)
    bbLowRef.current.setData(bbLowData)
    emaRef.current.setData(emaData)

    // Buy/sell markers — only show on ETF price axis
    if (isQQQ && result.signals.length > 0) {
      const markers: SeriesMarker<Time>[] = result.signals
        .map((s) => ({
          time: s.time as Time,
          position: s.type === 'buy' ? ('belowBar' as const) : ('aboveBar' as const),
          color: s.type === 'buy' ? '#ff9900' : '#2196f3',
          shape: s.type === 'buy' ? ('arrowUp' as const) : ('arrowDown' as const),
          text: s.type === 'buy' ? '買' : '賣'
        }))
        .sort((a, b) => (a.time as number) - (b.time as number))
      createSeriesMarkers(candleRef.current, markers)
    } else {
      createSeriesMarkers(candleRef.current, [])
    }

    chartRef.current?.timeScale().fitContent()
  }, [result, symbol, etfStore.data, letfStore.data])

  const loading = etfStore.loading || letfStore.loading
  const error = etfStore.error || letfStore.error

  const handleReload = useCallback((): void => {
    etfStore.fetchData(ETF, DURATION, BAR_SIZE)
    letfStore.fetchData(LETF, DURATION, BAR_SIZE)
  }, [etfStore, letfStore])

  return (
    <div className="quantitative-chart-wrapper">
      <div className="chart-toolbar">
        <ChartSelect
          value={symbol}
          onChange={(v) => setSymbol(v as 'QQQ' | 'QLD')}
          options={[
            { value: 'QQQ', label: 'QQQ' },
            { value: 'QLD', label: 'QLD' }
          ]}
        />
        <span className="chart-label">20年 / 月線</span>
        <button className="chart-reload-btn" onClick={handleReload} disabled={loading}>
          {loading ? '載入中…' : '重新載入'}
        </button>
        {error && <span className="chart-error">{error}</span>}
      </div>

      <div ref={chartContainerRef} className="quantitative-chart-container" />

      {stats && (
        <div className="chart-stats-panel">
          <div className="stats-row stats-header">
            <span>📊 策略績效比較 ({formatDate(stats.myMaxDDTime ? Date.now() : 0)})</span>
          </div>
          <div className="stats-grid">
            <div className="stats-cell header" />
            <div className="stats-cell header">調倉策略</div>
            <div className="stats-cell header">ETF 長持</div>
            <div className="stats-cell header">LETF 長持</div>

            <div className="stats-cell label">最終資金</div>
            <div className="stats-cell value highlight">{fmtMoney(stats.myCap)}</div>
            <div className="stats-cell value">{fmtMoney(stats.bhEtfCap)}</div>
            <div className="stats-cell value">{fmtMoney(stats.bhLetfCap)}</div>

            <div className="stats-cell label">年化報酬</div>
            <div className="stats-cell value highlight">{fmt(stats.myCagr)}%</div>
            <div className="stats-cell value">{fmt(stats.bhEtfCagr)}%</div>
            <div className="stats-cell value">{fmt(stats.bhLetfCagr)}%</div>

            <div className="stats-cell label">最大回撤</div>
            <div className="stats-cell value highlight">{fmt(stats.myMaxDDPct)}%</div>
            <div className="stats-cell value">{fmt(stats.bhEtfMaxDDPct)}%</div>
            <div className="stats-cell value">{fmt(stats.bhLetfMaxDDPct)}%</div>
          </div>

          <div className="stats-divider" />

          <div className="stats-meta-grid">
            <div className="stats-meta-item">
              <span className="meta-label">轉換次數</span>
              <span className="meta-value">
                {stats.rebaseEntryCnt}買 / {stats.rebaseExitCnt}賣
              </span>
            </div>
            <div className="stats-meta-item">
              <span className="meta-label">持 LETF 時間</span>
              <span className="meta-value">{fmt(stats.totalBarsLETFPct, 0)}%</span>
            </div>
            <div className="stats-meta-item">
              <span className="meta-label">平均轉換間隔</span>
              <span className="meta-value">{fmt(stats.daysPerRebase, 0)} 天</span>
            </div>
            <div className="stats-meta-item">
              <span className="meta-label">建議訊號</span>
              <span className="meta-value">
                🟠{stats.sigAddExpoCnt} 買 / 🔵{stats.sigRedExpoCnt} 賣
              </span>
            </div>
            <div className="stats-meta-item">
              <span className="meta-label">當前倉位</span>
              <span className={`meta-value ${stats.isHoldingLETF ? 'letf-mode' : 'etf-mode'}`}>
                {stats.isHoldingLETF
                  ? `🟠 LETF ${fmt(stats.letfPos, 1)} 股`
                  : `🔵 ETF ${fmt(stats.etfPos, 1)} 股`}
                {stats.letfCashReserve > 0
                  ? ` + $${Math.round(stats.letfCashReserve).toLocaleString()} 現金`
                  : ''}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
