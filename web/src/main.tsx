import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { bootTelegram } from './telegram'
import './styles/base.css'

// Inside Telegram, its script has to read the launch params before the hash router touches the URL.
void bootTelegram().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
