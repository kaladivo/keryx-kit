import { describe, expect, it } from 'vitest'
import { DEMO_ITEM } from '../src/demo-item.ts'
import { checkAuthorSignatures } from '../src/verify.ts'

describe('checkAuthorSignatures', () => {
  it('accepts both author signatures on the published demo item', () => {
    expect(checkAuthorSignatures(DEMO_ITEM).map((check) => check.valid)).toEqual([true, true])
  })

  it('rejects the item once its title changes by one letter', () => {
    const forged = { ...DEMO_ITEM, title: DEMO_ITEM.title.replace('crypto', 'crypt0') }
    expect(checkAuthorSignatures(forged).map((check) => check.valid)).toEqual([false, false])
  })
})
