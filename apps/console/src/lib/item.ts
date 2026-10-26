import type { DraftContent } from '@keryx-kit/api'
import { encodeItem, ITEM_ID, ITEM_MAX_BYTES, type Item, type ItemDraft } from '@keryx-kit/domain'
import { markdownToHtml } from './markdown.ts'

type Content = typeof DraftContent.Type

/** An item id from a title: lowercase ASCII, digits, `-`, at most 64 characters. */
export const slugify = (title: string): string =>
  title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/, '')

const rfc3339 = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z')

/**
 * The unsigned item. An edit (C4) keeps the original `date_published` and sets
 * `date_modified`, so subscribers see an in-place update.
 */
export const buildItem = (content: Content, now: Date, published?: Item): ItemDraft => {
  const tags = content.tags.map((tag) => tag.trim()).filter((tag) => tag !== '')
  return {
    id: content.itemId,
    title: content.title.trim(),
    content_html: markdownToHtml(content.markdown),
    ...(content.image ? { image: content.image } : {}),
    date_published: published?.date_published ?? rfc3339(now),
    ...(published ? { date_modified: rfc3339(now) } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    ...(content.language ? { language: content.language } : {}),
  }
}

/** Room for the author's and the channel key's signatures, which the size cap includes. */
const SIGNATURE_ROOM = [
  { keyid: '0'.repeat(64), sig: 'A'.repeat(86) },
  { keyid: '1'.repeat(64), sig: 'A'.repeat(86) },
]

/** The published file size of the item once signed (spec/feeds.md §1.1 caps it at 1 MB). */
export const itemSize = (item: ItemDraft): { readonly bytes: number; readonly fits: boolean } => {
  const bytes = encodeItem({ ...item, sig: SIGNATURE_ROOM }).length
  return { bytes, fits: bytes <= ITEM_MAX_BYTES }
}

export const contentProblems = (content: Content): ReadonlyArray<string> => [
  ...(content.title.trim() === '' ? ['Give the post a title.'] : []),
  ...(ITEM_ID.test(content.itemId) && content.itemId.length <= 64
    ? []
    : ['The post id may only use a-z, 0-9, - and _.']),
  ...(content.markdown.trim() === '' ? ['Write something in the body.'] : []),
]
