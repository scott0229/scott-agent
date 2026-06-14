import { useEffect, useRef, useCallback } from 'react'
import {
  createChart,
  IChartApi,
  ISeriesApi,
  CandlestickSeries,
  LineSeries,
  Time
} from 'lightweight-charts'
import { useHistoricalData, BarData } from '../hooks/useHistoricalData'
import './QuantitativeChart.css'

// 指標分析 — 固定畫 QQQ 日線 K 線 + 布林通道 (Length 5, StdDev 2)。
const SYMBOL = 'QQQ'
const DURATION = '1 Y'
const BAR_SIZE = '1 day'
const BB_LENGTH = 10
const BB_STDDEV = 1.5
const BASIS_COLOR = '#f59e0b' // 中軌 (SMA) — 橘
const BAND_COLOR = '#888888' // 上/下軌 — 灰實線
const RSI_PERIOD = 5
const RSI_COLOR = '#7c3aed' // 紫

function parseTimeVal(bar: BarData): number {
  const t = bar.time
  const n = Number(t)
  if (!isNaN(n) && t.length > 5) return n
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return Math.floor(new Date(t + 'T00:00:00Z').getTime() / 1000)
  if (/^\d{8}$/.test(t)) {
    const iso = `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}T00:00:00Z`
    return Math.floor(new Date(iso).getTime() / 1000)
  }
  return Math.floor(new Date(t).getTime() / 1000)
}

// Bollinger Bands over close: middle = SMA(length); upper/lower = middle ±
// mult × population σ over the same window. Null until `length` bars exist.
function bollinger(
  bars: BarData[],
  length: number,
  mult: number
): { upper: (number | null)[]; middle: (number | null)[]; lower: (number | null)[] } {
  const upper: (number | null)[] = []
  const middle: (number | null)[] = []
  const lower: (number | null)[] = []
  for (let i = 0; i < bars.length; i++) {
    if (i < length - 1) {
      upper.push(null)
      middle.push(null)
      lower.push(null)
      continue
    }
    let sum = 0
    for (let j = i - length + 1; j <= i; j++) sum += bars[j].close
    const mean = sum / length
    let variance = 0
    for (let j = i - length + 1; j <= i; j++) {
      const d = bars[j].close - mean
      variance += d * d
    }
    const sd = Math.sqrt(variance / length)
    middle.push(mean)
    upper.push(mean + mult * sd)
    lower.push(mean - mult * sd)
  }
  return { upper, middle, lower }
}

// RSI (Wilder's smoothing) over close; null until `period` changes exist.
function rsi(bars: BarData[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(bars.length).fill(null)
  if (bars.length < period + 1) return out
  let gainSum = 0
  let lossSum = 0
  for (let i = 1; i <= period; i++) {
    const ch = bars[i].close - bars[i - 1].close
    if (ch >= 0) gainSum += ch
    else lossSum -= ch
  }
  let avgGain = gainSum / period
  let avgLoss = lossSum / period
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  for (let i = period + 1; i < bars.length; i++) {
    const ch = bars[i].close - bars[i - 1].close
    const gain = ch > 0 ? ch : 0
    const loss = ch < 0 ? -ch : 0
    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  }
  return out
}

export function IndicatorChart(): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const upperRef = useRef<ISeriesApi<'Line'> | null>(null)
  const middleRef = useRef<ISeriesApi<'Line'> | null>(null)
  const lowerRef = useRef<ISeriesApi<'Line'> | null>(null)
  const rsiRef = useRef<ISeriesApi<'Line'> | null>(null)
  // Symmetric top/bottom margin of the right price scale — wheeling over the
  // price axis grows/shrinks it, which compresses/expands the 股價 band
  // (lightweight-charts binds the wheel to the time axis and has no price-range
  // setter, so scaleMargins is the manual price-zoom lever).
  const priceMarginRef = useRef(0.1)

  // ── Chart init ───────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
      layout: { background: { color: '#ffffff' }, textColor: '#1a1a1a' },
      grid: { vertLines: { color: '#f0f0f0' }, horzLines: { color: '#f0f0f0' } },
      timeScale: { borderColor: '#e0e0e0', timeVisible: false }
    })
    chartRef.current = chart

    candleRef.current = chart.addSeries(CandlestickSeries, {
      upColor: '#26a69a',
      downColor: '#ef5350',
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
      borderVisible: false
    }) as ISeriesApi<'Candlestick'>

    // Upper / lower bands — grey solid, same colour.
    const bandOpts = {
      color: BAND_COLOR,
      lineWidth: 1 as const,
      lineStyle: 0 as const, // solid
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false
    }
    upperRef.current = chart.addSeries(LineSeries, bandOpts) as ISeriesApi<'Line'>
    lowerRef.current = chart.addSeries(LineSeries, bandOpts) as ISeriesApi<'Line'>

    // Middle band (SMA basis) — solid.
    middleRef.current = chart.addSeries(LineSeries, {
      color: BASIS_COLOR,
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false
    }) as ISeriesApi<'Line'>

    // RSI in a separate pane (index 1) below the price pane.
    rsiRef.current = chart.addSeries(
      LineSeries,
      {
        color: RSI_COLOR,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false
      },
      1
    ) as ISeriesApi<'Line'>
    // Hide the RSI scale's regular numeric ticks (80.00 / 40.00 / 20.00…) by
    // blending their text into the white background — the 80/20 price-line tags
    // keep their own coloured labels, so only those two remain on the axis.
    rsiRef.current.priceScale().applyOptions({ textColor: '#ffffff' })
    rsiRef.current.createPriceLine({
      price: 80,
      color: '#ef5350',
      lineWidth: 1,
      lineStyle: 2,
      axisLabelVisible: true,
      title: ''
    })
    rsiRef.current.createPriceLine({
      price: 20,
      color: '#26a69a',
      lineWidth: 1,
      lineStyle: 2,
      axisLabelVisible: true,
      title: ''
    })
    rsiRef.current.createPriceLine({
      price: 50,
      color: '#cccccc',
      lineWidth: 1,
      lineStyle: 3,
      axisLabelVisible: false
    })
    // Give the price pane more room, RSI a compact strip.
    const panes = chart.panes()
    if (panes[1]) panes[1].setHeight(120)

    chart.priceScale('right').applyOptions({
      scaleMargins: { top: priceMarginRef.current, bottom: priceMarginRef.current }
    })

    // Wheel over the right price-axis strip → zoom the price scale instead of
    // the time axis. Capture phase + stopPropagation so lightweight-charts'
    // own canvas handler never sees it; over the chart body we do nothing and
    // let the default time-zoom run.
    const onWheel = (e: WheelEvent): void => {
      const container = containerRef.current
      const ch = chartRef.current
      if (!container || !ch) return
      const axisW = ch.priceScale('right').width()
      const rect = container.getBoundingClientRect()
      if (e.clientX < rect.right - axisW) return // not over the price axis
      e.preventDefault()
      e.stopPropagation()
      const dir = e.deltaY > 0 ? 1 : -1 // scroll down = compress, up = expand
      const next = Math.max(0, Math.min(0.45, priceMarginRef.current + dir * 0.04))
      priceMarginRef.current = next
      ch.priceScale('right').applyOptions({ scaleMargins: { top: next, bottom: next } })
    }
    containerRef.current.addEventListener('wheel', onWheel, { passive: false, capture: true })
    const wheelTarget = containerRef.current

    const handleResize = (): void => {
      if (containerRef.current && chart) {
        chart.applyOptions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight
        })
      }
    }
    const ro = new ResizeObserver(handleResize)
    ro.observe(containerRef.current)

    return () => {
      ro.disconnect()
      wheelTarget.removeEventListener('wheel', onWheel, { capture: true } as EventListenerOptions)
      chart.remove()
      chartRef.current = null
      candleRef.current = null
      upperRef.current = null
      middleRef.current = null
      lowerRef.current = null
      rsiRef.current = null
    }
  }, [])

  const store = useHistoricalData()

  // ── Fetch QQQ on mount ───────────────────────────────
  useEffect(() => {
    store.fetchData(SYMBOL, DURATION, BAR_SIZE)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Draw candles + Bollinger Bands ───────────────────
  useEffect(() => {
    if (
      store.data.length === 0 ||
      !candleRef.current ||
      !upperRef.current ||
      !middleRef.current ||
      !lowerRef.current ||
      !rsiRef.current
    )
      return

    // Dedupe by time + sort ascending (lightweight-charts requires this).
    const seen = new Set<number>()
    const sorted = store.data
      .map((b) => ({ b, t: parseTimeVal(b) }))
      .filter(({ t }) => {
        if (seen.has(t)) return false
        seen.add(t)
        return true
      })
      .sort((a, b) => a.t - b.t)
    const bars = sorted.map((s) => s.b)
    const times = sorted.map((s) => s.t)

    candleRef.current.setData(
      bars.map((b, i) => ({
        time: times[i] as Time,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close
      }))
    )

    const { upper, middle, lower } = bollinger(bars, BB_LENGTH, BB_STDDEV)
    const lineData = (vals: (number | null)[]): { time: Time; value: number }[] =>
      bars
        .map((_, i) => (vals[i] != null ? { time: times[i] as Time, value: vals[i] as number } : null))
        .filter((d): d is { time: Time; value: number } => d !== null)

    upperRef.current.setData(lineData(upper))
    middleRef.current.setData(lineData(middle))
    lowerRef.current.setData(lineData(lower))

    rsiRef.current.setData(lineData(rsi(bars, RSI_PERIOD)))

    chartRef.current?.timeScale().fitContent()
  }, [store.data])

  const handleReload = useCallback((): void => {
    store.fetchData(SYMBOL, DURATION, BAR_SIZE)
  }, [store])

  return (
    <div className="quantitative-chart-wrapper" style={{ height: 'calc(100vh - 140px)', minHeight: 480 }}>
      <div className="chart-toolbar">
        <span className="chart-label" style={{ fontWeight: 600 }}>
          QQQ 日線
        </span>
        <span className="chart-label">
          布林通道 (
          <b style={{ color: BASIS_COLOR }}>{BB_LENGTH}</b>,{' '}
          <b style={{ color: BAND_COLOR }}>{BB_STDDEV}σ</b>)
        </span>
        <span className="chart-label">
          <b style={{ color: RSI_COLOR }}>RSI {RSI_PERIOD}</b>
        </span>
        <button className="chart-reload-btn" onClick={handleReload} disabled={store.loading}>
          {store.loading ? '載入中…' : '重新載入'}
        </button>
        {store.error && <span className="chart-error">{store.error}</span>}
      </div>

      <div ref={containerRef} className="quantitative-chart-container" />
    </div>
  )
}
