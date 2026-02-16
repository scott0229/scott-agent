import { IBApi, EventName, ErrorCode } from '@stoqey/ib'
import { clearAliasCache } from './accounts'

export interface ConnectionConfig {
    host: string
    port: number
    clientId: number
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface ConnectionState {
    status: ConnectionStatus
    host: string
    port: number
    errorMessage?: string
}

let ibApi: IBApi | null = null
let connectionState: ConnectionState = {
    status: 'disconnected',
    host: '127.0.0.1',
    port: 7497
}
let statusListeners: ((state: ConnectionState) => void)[] = []

function notifyListeners(): void {
    statusListeners.forEach((listener) => listener({ ...connectionState }))
}

export function onConnectionStatusChange(listener: (state: ConnectionState) => void): void {
    statusListeners.push(listener)
}

export function removeAllListeners(): void {
    statusListeners = []
}

export function getConnectionState(): ConnectionState {
    return { ...connectionState }
}

export function getIBApi(): IBApi | null {
    return ibApi
}

export function connect(config: ConnectionConfig): void {
    // Disconnect existing connection if any
    if (ibApi) {
        try {
            ibApi.disconnect()
        } catch {
            // ignore
        }
        ibApi = null
    }

    connectionState = {
        status: 'connecting',
        host: config.host,
        port: config.port
    }
    notifyListeners()

    ibApi = new IBApi({
        host: config.host,
        port: config.port,
        clientId: config.clientId
    })

    ibApi.on(EventName.connected, () => {
        console.log('[IB] Connected to TWS/Gateway')
        connectionState = {
            status: 'connected',
            host: config.host,
            port: config.port
        }
        notifyListeners()
    })

    ibApi.on(EventName.disconnected, () => {
        console.log('[IB] Disconnected')
        connectionState = {
            ...connectionState,
            status: 'disconnected'
        }
        notifyListeners()
    })

    ibApi.on(EventName.error, (err: Error, code: ErrorCode, reqId: number) => {
        console.error(`[IB] Error: ${err.message} (code: ${code}, reqId: ${reqId})`)
        // Only update status for connection-level errors
        if (code === ErrorCode.CONNECT_FAIL || code === ErrorCode.NOT_CONNECTED) {
            connectionState = {
                ...connectionState,
                status: 'error',
                errorMessage: err.message
            }
            notifyListeners()
        }
    })

    try {
        ibApi.connect()
    } catch (err: any) {
        connectionState = {
            ...connectionState,
            status: 'error',
            errorMessage: err.message || 'Connection failed'
        }
        notifyListeners()
    }
}

export function disconnect(): void {
    console.log('[IB] Disconnect requested')
    clearAliasCache()
    if (ibApi) {
        try {
            ibApi.removeAllListeners()
            ibApi.disconnect()
            console.log('[IB] Disconnect called successfully')
        } catch (err) {
            console.error('[IB] Error during disconnect:', err)
        }
        ibApi = null
    }
    connectionState = {
        ...connectionState,
        status: 'disconnected',
        errorMessage: undefined
    }
    notifyListeners()
}
