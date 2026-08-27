import { registerMipsLanguage } from './core/mipsLanguage'

// Register MIPS language on app load
registerMipsLanguage()

import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
