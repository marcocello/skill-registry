import { useState, type ReactNode } from 'react'
import { copyText } from '@/registry/actions'
import { Check, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

export function PromptAction({
  children,
  title,
  description,
  prompt,
}: {
  children: ReactNode
  title: string
  description: string
  prompt: string
}) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    await copyText(prompt, 'MCP prompt copied')
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1400)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className='sm:max-w-xl'>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div
          className='rounded-lg border bg-muted/35 p-4 font-mono text-sm leading-6'
          data-testid='mcp-prompt'
        >
          {prompt}
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={() => setOpen(false)}>
            Close
          </Button>
          <Button onClick={handleCopy}>
            {copied ? <Check /> : <Copy />}
            {copied ? 'Copied' : 'Copy prompt'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
