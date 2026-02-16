import { useState, useEffect, useCallback } from 'react'

interface ConnectionState {
    status: 'disconnected' | 'connecting' | 'connected' | 'error'
    host: string
    port: number
    errorMessage?: string
}

interface ConnectionStatusProps {
    onRefresh?: () => void
}

export default function ConnectionStatus({ onRefresh }: ConnectionStatusProps): JSX.Element {
    const [state, setState] = useState<ConnectionState>({
        status: 'disconnected',
        host: '127.0.0.1',
        port: 7497
    })
    const [host, setHost] = useState('127.0.0.1')
    const [port, setPort] = useState('7497')

    useEffect(() => {
        // Listen for connection status updates from main process
        window.ibApi.onConnectionStatus((newState: ConnectionState) => {
            setState(newState)
        })

        // Get initial state
        window.ibApi.getConnectionState().then(setState)

        return () => {
            window.ibApi.removeAllListeners()
        }
    }, [])

    const handleConnect = useCallback(async () => {
        const portNum = parseInt(port, 10)
        if (isNaN(portNum)) return
        await window.ibApi.connect(host, portNum)
    }, [host, port])

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
        error: '連線錯誤'
    }

    return (
        <div className="connection-status">
            <div className="connection-indicator">
                <div
                    className="status-dot"
                    style={{ backgroundColor: statusColors[state.status] }}
                />
                <span className="status-text">{statusLabels[state.status]}</span>

                {state.status === 'error' && state.errorMessage && (
                    <span className="error-message">{state.errorMessage}</span>
                )}
            </div>

            <div className="connection-controls">
                {state.status !== 'connected' && state.status !== 'connecting' && (
                    <>
                        <input
                            type="text"
                            value={port}
                            onChange={(e) => setPort(e.target.value)}
                            placeholder="Port"
                            className="input-field input-port"
                        />
                        <button onClick={handleConnect} className="btn btn-connect">
                            連線
                        </button>
                    </>
                )}
                {state.status === 'connected' && (
                    <>
                        <button onClick={handleDisconnect} className="btn btn-disconnect">
                            斷線
                        </button>
                        {onRefresh && (
                            <button onClick={onRefresh} className="btn">
                                重整
                            </button>
                        )}
                    </>
                )}
            </div>
        </div>
    )
}
