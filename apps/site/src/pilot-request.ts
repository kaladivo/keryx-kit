export const PILOT_REQUESTS_URL = '/api/pilot-requests'

export interface PilotRequest {
  company: string
  name: string
  email: string
  message: string
}

export type PilotField = keyof PilotRequest
export type FieldErrors = Partial<Record<PilotField, string>>

export const MAX_LENGTH: Record<PilotField, number> = {
  company: 200,
  name: 200,
  email: 254,
  message: 4000,
}

const REQUIRED: Record<PilotField, string | undefined> = {
  company: 'Enter your company name.',
  name: 'Enter your name.',
  email: 'Enter your email address.',
  message: undefined,
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const normalize = (request: PilotRequest): PilotRequest => ({
  company: request.company.trim(),
  name: request.name.trim(),
  email: request.email.trim(),
  message: request.message.trim(),
})

const fieldError = (field: PilotField, value: string): string | undefined => {
  if (value === '') return REQUIRED[field]
  if (value.length > MAX_LENGTH[field]) return `Use at most ${MAX_LENGTH[field]} characters.`
  if (field === 'email' && !EMAIL_PATTERN.test(value))
    return 'Enter an email address like jana@example.com.'
  return undefined
}

export const validate = (request: PilotRequest): FieldErrors => {
  const errors: FieldErrors = {}
  for (const field of Object.keys(MAX_LENGTH) as PilotField[]) {
    const error = fieldError(field, request[field])
    if (error !== undefined) errors[field] = error
  }
  return errors
}

export type SubmitResult = { ok: true } | { ok: false; error: string }

const GENERIC_ERROR = 'We could not send your request. Please try again in a moment.'

const serverError = async (response: Response): Promise<string> => {
  try {
    const body: unknown = await response.json()
    if (
      typeof body === 'object' &&
      body !== null &&
      'error' in body &&
      typeof body.error === 'string'
    ) {
      return body.error
    }
  } catch {
    // A non-JSON error body gets the generic message.
  }
  return GENERIC_ERROR
}

export const submit = async (
  request: PilotRequest,
  fetchFn: typeof fetch = fetch,
): Promise<SubmitResult> => {
  let response: Response
  try {
    response = await fetchFn(PILOT_REQUESTS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })
  } catch {
    return {
      ok: false,
      error: 'We could not reach the server. Check your connection and try again.',
    }
  }
  if (response.ok) return { ok: true }
  if (response.status === 400) return { ok: false, error: await serverError(response) }
  return { ok: false, error: GENERIC_ERROR }
}
