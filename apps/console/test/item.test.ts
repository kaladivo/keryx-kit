import { ITEM_MAX_BYTES } from '@keryx-kit/domain'
import { describe, expect, it } from 'vitest'
import { buildItem, contentProblems, itemSize, slugify } from '../src/lib/item.ts'

const content = (markdown: string, image?: string) => ({
  itemId: 'autumn-sale',
  title: 'Autumn sale',
  markdown,
  ...(image ? { image } : {}),
  tags: ['sale', ' '],
  language: 'en',
})
const now = new Date('2026-10-26T10:00:00.123Z')

describe('item building', () => {
  it('builds the unsigned item from the editor state', () => {
    const item = buildItem(content('Hello **you**'), now)
    expect(item).toEqual({
      id: 'autumn-sale',
      title: 'Autumn sale',
      content_html: '<p>Hello <strong>you</strong></p>\n',
      date_published: '2026-10-26T10:00:00Z',
      tags: ['sale'],
      language: 'en',
    })
  })

  it('keeps date_published and sets date_modified on an edit', () => {
    const first = buildItem(content('v1'), now)
    const edit = buildItem(content('v2'), new Date('2026-10-27T08:00:00Z'), { ...first, sig: [] })
    expect(edit.date_published).toBe('2026-10-26T10:00:00Z')
    expect(edit.date_modified).toBe('2026-10-27T08:00:00Z')
  })

  it('slugs titles into valid item ids', () => {
    expect(slugify('Nové otevírací hodiny — od listopadu!')).toBe(
      'nove-oteviraci-hodiny-od-listopadu',
    )
    expect(slugify('   ')).toBe('')
  })

  it('reports missing fields and bad ids', () => {
    expect(contentProblems({ ...content(''), title: ' ', itemId: 'Bad Id' })).toHaveLength(3)
    expect(contentProblems(content('ok'))).toEqual([])
  })
})

describe('1 MB item limit', () => {
  const imageOf = (bytes: number) =>
    `data:image/jpeg;base64,${'A'.repeat(Math.ceil(bytes / 3) * 4)}`

  it('fits a post with a normal preview image', () => {
    const size = itemSize(buildItem(content('Hi', imageOf(200_000)), now))
    expect(size.fits).toBe(true)
    expect(size.bytes).toBeGreaterThan(266_000)
  })

  it('blocks a post whose signed file would exceed 1 MB', () => {
    const size = itemSize(buildItem(content('Hi', imageOf(800_000)), now))
    expect(size.fits).toBe(false)
    expect(size.bytes).toBeGreaterThan(ITEM_MAX_BYTES)
  })

  it('counts inline images in the body and room for two signatures', () => {
    const body = `![x](${imageOf(790_000)})`
    const item = buildItem(content(body), now)
    const unsigned = new TextEncoder().encode(JSON.stringify(item, null, 2)).length
    const { bytes, fits } = itemSize(item)
    expect(bytes - unsigned).toBeGreaterThan(300)
    expect(fits).toBe(false)
  })
})
