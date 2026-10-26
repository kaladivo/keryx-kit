import { DEMO_ITEM } from './demo-item.ts'
import type { AuthorCheck } from './verify.ts'

const VERDICTS = {
  shown: {
    word: 'Shown',
    line: 'Both author signatures check out. The app shows this message.',
  },
  hidden: {
    word: 'Not shown',
    line: 'The signatures no longer match the text. The app rejects it and never shows it.',
  },
} as const

const renderChecks = (root: HTMLElement, checks: AuthorCheck[]) => {
  for (const check of checks) {
    const row = root.querySelector<HTMLElement>(`[data-author="${check.name}"]`)
    if (row === null) continue
    row.dataset.valid = String(check.valid)
    const state = row.querySelector('.sig-state')
    if (state !== null) state.textContent = check.valid ? 'Valid' : 'Fails'
  }
}

const renderVerdict = (root: HTMLElement, shown: boolean) => {
  const next = shown ? 'shown' : 'hidden'
  const verdict = root.querySelector<HTMLElement>('.verdict')
  const changed = root.dataset.checkState !== next
  root.dataset.checkState = next
  if (verdict === null || !changed) return
  const word = verdict.querySelector('.verdict-word')
  const line = verdict.querySelector('.verdict-line')
  if (word !== null) word.textContent = VERDICTS[next].word
  if (line !== null) line.textContent = VERDICTS[next].line
  verdict.classList.remove('is-changing')
  void verdict.offsetWidth // restarts the wipe animation
  verdict.classList.add('is-changing')
}

const showLoadFailure = (root: HTMLElement) => {
  root.dataset.checkState = 'failed'
  const word = root.querySelector('.verdict-word')
  const line = root.querySelector('.verdict-line')
  if (word !== null) word.textContent = 'Not checked'
  if (line !== null) line.textContent = 'The checker did not load. Reload the page to try again.'
  for (const state of root.querySelectorAll('.sig-state')) state.textContent = 'Not checked'
}

export const setupSignatureCheck = () => {
  const root = document.querySelector<HTMLElement>('.specimen')
  const title = document.querySelector<HTMLTextAreaElement>('#forge-title')
  const reset = root?.querySelector<HTMLButtonElement>('.reset')
  if (!root || !title || !reset) return

  let check: ((item: typeof DEMO_ITEM) => AuthorCheck[]) | undefined

  const run = () => {
    if (check === undefined) return
    const checks = check({ ...DEMO_ITEM, title: title.value })
    renderChecks(root, checks)
    renderVerdict(
      root,
      checks.every((result) => result.valid),
    )
    reset.hidden = title.value === DEMO_ITEM.title
  }

  title.addEventListener('input', run)
  reset.addEventListener('click', () => {
    title.value = DEMO_ITEM.title
    run()
    title.focus()
  })

  const load = async () => {
    try {
      const verify = await import('./verify.ts')
      check = verify.checkAuthorSignatures
      run()
    } catch {
      showLoadFailure(root)
    }
  }

  const observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      observer.disconnect()
      void load()
    },
    { rootMargin: '400px 0px' },
  )
  observer.observe(root)
}
