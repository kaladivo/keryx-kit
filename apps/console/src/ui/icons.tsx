import type { SVGProps } from 'react'

const Icon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    {...props}
  />
)

export const TrezorIcon = () => (
  <Icon>
    <path d="M8 8V6.5a4 4 0 0 1 8 0V8" />
    <rect x="5" y="8" width="14" height="13" rx="3" />
    <rect x="9" y="11.5" width="6" height="4.5" rx="1" />
  </Icon>
)

export const PasskeyIcon = () => (
  <Icon>
    <circle cx="9" cy="8" r="4" />
    <path d="M3 20a6 6 0 0 1 10.5-4" />
    <circle cx="17.5" cy="14.5" r="2.5" />
    <path d="M17.5 17v4M17.5 19.5h1.8" />
  </Icon>
)

export const ShieldIcon = () => (
  <Icon>
    <path d="M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6z" />
    <path d="m9 12 2 2 4-4" />
  </Icon>
)

export const CheckIcon = ({ className }: { readonly className?: string }) => (
  <Icon className={className}>
    <circle cx="12" cy="12" r="9" />
    <path d="m8 12.5 2.5 2.5L16 9.5" />
  </Icon>
)

export const WarnIcon = () => (
  <Icon>
    <path d="M12 4 2.5 20h19z" />
    <path d="M12 10v4M12 17h.01" />
  </Icon>
)

export const InfoIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8h.01" />
  </Icon>
)

const changeMarks = {
  add: 'M12 8v8M8 12h8',
  edit: 'm9 15 1-3 4.5-4.5 2 2L12 14z',
  remove: 'M8 12h8',
  note: 'M12 11v5M12 8h.01',
} as const

export const ChangeIcon = ({ kind }: { readonly kind: keyof typeof changeMarks }) => (
  <Icon data-kind={kind}>
    <circle cx="12" cy="12" r="9" />
    <path d={changeMarks[kind]} />
  </Icon>
)

export const OperatorIcon = () => (
  <Icon>
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M8 20h8M12 16v4" />
  </Icon>
)
