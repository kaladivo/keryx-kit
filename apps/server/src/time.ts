import { Context, Effect, Layer } from 'effect'

/** The server's clock. Tests swap it for a fake they move by hand. */
export class Time extends Context.Service<Time, { readonly now: Effect.Effect<Date> }>()(
  'keryx-kit/Time',
) {}

export const TimeLive = Layer.succeed(Time, { now: Effect.sync(() => new Date()) })

export const now: Effect.Effect<Date, never, Time> = Effect.flatMap(Time, (time) => time.now)

export const iso = (date: Date): string => date.toISOString()

const DAY = 24 * 60 * 60 * 1000

export const addMs = (date: Date, ms: number): Date => new Date(date.getTime() + ms)
export const addDays = (date: Date, days: number): Date => addMs(date, days * DAY)

export const startOfDay = (date: Date): Date =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
