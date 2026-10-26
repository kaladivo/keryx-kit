import { type ButtonHTMLAttributes, type ReactNode, useState } from 'react'
import { keyidFingerprint } from '../lib/fingerprint.ts'
import { Link } from '../lib/router.tsx'
import { CheckIcon, InfoIcon, WarnIcon } from './icons.tsx'

export const Page = ({
  title,
  lead,
  back,
  actions,
  narrow,
  children,
}: {
  readonly title: ReactNode
  readonly lead?: ReactNode
  readonly back?: { readonly to: string; readonly label: string }
  readonly actions?: ReactNode
  readonly narrow?: boolean
  readonly children?: ReactNode
}) => (
  <div className={`page wrap${narrow ? ' page-narrow-wrap' : ''}`}>
    <div className={narrow ? 'page-narrow' : undefined}>
      {back && (
        <Link className="back" to={back.to}>
          ← {back.label}
        </Link>
      )}
      <header className="page-head">
        <div>
          <h1>{title}</h1>
          {lead && <p className="lead">{lead}</p>}
        </div>
        {actions && <div className="row">{actions}</div>}
      </header>
      <div className="stack">{children}</div>
    </div>
  </div>
)

export type Tone = 'info' | 'warn' | 'danger' | 'success'

const toneIcon = { info: InfoIcon, warn: WarnIcon, danger: WarnIcon, success: CheckIcon }

export const Notice = ({
  tone = 'info',
  title,
  children,
  actions,
}: {
  readonly tone?: Tone
  readonly title?: ReactNode
  readonly children?: ReactNode
  readonly actions?: ReactNode
}) => {
  const Icon = toneIcon[tone]
  return (
    <div className="notice" data-tone={tone} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon />
      <div>
        {title && <strong>{title}</strong>}
        {typeof children === 'string' ? <p>{children}</p> : children}
      </div>
      {actions && <div className="notice-actions">{actions}</div>}
    </div>
  )
}

export const ErrorText = ({ error }: { readonly error: string | undefined }) =>
  error ? <Notice tone="danger">{error}</Notice> : null

export const Badge = ({
  tone,
  children,
}: {
  readonly tone?: 'success' | 'warn' | 'danger'
  readonly children: ReactNode
}) => (
  <span className="badge" data-tone={tone}>
    {children}
  </span>
)

export const Card = ({
  title,
  aside,
  quiet,
  children,
  id,
}: {
  readonly title?: ReactNode
  readonly aside?: ReactNode
  readonly quiet?: boolean
  readonly children?: ReactNode
  readonly id?: string
}) => (
  <section className={`card${quiet ? ' card-quiet' : ''}`} id={id}>
    {(title || aside) && (
      <div className="card-head">
        {title && <h2>{title}</h2>}
        {aside}
      </div>
    )}
    {children}
  </section>
)

export const Field = ({
  label,
  hint,
  error,
  optional,
  htmlFor,
  children,
}: {
  readonly label: ReactNode
  readonly hint?: ReactNode
  readonly error?: string | undefined
  readonly optional?: boolean
  readonly htmlFor: string
  readonly children: ReactNode
}) => (
  <div className="field">
    <label htmlFor={htmlFor}>
      {label} {optional && <span className="optional">(optional)</span>}
    </label>
    {children}
    {hint && <p className="field-hint">{hint}</p>}
    {error && <p className="field-error">{error}</p>}
  </div>
)

export const Button = ({
  busy,
  variant,
  small,
  children,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly busy?: boolean
  readonly variant?: 'quiet' | 'danger' | 'hardware'
  readonly small?: boolean
}) => (
  <button
    type="button"
    {...props}
    className={[
      'button',
      variant ? `button-${variant}` : '',
      small ? 'button-small' : '',
      className ?? '',
    ]
      .filter(Boolean)
      .join(' ')}
    disabled={busy || props.disabled}
    aria-busy={busy || undefined}
  >
    {children}
  </button>
)

export const Fingerprint = ({
  keyid,
  large,
}: {
  readonly keyid: string
  readonly large?: boolean
}) => (
  <code className={`fingerprint${large ? ' fingerprint-large' : ''}`} title={keyid}>
    {keyidFingerprint(keyid)}
  </code>
)

export const CopyButton = ({
  text,
  label = 'Copy',
}: {
  readonly text: string
  readonly label?: string
}) => {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      small
      variant="quiet"
      onClick={async () => {
        await navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1600)
      }}
    >
      {copied ? 'Copied' : label}
    </Button>
  )
}

export const Loading = ({ label = 'Loading…' }: { readonly label?: string }) => (
  <p className="muted" aria-live="polite">
    {label}
  </p>
)

export const formatDate = (iso: string | undefined): string =>
  iso
    ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : '—'

export const formatDateTime = (iso: string | undefined): string =>
  iso
    ? new Date(iso).toLocaleString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—'

export const daysUntil = (iso: string): number =>
  Math.floor((Date.parse(iso) - Date.now()) / (24 * 60 * 60 * 1000))
