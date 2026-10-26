import type { DraftContent, PublishedItem } from '@keryx-kit/api'
import { ITEM_MAX_BYTES, signItem } from '@keryx-kit/domain'
import { useDeferredValue, useEffect, useId, useMemo, useRef, useState } from 'react'
import { call } from '../../lib/api.ts'
import { prepareTasks, signTasks, submitTasks, withAuthorKey } from '../../lib/authorSigning.ts'
import { runEffect } from '../../lib/effect.ts'
import { INLINE_IMAGE, PREVIEW_IMAGE, resizeImage } from '../../lib/image.ts'
import { buildItem, contentProblems, itemSize, slugify } from '../../lib/item.ts'
import { collapseImages, expandImages } from '../../lib/markdown.ts'
import { navigate, searchParam } from '../../lib/router.tsx'
import { useAction, useAsync } from '../../lib/useAsync.ts'
import { ImagePicker } from '../../ui/ImagePicker.tsx'
import { PasskeyIcon } from '../../ui/icons.tsx'
import {
  Button,
  Card,
  ErrorText,
  Field,
  formatDate,
  formatDateTime,
  Loading,
  Notice,
  Page,
} from '../../ui/kit.tsx'
import { reportTaskOutcomes, useAuthor } from './AuthorArea.tsx'

type Content = typeof DraftContent.Type

const LANGUAGES = [
  ['en', 'English'],
  ['cs', 'Czech'],
  ['sk', 'Slovak'],
  ['de', 'German'],
  ['pl', 'Polish'],
  ['fr', 'French'],
  ['es', 'Spanish'],
] as const

const emptyContent: Content = { itemId: '', title: '', markdown: '', tags: [], language: 'en' }

const kilobytes = (bytes: number) => `${Math.round(bytes / 1024).toLocaleString('en')} KB`

/** Wraps the textarea selection in Markdown markers and keeps the cursor sensible. */
const surround = (area: HTMLTextAreaElement, before: string, after = before, placeholder = '') => {
  const { selectionStart: start, selectionEnd: end, value } = area
  const selected = value.slice(start, end) || placeholder
  return {
    text: value.slice(0, start) + before + selected + after + value.slice(end),
    cursor: start + before.length + selected.length,
  }
}

interface Loaded {
  readonly content: Content
  readonly draftId?: string
  readonly published?: typeof PublishedItem.Type
}

const load = async (channel: string, itemId?: string): Promise<Loaded> => {
  if (itemId) {
    const published = await call((api) => api.items.get({ params: { channel, itemId } }))
    const { item } = published
    const content: Content = published.source ?? {
      itemId: item.id,
      title: item.title,
      markdown: item.content_html,
      ...(item.image ? { image: item.image } : {}),
      tags: item.tags ?? [],
      ...(item.language ? { language: item.language } : {}),
    }
    return { content, published }
  }
  const draftId = searchParam('draft')
  if (draftId) {
    const draft = (await call((api) => api.items.drafts())).find((d) => d.id === draftId)
    if (draft) return { content: draft.content, draftId }
  }
  return { content: emptyContent }
}

export const Editor = ({
  channel: fixedChannel,
  itemId,
}: {
  readonly channel?: string
  readonly itemId?: string
}) => {
  const { me, company, refresh } = useAuthor()
  const channels = useAsync(() => call((api) => api.channels.list()), [])
  const mine = (channels.data ?? []).filter((c) => c.authors.some((a) => a.memberId === me.id))
  const [channel, setChannel] = useState(fixedChannel ?? searchParam('channel') ?? '')
  useEffect(() => {
    if (!channel && mine[0]) setChannel(mine[0].name)
  }, [channel, mine])

  const loaded = useAsync(() => load(fixedChannel ?? '', itemId), [fixedChannel, itemId])
  const [title, setTitle] = useState('')
  const [id, setId] = useState('')
  const [idEdited, setIdEdited] = useState(false)
  const [text, setText] = useState('')
  const [images, setImages] = useState<Record<string, string>>({})
  const [image, setImage] = useState<string>()
  const [tags, setTags] = useState('')
  const [language, setLanguage] = useState('en')
  const [draftId, setDraftId] = useState<string>()
  const [savedAt, setSavedAt] = useState<string>()
  const area = useRef<HTMLTextAreaElement>(null)
  const inlineInput = useId()

  useEffect(() => {
    const data = loaded.data
    if (!data) return
    const collapsed = collapseImages(data.content.markdown)
    setTitle(data.content.title)
    setId(data.content.itemId)
    setIdEdited(data.content.itemId !== '')
    setText(collapsed.text)
    setImages(collapsed.images)
    setImage(data.content.image)
    setTags(data.content.tags.join(', '))
    setLanguage(data.content.language ?? '')
    setDraftId(data.draftId)
  }, [loaded.data])

  const editing = loaded.data?.published
  const content: Content = useMemo(
    () => ({
      itemId: id,
      title,
      markdown: expandImages(text, images),
      ...(image ? { image } : {}),
      tags: tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      ...(language ? { language } : {}),
    }),
    [id, title, text, images, image, tags, language],
  )
  const deferred = useDeferredValue(content)
  const preview = useMemo(() => buildItem(deferred, new Date(), editing?.item), [deferred, editing])
  const size = itemSize(preview)
  const problems = contentProblems(content)
  const ratio = Math.min(1, size.bytes / ITEM_MAX_BYTES)

  const edit = (next: { text: string; cursor: number }) => {
    setText(next.text)
    requestAnimationFrame(() => {
      area.current?.focus()
      area.current?.setSelectionRange(next.cursor, next.cursor)
    })
  }

  const insertImage = useAction(async (file: File) => {
    const url = await resizeImage(file, INLINE_IMAGE)
    const { text: collapsed, images: next } = collapseImages(
      `![${file.name.replace(/\.[^.]+$/, '')}](${url})`,
      images,
    )
    setImages(next)
    if (area.current) edit(surround(area.current, '', '', `\n${collapsed}\n`))
    else setText(`${text}\n${collapsed}\n`)
  })

  const save = useAction(async () => {
    if (!channel) throw new Error('Pick a channel.')
    const payload = { channel, content }
    const saved = draftId
      ? await call((api) => api.items.saveDraft({ params: { draftId }, payload }))
      : await call((api) => api.items.createDraft({ payload }))
    setDraftId(saved.id)
    setSavedAt(saved.updatedAt)
    history.replaceState(null, '', `/author/write?channel=${channel}&draft=${saved.id}`)
  })

  const publish = useAction(async () => {
    if (!channel) throw new Error('Pick a channel.')
    const [problem] = problems
    if (problem) throw new Error(problem)
    if (!size.fits) throw new Error('The post is over 1 MB. Remove or shrink an image.')
    const draft = buildItem(content, new Date(), editing?.item)
    const tasks = await call((api) => api.ceremonies.tasks())
    const targets = await prepareTasks(tasks, company)
    const signed = await withAuthorKey(me, async (signer) => ({
      item: await runEffect(signItem(draft, signer)),
      tasks: await signTasks(tasks, signer, targets),
    }))
    reportTaskOutcomes(await submitTasks(signed.tasks))
    const payload = { item: signed.item, source: content, ...(draftId ? { draftId } : {}) }
    if (editing)
      await call((api) => api.items.edit({ params: { channel, itemId: signed.item.id }, payload }))
    else await call((api) => api.items.publish({ params: { channel }, payload }))
    await refresh()
    navigate(`/author/channels/${channel}?published=${signed.item.id}`)
  })

  if (loaded.error)
    return (
      <Page title="Write">
        <Notice tone="danger">{loaded.error.message}</Notice>
      </Page>
    )
  if (!loaded.data || !channels.data)
    return (
      <Page title="Write">
        <Loading />
      </Page>
    )
  if (mine.length === 0)
    return (
      <Page title="Write a post">
        <Notice tone="info">
          You are not an author of any channel yet. Ask the owner to add you.
        </Notice>
      </Page>
    )
  const channelInfo = mine.find((c) => c.name === channel)

  return (
    <Page
      back={
        editing
          ? { to: `/author/channels/${channel}`, label: 'Published posts' }
          : { to: '/author', label: 'Home' }
      }
      title={editing ? 'Edit post' : 'Write a post'}
      lead={
        editing
          ? `Published ${formatDate(editing.item.date_published)}. Saving re-signs it with your key and updates it in place for subscribers.`
          : 'Markdown in, signed post out. The preview uses the same sanitizer as the subscriber app.'
      }
    >
      <div className="editor">
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault()
            void publish.run()
          }}
        >
          <Card>
            <div className="form">
              {!editing && (
                <Field label="Channel" htmlFor="post-channel">
                  <select
                    id="post-channel"
                    value={channel}
                    onChange={(e) => setChannel(e.target.value)}
                  >
                    {mine.map((c) => (
                      <option key={c.name} value={c.name}>
                        {c.displayName}
                        {c.status === 'live' ? '' : ' (waiting for an author)'}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <Field label="Title" htmlFor="post-title">
                <input
                  id="post-title"
                  required
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value)
                    if (!idEdited) setId(slugify(e.target.value))
                  }}
                />
              </Field>
              <Field
                label="Post id"
                htmlFor="post-id"
                hint={
                  editing
                    ? 'The id of a published post cannot change.'
                    : 'Part of the post’s address. Prefilled from the title.'
                }
              >
                <input
                  id="post-id"
                  required
                  className="mono"
                  value={id}
                  disabled={Boolean(editing)}
                  pattern="[a-z0-9_\-]+"
                  onChange={(e) => {
                    setId(e.target.value)
                    setIdEdited(true)
                  }}
                />
              </Field>
              <div className="field">
                <label htmlFor="post-body">Body</label>
                <div className="toolbar" role="toolbar" aria-label="Formatting">
                  <Button
                    small
                    variant="quiet"
                    onClick={() => area.current && edit(surround(area.current, '**', '**', 'bold'))}
                  >
                    <strong>B</strong>
                  </Button>
                  <Button
                    small
                    variant="quiet"
                    onClick={() => area.current && edit(surround(area.current, '_', '_', 'italic'))}
                  >
                    <em>I</em>
                  </Button>
                  <Button
                    small
                    variant="quiet"
                    onClick={() =>
                      area.current && edit(surround(area.current, '[', '](https://)', 'link text'))
                    }
                  >
                    Link
                  </Button>
                  <Button
                    small
                    variant="quiet"
                    onClick={() =>
                      area.current && edit(surround(area.current, '\n## ', '\n', 'Heading'))
                    }
                  >
                    Heading
                  </Button>
                  <input
                    id={inlineInput}
                    className="visually-hidden"
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      e.target.value = ''
                      if (file) void insertImage.run(file)
                    }}
                  />
                  <label htmlFor={inlineInput} className="button button-small button-quiet">
                    Image
                  </label>
                </div>
                <textarea
                  id="post-body"
                  ref={area}
                  className="textarea-code"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={
                    'Write in Markdown.\n\n**Bold**, _italic_, [links](https://example.com), lists and images.'
                  }
                />
                <p className="field-hint">
                  Images are resized in your browser and embedded in the signed post. Never ask
                  subscribers for passwords, seeds or codes: the app does not allow forms.
                </p>
                {insertImage.error && <p className="field-error">{insertImage.error}</p>}
              </div>
              <ImagePicker
                label="Preview image"
                value={image}
                options={PREVIEW_IMAGE}
                onChange={setImage}
                hint="Shown above the post and in the inbox. Resized to 1200 px."
              />
              <div className="grid grid-2">
                <Field label="Tags" htmlFor="post-tags" optional hint="Comma separated.">
                  <input
                    id="post-tags"
                    value={tags}
                    onChange={(e) => setTags(e.target.value)}
                    placeholder="sale, autumn"
                  />
                </Field>
                <Field label="Language" htmlFor="post-language">
                  <select
                    id="post-language"
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                  >
                    <option value="">Not set</option>
                    {LANGUAGES.map(([code, name]) => (
                      <option key={code} value={code}>
                        {name}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            </div>
          </Card>
          <Card>
            <div className="stack-small">
              <div className="row row-between small">
                <span>Size {kilobytes(size.bytes)} of 1,024 KB</span>
                {!size.fits && (
                  <span className="field-error" style={{ margin: 0 }}>
                    Over the 1 MB limit
                  </span>
                )}
              </div>
              <div
                className="meter"
                data-tone={!size.fits ? 'danger' : ratio > 0.8 ? 'warn' : undefined}
              >
                <span className="meter-fill" style={{ width: `${ratio * 100}%` }} />
              </div>
              <ErrorText error={publish.error ?? save.error} />
              <div className="form-actions">
                <Button type="submit" variant="hardware" busy={publish.busy} disabled={!size.fits}>
                  <PasskeyIcon />
                  {editing ? 'Sign and update' : 'Sign and publish'}
                </Button>
                {!editing && (
                  <Button variant="quiet" busy={save.busy} onClick={() => void save.run()}>
                    Save draft
                  </Button>
                )}
                {savedAt && (
                  <span className="muted small">Draft saved {formatDateTime(savedAt)}</span>
                )}
              </div>
              <p className="muted tiny" style={{ margin: 0 }}>
                One passkey prompt unlocks your key, signs this post and any pending signatures, and
                erases the key again.
              </p>
            </div>
          </Card>
        </form>
        <aside className="editor-preview" aria-label="Preview">
          <p>Subscriber preview</p>
          <div className="phone">
            <div className="phone-screen">
              <div className="phone-bar">
                {company.logo && <img className="logo" src={company.logo} alt="" />}
                <div>
                  {company.name}
                  <small>{channelInfo?.displayName ?? channel}</small>
                </div>
              </div>
              {preview.image && <img className="article-hero" src={preview.image} alt="" />}
              <article className="article">
                <h2>{preview.title || 'Untitled post'}</h2>
                <div className="article-meta">
                  <span className="article-date">{formatDate(preview.date_published)}</span>
                  {preview.tags?.map((tag) => (
                    <span key={tag} className="chip">
                      {tag}
                    </span>
                  ))}
                </div>
                <div
                  className="article-body"
                  // biome-ignore lint/security/noDangerouslySetInnerHtml: content_html is already run through the subscriber app's sanitizer
                  dangerouslySetInnerHTML={{ __html: preview.content_html }}
                />
              </article>
            </div>
          </div>
        </aside>
      </div>
    </Page>
  )
}
