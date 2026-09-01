import { StrictMode } from 'react'
import ReactDOM from 'react-dom/client'
import { RegistryApp } from '@/registry/app'
import '@/styles/index.css'

const rootElement = document.getElementById('root')

if (!rootElement) throw new Error('Root element is missing')

ReactDOM.createRoot(rootElement).render(
  <StrictMode>
    <RegistryApp />
  </StrictMode>
)
