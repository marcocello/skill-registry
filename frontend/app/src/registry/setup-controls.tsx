import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible'
import { Label } from '@/components/ui/label'
import { RadioGroupItem } from '@/components/ui/radio-group'

export function SetupMode({
  id,
  value = id,
  title,
  description,
  selected,
  accessibleLabel,
  icon,
  kind = 'access',
}: {
  id: string
  value?: string
  title: string
  description: string
  selected: boolean
  accessibleLabel?: string
  icon?: ReactNode
  kind?: 'access' | 'provider'
}) {
  return (
    <Label
      htmlFor={id}
      className={cn(
        'cursor-pointer rounded-xl border p-4 transition-[color,background-color,border-color,box-shadow,transform] duration-[180ms] ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-[0.99]',
        kind === 'provider'
          ? 'flex min-h-[112px] flex-col items-start gap-2.5'
          : 'flex min-h-[96px] items-start gap-3 p-3.5',
        selected
          ? 'border-[#18181b] bg-[#fafafa] shadow-[0_0_0_1px_#18181b]'
          : 'border-[#e4e4e7] bg-white hover:border-[#a1a1aa] hover:bg-[#fafafa]'
      )}
    >
      <RadioGroupItem
        id={id}
        value={value}
        aria-label={accessibleLabel}
        className={cn(kind === 'provider' ? 'sr-only' : 'mt-0.5')}
      />
      <span className={cn('min-w-0', kind === 'provider' && 'contents')}>
        {icon && kind === 'provider' ? (
          <span className='flex h-6 items-center text-[#18181b] [&_svg]:size-6'>
            {icon}
          </span>
        ) : null}
        <span className='flex items-center gap-2 text-sm font-semibold'>
          {icon && kind === 'access' ? icon : null}
          {title}
        </span>
        <span className='block text-xs leading-[1.5] font-normal text-muted-foreground'>
          {description}
        </span>
      </span>
    </Label>
  )
}

export function GithubMark() {
  return (
    <svg viewBox='0 0 16 16' fill='currentColor' aria-hidden='true'>
      <path d='M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-2.92-.89-2.92-2.85 0-.83.29-1.51.77-2.04-.08-.2-.34-1 .07-2.08 0 0 .63-.2 2.06.78a6.9 6.9 0 0 1 1.87-.25c.64 0 1.28.09 1.87.25 1.43-.98 2.06-.78 2.06-.78.41 1.08.15 1.88.07 2.08.48.53.77 1.21.77 2.04 0 1.97-1.15 2.65-2.93 2.85.3.26.56.76.56 1.54 0 1.11-.01 2.02-.01 2.29 0 .21.15.46.55.38A8 8 0 0 0 16 8c0-4.42-3.58-8-8-8Z' />
    </svg>
  )
}

export function SetupReveal({
  children,
  name,
  open,
}: {
  children: ReactNode
  name: string
  open: boolean
}) {
  return (
    <Collapsible open={open}>
      <CollapsibleContent
        className='setup-fields-reveal'
        data-setup-reveal={name}
      >
        <div className='setup-fields-reveal-inner'>{children}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}
