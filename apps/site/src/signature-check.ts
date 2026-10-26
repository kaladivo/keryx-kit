import type { Item } from '@keryx-kit/domain'
import { DEMO_ITEM } from './demo-item.ts'

const ORIGINAL = '20%'
const EDITED = '70%'

const VERDICTS = {
  shown: { word: 'Shown', line: 'The signature matches every character. The app shows this post.' },
  hidden: {
    word: 'Not shown',
    line: 'The signature no longer matches. The app drops the post without a warning.',
  },
  failed: { word: 'Not checked', line: 'The checker did not load. Reload the page to try again.' },
} as const

type Verdict = keyof typeof VERDICTS
type IsSigned = (item: Item) => boolean
type Point = { x: number; y: number }

const titleWith = (part: string) => DEMO_ITEM.title.replace(ORIGINAL, part)

const render = (check: HTMLElement, verdict: Verdict) => {
  if (check.dataset.checkState === verdict) return
  check.dataset.checkState = verdict
  const word = check.querySelector('.verdict-word')
  const line = check.querySelector('.verdict-line')
  if (word !== null) word.textContent = VERDICTS[verdict].word
  if (line !== null) line.textContent = VERDICTS[verdict].line
}

/** Writes `part` where the title says 20% and shows what the real signature check says. */
const setTitlePart = (check: HTMLElement, part: string, isSigned: IsSigned) => {
  const edit = check.querySelector('.check-edit')
  if (edit !== null) edit.textContent = part
  render(check, isSigned({ ...DEMO_ITEM, title: titleWith(part) }) ? 'shown' : 'hidden')
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(signal.reason)
      },
      { once: true },
    )
  })

/** A point inside `target`, as fractions of its box, relative to the check. */
const pointOn = (check: HTMLElement, target: Element, x: number, y: number): Point => {
  const origin = check.getBoundingClientRect()
  const box = target.getBoundingClientRect()
  return { x: box.left - origin.left + box.width * x, y: box.top - origin.top + box.height * y }
}

const parts = (check: HTMLElement) => {
  const cursor = check.querySelector<SVGElement>('.check-cursor')
  const edit = check.querySelector<HTMLElement>('.check-edit')
  const post = check.querySelector<HTMLElement>('.check-post')
  if (cursor === null || edit === null || post === null) throw new Error('Incomplete check markup')
  return { cursor, edit, post }
}

const reset = (check: HTMLElement, isSigned: IsSigned) => {
  const { cursor, edit } = parts(check)
  check.classList.remove('is-resetting')
  cursor.classList.remove('is-visible')
  edit.classList.remove('is-selected', 'is-typing')
  setTitlePart(check, ORIGINAL, isSigned)
}

/**
 * The demo pointer selects 20% in the title and types 70%. Every keystroke goes through
 * the real signature check, which alone decides the verdict and the phone's feed.
 */
const playLoop = async (check: HTMLElement, isSigned: IsSigned, signal: AbortSignal) => {
  const { cursor, edit, post } = parts(check)
  const moveTo = ({ x, y }: Point, ms: number) => {
    cursor.style.setProperty('--move', `${ms}ms`)
    cursor.style.translate = `${x}px ${y}px`
  }
  const rest = () => pointOn(check, post, 0.82, 0.94)

  for (;;) {
    reset(check, isSigned)
    moveTo(rest(), 0)
    await sleep(1800, signal)
    cursor.classList.add('is-visible')
    await sleep(400, signal)
    moveTo(pointOn(check, edit, 0, 0.62), 1100)
    await sleep(1400, signal)
    edit.classList.add('is-selected')
    moveTo(pointOn(check, edit, 1, 0.62), 520)
    await sleep(900, signal)
    edit.classList.replace('is-selected', 'is-typing')
    for (const typed of ['7', '70', EDITED]) {
      setTitlePart(check, typed, isSigned)
      await sleep(200, signal)
    }
    await sleep(500, signal)
    edit.classList.remove('is-typing')
    cursor.classList.remove('is-visible')
    moveTo(rest(), 900)
    await sleep(4200, signal)
    check.classList.add('is-resetting')
    await sleep(350, signal)
    setTitlePart(check, ORIGINAL, isSigned)
    await sleep(60, signal)
  }
}

const describe = (signed: boolean) => (signed ? 'shown' : 'not shown')

/**
 * Plays the edit-and-check demo while the section is on screen and the tab is visible.
 * With reduced motion it shows the signed and the edited post side by side instead.
 */
export const setupSignatureCheck = () => {
  const showcase = document.querySelector<HTMLElement>('.showcase')
  const check = showcase?.querySelector<HTMLElement>('.check')
  const summary = document.getElementById('check-summary')
  if (!showcase || !check || !summary) return

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
  let isSigned: IsSigned | undefined
  let inView = false
  let playing: AbortController | undefined
  let edited: HTMLElement | undefined

  const showEditedCopy = (show: boolean, verify: IsSigned) => {
    if (show && edited === undefined) {
      edited = check.cloneNode(true) as HTMLElement
      const label = edited.querySelector('.check-label')
      if (label !== null) label.textContent = 'Title, edited'
      setTitlePart(edited, EDITED, verify)
      showcase.append(edited)
    } else if (!show && edited !== undefined) {
      edited.remove()
      edited = undefined
    }
  }

  const update = () => {
    if (isSigned === undefined) return
    const animate = inView && !document.hidden && !reducedMotion.matches
    if (animate && playing === undefined) {
      playing = new AbortController()
      playLoop(check, isSigned, playing.signal).catch(() => {})
    } else if (!animate && playing !== undefined) {
      playing.abort()
      playing = undefined
      reset(check, isSigned)
    }
    showEditedCopy(reducedMotion.matches, isSigned)
  }

  const load = async () => {
    try {
      const verify = (await import('./verify.ts')).isSignedByDemoAuthor
      isSigned = verify
      reset(check, verify)
      summary.textContent = `Demo: someone edits the post's title from 20% off to 70% off. Your browser checked both versions against the signature: the original is ${describe(verify(DEMO_ITEM))} and the edited one is ${describe(verify({ ...DEMO_ITEM, title: titleWith(EDITED) }))} in Scuffwell's feed.`
      update()
    } catch {
      render(check, 'failed')
    }
  }

  const loader = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      loader.disconnect()
      void load()
    },
    { rootMargin: '600px 0px' },
  )
  loader.observe(check)

  new IntersectionObserver(
    (entries) => {
      inView = entries.some((entry) => entry.intersectionRatio >= 0.5)
      update()
    },
    { threshold: [0, 0.5] },
  ).observe(check)

  document.addEventListener('visibilitychange', update)
  reducedMotion.addEventListener('change', update)
}
