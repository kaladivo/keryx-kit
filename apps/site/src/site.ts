const THEME_KEY = 'keryx-theme'
type Theme = 'light' | 'dark'

const storedTheme = (): Theme | null => {
  try {
    const value = localStorage.getItem(THEME_KEY)
    return value === 'light' || value === 'dark' ? value : null
  } catch {
    return null
  }
}

const storeTheme = (theme: Theme) => {
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {
    // Private windows may refuse storage; the toggle still works for this visit.
  }
}

const effectiveTheme = (): Theme => {
  const chosen = document.documentElement.dataset.theme
  if (chosen === 'light' || chosen === 'dark') return chosen
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

const setupThemeToggle = () => {
  const saved = storedTheme()
  if (saved !== null) document.documentElement.dataset.theme = saved
  for (const button of document.querySelectorAll<HTMLButtonElement>('.theme-toggle')) {
    button.addEventListener('click', () => {
      const next: Theme = effectiveTheme() === 'dark' ? 'light' : 'dark'
      document.documentElement.dataset.theme = next
      storeTheme(next)
    })
  }
}

const revealSlides = (slides: HTMLElement[]) => {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        entry.target.classList.add('is-visible')
        observer.unobserve(entry.target)
      }
    },
    { rootMargin: '0px 0px -20% 0px' },
  )
  for (const slide of slides) observer.observe(slide)
}

const trackCurrentSlide = (slides: HTMLElement[]) => {
  const links = new Map(
    [...document.querySelectorAll<HTMLAnchorElement>('.slide-nav a')].map((link) => [
      link.hash.slice(1),
      link,
    ]),
  )
  if (links.size === 0) return
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        for (const [id, link] of links) {
          if (id === entry.target.id) link.setAttribute('aria-current', 'true')
          else link.removeAttribute('aria-current')
        }
      }
    },
    { rootMargin: '-50% 0px -50% 0px' },
  )
  for (const slide of slides) observer.observe(slide)
}

export const setupSite = () => {
  setupThemeToggle()
  const slides = [...document.querySelectorAll<HTMLElement>('.slide')]
  revealSlides(slides)
  trackCurrentSlide(slides)
}
