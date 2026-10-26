const DAY = 24 * 60 * 60 * 1000

/** mvp-spec E3: the owner is reminded 60, 30 and 7 days before `targets.json` expires. */
export const expiryReminder = (
  expires: string,
  now: Date,
): { readonly daysLeft: number; readonly tier: 60 | 30 | 7 | 0 } | undefined => {
  const daysLeft = Math.floor((Date.parse(expires) - now.getTime()) / DAY)
  if (daysLeft < 0) return { daysLeft, tier: 0 }
  if (daysLeft <= 7) return { daysLeft, tier: 7 }
  if (daysLeft <= 30) return { daysLeft, tier: 30 }
  if (daysLeft <= 60) return { daysLeft, tier: 60 }
  return undefined
}
