import { useEffect, useRef, useState } from 'react'

export interface Async<A> {
  readonly data: A | undefined
  readonly error: Error | undefined
  readonly loading: boolean
  readonly reload: () => Promise<void>
}

/**
 * Loads on mount and whenever `deps` change; `reload` refetches without clearing data.
 * `deps` are the (serializable) inputs of `load`.
 */
export const useAsync = <A>(load: () => Promise<A>, deps: ReadonlyArray<unknown>): Async<A> => {
  const [state, setState] = useState<{ data?: A; error?: Error; loading: boolean }>({
    loading: true,
  })
  const latest = useRef(load)
  latest.current = load
  const run = useRef(async () => {
    setState((s) => ({ ...s, loading: true }))
    try {
      const data = await latest.current()
      setState({ data, loading: false })
    } catch (error) {
      setState((s) => ({ ...s, error: error as Error, loading: false }))
    }
  })
  const key = JSON.stringify(deps)
  useEffect(() => {
    void key
    void run.current()
  }, [key])
  return { data: state.data, error: state.error, loading: state.loading, reload: run.current }
}

/** A click handler that tracks its own busy and error state. */
export const useAction = <Args extends ReadonlyArray<unknown>>(
  action: (...args: Args) => Promise<void>,
) => {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const run = async (...args: Args) => {
    setBusy(true)
    setError(undefined)
    try {
      await action(...args)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return { run, busy, error, setError }
}
