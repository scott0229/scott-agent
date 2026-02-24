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

// eslint-disable-next-line @typescript-eslint/no-empty-interface
interface ConnectionStatusProps { }

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

  // Auto-connect on mount with saved port
  useEffect(() => {
    const savedPort = getSavedPort()
    const portNum = parseInt(savedPort, 10)
    if (isNaN(portNum)) return

    // Delay to let the main process initialize
    const timer = setTimeout(() => {
      window.ibApi.connect('127.0.0.1', portNum)
    }, 800)
    return () => clearTimeout(timer)
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
          {state.status === 'connected' ? `${state.port} 已連線` : statusLabels[state.status]}
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
