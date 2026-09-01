import { useContext } from 'react'
import { RegistryContext } from '@/registry/registry-context'

export function useRegistry() {
  const context = useContext(RegistryContext)
  if (!context)
    throw new Error('useRegistry must be used inside RegistryProvider')
  return context
}
