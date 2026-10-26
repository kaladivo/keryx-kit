import { describe, expect, it } from 'vitest'
import { DEMO_ITEM } from '../src/demo-item.ts'
import { isSignedByDemoAuthor } from '../src/verify.ts'

describe('isSignedByDemoAuthor', () => {
  it('accepts the signed demo post', () => {
    expect(isSignedByDemoAuthor(DEMO_ITEM)).toBe(true)
  })

  it('rejects the post once its title changes by one character', () => {
    expect(
      isSignedByDemoAuthor({ ...DEMO_ITEM, title: DEMO_ITEM.title.replace('20%', '70%') }),
    ).toBe(false)
  })

  it('rejects the post once its body changes', () => {
    const content_html = DEMO_ITEM.content_html.replace('PUDDLE20', 'PUDDLE70')
    expect(isSignedByDemoAuthor({ ...DEMO_ITEM, content_html })).toBe(false)
  })
})
