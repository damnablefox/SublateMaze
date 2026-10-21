import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { applyTheme, loadThemeMode } from './theme/theme'
import './theme/fonts.css'
import './theme/tokens.css'
import './theme/base.css'
import './styles.css'

applyTheme(loadThemeMode())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
