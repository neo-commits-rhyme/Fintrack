import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Button } from './primitives'
import { Icon } from './icons'

/**
 * Modal sheet built on <dialog>: focus trapped by the platform, Escape closes, focus returns to the opener,
 * background inert via showModal(). Submit with Enter; Save disabled when `canSave` is false.
 */
export function Sheet({ open, title, onClose, onSave, saveTitle = 'Save', canSave = true, children, footnote, danger, wide }: {
  open: boolean; title: string; onClose: () => void; onSave?: () => void; saveTitle?: string; canSave?: boolean; children: ReactNode; footnote?: ReactNode; danger?: boolean; wide?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (open && !el.open) {
      el.showModal()
      // Focus the first field, not the Cancel button.
      const first = el.querySelector<HTMLElement>('input, select, textarea, [role="radio"][aria-checked="true"], button.btn-primary')
      first?.focus()
    } else if (!open && el.open && !el.classList.contains('closing')) {
      // Exit softer than the enter: a short fade, then the real close.
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      el.classList.add('closing')
      window.setTimeout(() => {
        el.classList.remove('closing')
        if (el.open) el.close()
      }, reduce ? 0 : 150)
    }
  }, [open])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!canSave || !onSave) return
    onSave()
    onClose()
  }

  return (
    <dialog ref={ref} className={`sheet${wide ? ' sheet-wide' : ''}`} aria-labelledby={titleId} onCancel={(e) => { e.preventDefault(); onClose() }}
      onClick={(e) => { if (e.target === ref.current) onClose() }}>
      <form className="sheet-form" onSubmit={submit} noValidate>
        <h2 id={titleId} className="sheet-head">{title}</h2>
        <div className="sheet-body">
          {children}
          {footnote && <p className="sheet-footnote">{footnote}</p>}
        </div>
        <div className="sheet-foot">
          <Button type="button" onClick={onClose}>Cancel</Button>
          {onSave && <Button type="submit" variant={danger ? 'danger-solid' : 'primary'} disabled={!canSave}>{saveTitle}</Button>}
        </div>
      </form>
    </dialog>
  )
}

export function SheetSection({ children }: { children: ReactNode }) {
  return <div className="sheet-section">{children}</div>
}

/** Destructive confirmation: title, message, one red button. */
export function ConfirmDialog({ open, title, message, confirmTitle, onConfirm, onClose, destructive = true }: {
  open: boolean; title: string; message: string; confirmTitle: string; onConfirm: () => void; onClose: () => void; destructive?: boolean
}) {
  return (
    <Sheet open={open} title={title} onClose={onClose} onSave={onConfirm} saveTitle={confirmTitle} danger={destructive}>
      <p className="caption" style={{ textAlign: 'center', color: 'var(--text)' }}>{message}</p>
    </Sheet>
  )
}

export interface MenuItem { label: string; icon?: string; onSelect: () => void; danger?: boolean }

/** "…" dropdown menu: button + listbox with arrow-key navigation, Escape and outside-click close. */
export function Menu({ items, label, children, size = 'md' }: { items: MenuItem[]; label: string; children?: ReactNode; size?: 'sm' | 'md' }) {
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const id = useId()

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); btn.current?.focus() }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const els = [...(wrap.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
        const i = els.indexOf(document.activeElement as HTMLElement)
        const next = e.key === 'ArrowDown' ? (i + 1) % els.length : (i - 1 + els.length) % els.length
        els[next]?.focus()
        e.preventDefault()
      }
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    const first = wrap.current?.querySelector<HTMLElement>('[role="menuitem"]')
    first?.focus()
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open])

  return (
    <div className="menu-wrap" ref={wrap}>
      <Button ref={btn} variant="ghost" size={size} iconOnly icon={children ? undefined : 'ellipsis'} aria-label={label} aria-haspopup="menu" aria-expanded={open} aria-controls={id}
        onClick={() => setOpen((v) => !v)}>
        {children ?? label}
      </Button>
      {open && (
        <div className="menu" role="menu" id={id} aria-label={label}>
          {items.map((item, i) => (
            <span key={i}>
              {item.danger && i > 0 && <div className="menu-sep" role="separator" />}
              <button type="button" role="menuitem" className={`menu-item ${item.danger ? 'danger' : ''}`} onClick={() => { setOpen(false); item.onSelect() }}>
                {item.icon && <Icon name={item.icon} size={15} strokeWidth={2} />}
                {item.label}
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
