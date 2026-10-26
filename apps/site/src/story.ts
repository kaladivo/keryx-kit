/**
 * The sticky phone follows the scroll story: whichever step crosses the middle of the
 * viewport picks the screen. On narrow screens the steps carry their own screenshots.
 */
export const setupStory = () => {
  const stage = document.querySelector<HTMLElement>('.stage')
  const phone = document.querySelector<HTMLElement>('.rail .phone')
  const steps = [...document.querySelectorAll<HTMLElement>('[data-step]')]
  if (stage === null || phone === null || steps.length === 0) return
  const shots = [...phone.querySelectorAll<HTMLElement>('[data-shot]')]

  const show = (state: string) => {
    phone.dataset.active = state
    for (const shot of shots) shot.classList.toggle('is-active', shot.dataset.shot === state)
    for (const step of steps) step.classList.toggle('is-current', step.dataset.step === state)
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const state = (entry.target as HTMLElement).dataset.step
        if (entry.isIntersecting && state !== undefined) show(state)
      }
    },
    { rootMargin: '-50% 0px -50% 0px' },
  )
  for (const step of steps) observer.observe(step)
  stage.dataset.story = ''
}
