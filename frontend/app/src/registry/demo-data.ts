export function isDemoDataEnabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'never-enabled'
}

export const demoDataEnabled = false
