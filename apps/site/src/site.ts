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

const showTheme = (buttons: HTMLButtonElement[]) => {
  const dark = String(effectiveTheme() === 'dark')
  for (const button of buttons) button.setAttribute('aria-pressed', dark)
}

const setupThemeToggle = () => {
  const saved = storedTheme()
  if (saved !== null) document.documentElement.dataset.theme = saved
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('.theme-toggle')]
  showTheme(buttons)
  for (const button of buttons) {
    button.addEventListener('click', () => {
      const next: Theme = effectiveTheme() === 'dark' ? 'light' : 'dark'
      document.documentElement.dataset.theme = next
      storeTheme(next)
      showTheme(buttons)
    })
  }
}

export const setupSite = () => {
  setupThemeToggle()
}
