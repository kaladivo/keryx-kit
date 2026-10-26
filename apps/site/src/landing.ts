import {
  type FieldErrors,
  MAX_LENGTH,
  normalize,
  type PilotField,
  type PilotRequest,
  submit,
  validate,
} from './pilot-request.ts'
import { setupSignatureCheck } from './signature-check.ts'
import { setupSite } from './site.ts'

setupSite()
setupSignatureCheck()

const FIELDS = Object.keys(MAX_LENGTH) as PilotField[]

const byId = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id)
  if (element === null) throw new Error(`Missing #${id}`)
  return element as T
}

const form = byId<HTMLFormElement>('pilot-form')
const status = byId<HTMLElement>('pilot-status')
const done = byId<HTMLElement>('pilot-done')
const sendButton = form.querySelector<HTMLButtonElement>('button[type="submit"]')

const input = (field: PilotField) => byId<HTMLInputElement | HTMLTextAreaElement>(`pilot-${field}`)
const errorText = (field: PilotField) => byId<HTMLElement>(`pilot-${field}-error`)

const readForm = (): PilotRequest =>
  normalize({
    company: input('company').value,
    name: input('name').value,
    email: input('email').value,
    message: input('message').value,
  })

const showFieldErrors = (errors: FieldErrors) => {
  for (const field of FIELDS) {
    const error = errors[field]
    const control = input(field)
    const text = errorText(field)
    text.textContent = error ?? ''
    text.hidden = error === undefined
    if (error === undefined) {
      control.removeAttribute('aria-invalid')
      control.removeAttribute('aria-describedby')
    } else {
      control.setAttribute('aria-invalid', 'true')
      control.setAttribute('aria-describedby', text.id)
    }
  }
}

const showStatus = (message: string, tone: 'info' | 'error') => {
  status.textContent = message
  status.dataset.tone = tone
}

const setSending = (sending: boolean) => {
  if (sendButton === null) return
  sendButton.disabled = sending
  sendButton.textContent = sending ? 'Sending…' : 'Send request'
}

form.addEventListener('submit', async (event) => {
  event.preventDefault()
  const request = readForm()
  const errors = validate(request)
  showFieldErrors(errors)
  const firstInvalid = FIELDS.find((field) => errors[field] !== undefined)
  if (firstInvalid !== undefined) {
    showStatus('Check the highlighted fields.', 'error')
    input(firstInvalid).focus()
    return
  }

  setSending(true)
  showStatus('Sending your request…', 'info')
  const result = await submit(request)
  setSending(false)

  if (result.ok) {
    showStatus('', 'info')
    form.hidden = true
    done.hidden = false
    done.focus()
  } else {
    showStatus(result.error, 'error')
  }
})
