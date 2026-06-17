import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

// Funnel uncaught renderer errors into the unified debug.log so hard-to-repro
// crashes are captured even when no one has devtools open.
window.addEventListener('error', (e) => {
  window.ibApi?.debugLog?.(`window.error: ${e.message} @ ${e.filename}:${e.lineno}:${e.colno}`)
})
window.addEventListener('unhandledrejection', (e) => {
  const r = e.reason
  window.ibApi?.debugLog?.(`unhandledrejection: ${r instanceof Error ? r.stack : String(r)}`)
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
