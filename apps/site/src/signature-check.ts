import { DEMO_ITEM } from './demo-item.ts'

const VERDICTS = {
  shown: { word: 'Shown', line: 'The signature matches every character. The app shows this post.' },
  hidden: {
    word: 'Never shown',
    line: 'The signature no longer matches. The app drops the post without a warning.',
  },
  failed: { word: 'Not checked', line: 'The checker did not load. Reload the page to try again.' },
} as const

type Verdict = keyof typeof VERDICTS

const render = (root: HTMLElement, verdict: Verdict) => {
  if (root.dataset.checkState === verdict) return
  root.dataset.checkState = verdict
  const word = root.querySelector('.verdict-word')
  const line = root.querySelector('.verdict-line')
  if (word !== null) word.textContent = VERDICTS[verdict].word
  if (line !== null) line.textContent = VERDICTS[verdict].line
}

/** Lets the visitor edit the signed demo post's title and re-checks it on every keystroke. */
export const setupSignatureCheck = () => {
  const root = document.querySelector<HTMLElement>('.check')
  const title = root?.querySelector('textarea')
  const reset = root?.querySelector<HTMLButtonElement>('.check-reset')
  if (!root || !title || !reset) return

  let isSigned: ((item: typeof DEMO_ITEM) => boolean) | undefined

  const run = () => {
    if (isSigned === undefined) return
    render(root, isSigned({ ...DEMO_ITEM, title: title.value }) ? 'shown' : 'hidden')
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
      isSigned = (await import('./verify.ts')).isSignedByDemoAuthor
      run()
    } catch {
      render(root, 'failed')
    }
  }

  const observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      observer.disconnect()
      void load()
    },
    { rootMargin: '600px 0px' },
  )
  observer.observe(root)
}
