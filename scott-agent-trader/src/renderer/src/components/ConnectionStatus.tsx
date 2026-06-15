import React from 'react'
import { useState, useEffect, useCallback } from 'react'

interface ConnectionState {
  status: 'disconnected' | 'connecting' | 'connected' | 'error'
  host: string
  port: number
  errorMessage?: string
}

const STORAGE_KEY = 'ib-last-port'

function getSavedPort(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) || '7497'
  } catch {
    return '7497'
  }
}

function savePort(port: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, port)
  } catch {
    /* ignore */
  }
}

interface ConnectionStatusProps {}

export default function ConnectionStatus(_props: ConnectionStatusProps): React.JSX.Element {
  const [state, setState] = useState<ConnectionState>({
    status: 'disconnected',
    host: '127.0.0.1',
    port: 7497
  })
  const [port, setPort] = useState(getSavedPort)

  useEffect(() => {
    // Listen for connection status updates from main process
    const unsubscribe = window.ibApi.onConnectionStatus((newState: ConnectionState) => {
      setState(newState)
      // Save port on successful connection
      if (newState.status === 'connected') {
        savePort(String(newState.port))
      }
    })

    // Get initial state
    window.ibApi.getConnectionState().then(setState)

    return () => {
      unsubscribe()
    }
  }, [])

  // Auto-connect: keep cycling through the common IB ports until one connects.
  // Unlike a one-shot probe, this never gives up — so once IB Gateway finishes
  // launching and the user logs in (which can take a while), the next cycle
  // picks up the now-open port automatically. Idles once connected, and resumes
  // probing if the connection later drops.
  useEffect(() => {
    const PROBE_PORTS = [4001, 7496, 7497, 7498]
    const saved = parseInt(getSavedPort(), 10)
    const candidates = [
      ...new Set([...(Number.isFinite(saved) ? [saved] : []), ...PROBE_PORTS])
    ]
    let cancelled = false
    const sleep = (ms: number): Promise<void> =>
      new Promise((r) => setTimeout(r, ms))
    const isConnected = async (): Promise<boolean> =>
      (await window.ibApi.getConnectionState()).status === 'connected'

    const loop = async (): Promise<void> => {
      await sleep(800) // let the window settle before the first attempt
      while (!cancelled) {
        if (await isConnected()) {
          await sleep(2500) // already good — idle, but keep watching for drops
          continue
        }
        for (const port of candidates) {
          if (cancelled) return
          if (await isConnected()) break
          window.ibApi.connect('127.0.0.1', port)
          await sleep(1500) // give this port time to handshake before the next
        }
        if (!cancelled && !(await isConnected())) await sleep(1500) // pause between cycles
      }
    }
    void loop()
    return () => {
      cancelled = true
    }
  }, [])

  const handleConnect = useCallback(async () => {
    const portNum = parseInt(port, 10)
    if (isNaN(portNum)) return
    savePort(port)
    await window.ibApi.connect('127.0.0.1', portNum)
  }, [port])

  const handleDisconnect = useCallback(async () => {
    await window.ibApi.disconnect()
  }, [])

  const handleLaunchGateway = useCallback(async () => {
    try {
      await window.ibApi.launchGateway()
    } catch (err) {
      console.warn('launchGateway failed:', err)
    }
  }, [])

  const statusColors: Record<string, string> = {
    disconnected: '#6b7280',
    connecting: '#f59e0b',
    connected: '#10b981',
    error: '#ef4444'
  }

  const statusLabels: Record<string, string> = {
    disconnected: '未連線',
    connecting: '連線中...',
    connected: '已連線',
    error: '連線失敗'
  }

  return (
    <div className="connection-status">
      <div className="connection-indicator">
        <div className="status-dot" style={{ backgroundColor: statusColors[state.status] }} />
        <span className="status-text">
          {state.status === 'connected' ? `${state.port}` : statusLabels[state.status]}
        </span>
      </div>

      <div className="connection-controls">
        {state.status !== 'connected' && state.status !== 'connecting' && (
          <>
            <input
              type="text"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleConnect()
              }}
              placeholder="Port"
              className="input-field input-port"
            />
            <button onClick={handleConnect} className="btn btn-connect">
              連線
            </button>
            <button onClick={handleLaunchGateway} className="btn btn-connect" title="開啟 IB Gateway 登入視窗">
              啟動 Gateway
            </button>
          </>
        )}
        {state.status === 'connected' && (
          <button onClick={handleDisconnect} className="btn btn-disconnect">
            斷線
          </button>
        )}
      </div>
    </div>
  )
}
