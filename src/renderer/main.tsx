import React from 'react'
import { createRoot } from 'react-dom/client'
import './styles/global.css'
// Configure Monaco to load LOCALLY (bundled worker, no CDN) before any editor
// mounts — the app runs offline and notarized.
import './lib/monaco'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
