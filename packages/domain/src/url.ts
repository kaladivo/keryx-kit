/**
 * A linked resource the subscriber app will load (its `linkedUrlAllowed`): it must
 * parse as a URL with the `https:` scheme. The literal prefix is the Go SDK's rule.
 */
export const isLinkedHttpsUrl = (value: string): boolean => {
  if (!value.startsWith('https://')) return false
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}
