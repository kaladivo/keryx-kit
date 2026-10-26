import {
  ChannelName,
  Expires,
  Item,
  KeyId,
  PublicKeyHex,
  Rfc3339,
  Sha256Hex,
  Signature,
} from '@keryx-kit/domain'
import { Schema } from 'effect'
import {
  AuthorKeyLabel,
  Base64url,
  CompanySlug,
  Email,
  Id,
  IdentityPublicKey,
  IdentitySignature,
  Instant,
  JoinOrigin,
  LogoDataUrl,
} from './values.ts'
import { WrappedKey } from './webauthn.ts'

const Text = (max: number) => Schema.String.check(Schema.isMaxLength(max))
const Name = Text(200).check(Schema.isNonEmpty())

export const ItemId = Item.fields.id

export const ItemRef = Schema.Struct({ id: ItemId, title: Schema.String })

// Owner login and sign-up (SLIP-0013, docs/spikes.md)

/** Pass `challengeHidden` and `challengeVisual` to Trezor `requestLogin` unchanged. */
export const TrezorChallenge = Schema.Struct({
  challengeHidden: Sha256Hex,
  challengeVisual: Schema.String,
})

export const LoginChallenge = Schema.Struct({ challengeId: Id, ...TrezorChallenge.fields })

/** `requestLogin` result: the identity key for the console origin and its signature. */
export const TrezorLogin = Schema.Struct({
  publicKey: IdentityPublicKey,
  signature: IdentitySignature,
})

export const OwnerLogin = Schema.Struct({ challengeId: Id, ...TrezorLogin.fields })

export const CompanyRef = Schema.Struct({ slug: CompanySlug, name: Schema.String })

export const OwnerAccount = Schema.Struct({ company: CompanyRef })

export const SignupRequest = Schema.Struct({
  inviteCode: Text(100).check(Schema.isNonEmpty()),
  slug: CompanySlug,
  companyName: Name,
  joinOrigin: JoinOrigin,
  logo: Schema.optionalKey(LogoDataUrl),
  /** For the operator only, never used for login. */
  contactEmail: Email,
})

/**
 * Everything the browser needs to build `root.json` v1 and `targets.json` v1 itself:
 * `initRepo({ ...init.params, masterKey }, { now: new Date(init.now) })`.
 */
export const SignupStarted = Schema.Struct({
  signupId: Id,
  challenge: TrezorChallenge,
  init: Schema.Struct({
    now: Instant,
    params: Schema.Struct({
      repoBase: Schema.String,
      companyName: Schema.String,
      logo: Schema.optionalKey(LogoDataUrl),
      /** The ops key the server generated for this company. */
      opsKey: PublicKeyHex,
    }),
  }),
  expiresAt: Instant,
})

export const CompleteSignup = Schema.Struct({
  /** `requestLogin` over `SignupStarted.challenge`; becomes the owner's login. */
  login: TrezorLogin,
  masterPublicKey: PublicKeyHex,
  signatures: Schema.Struct({ root: Signature, targets: Signature }),
})

// Company

/** mvp-spec A4. `reason` explains a `mismatch`. */
export const DomainCheck = Schema.Struct({
  status: Schema.Literals(['not-set-up', 'mismatch', 'live']),
  reason: Schema.optionalKey(Schema.String),
  checkedAt: Schema.optionalKey(Instant),
})

export const Company = Schema.Struct({
  slug: CompanySlug,
  name: Schema.String,
  logo: Schema.optionalKey(Schema.String),
  joinOrigin: JoinOrigin,
  /** `custom.repo_base`, `https://repo.<service>/<slug>/`. */
  repoBase: Schema.String,
  domain: DomainCheck,
  /** For the E3 banner at 60, 30 and 7 days. */
  targetsExpires: Expires,
})

export const AuditEntry = Schema.Struct({
  at: Instant,
  actor: Schema.Struct({
    kind: Schema.Literals(['owner', 'member', 'server']),
    memberId: Schema.optionalKey(Id),
    name: Schema.optionalKey(Schema.String),
  }),
  action: Schema.Literals([
    'signup',
    'ceremony-started',
    'ceremony-staged',
    'ceremony-applied',
    'ceremony-discarded',
    'authors-signed',
    'items-resigned',
    'item-published',
    'item-edited',
    'item-unpublished',
    'invite-created',
    'member-registered',
  ]),
  summary: Schema.String,
  /** Metadata versions written by this entry, by file name (e.g. `targets.json`: 4). */
  versions: Schema.Record(Schema.String, Schema.Int),
})

// Team

export const Member = Schema.Struct({
  id: Id,
  /** Shown in the console only; public metadata carries `keyLabel`. */
  name: Schema.String,
  keyLabel: AuthorKeyLabel,
  keyid: KeyId,
  authorPublicKey: PublicKeyHex,
  registeredAt: Instant,
  /** Channels whose live authors role lists this member. */
  channels: Schema.Array(ChannelName),
})

export const PendingInvite = Schema.Struct({
  id: Id,
  label: Schema.String,
  createdAt: Instant,
  expiresAt: Instant,
})

export const Team = Schema.Struct({
  members: Schema.Array(Member),
  invites: Schema.Array(PendingInvite),
})

export const CreateInvite = Schema.Struct({ label: Text(100) })

/** `url` (`https://console.<service>/invite#<token>`) is only returned here. */
export const Invite = Schema.Struct({ ...PendingInvite.fields, url: Schema.String })

export const InvitePreview = Schema.Struct({ companyName: Schema.String, expiresAt: Instant })

/** The logged-in member. `credentialIds` can go in `allowCredentials` as a hint only. */
export const Me = Schema.Struct({
  ...Member.fields,
  company: CompanyRef,
  credentialIds: Schema.Array(Base64url),
})

/**
 * The author key wrapped for one passkey. A site can hold several passkeys and a
 * discoverable assertion may return any of them, so the console fetches this by the
 * credential id the assertion returned (mvp-spec §5.4).
 */
export const WrappedAuthorKey = Schema.Struct({
  credentialId: Base64url,
  authorPublicKey: PublicKeyHex,
  wrappedKey: WrappedKey,
})

// Channels and items

/** A member as a signer: `name` is shown in the console only, `keyLabel` is public. */
export const AuthorRef = Schema.Struct({
  memberId: Id,
  name: Schema.String,
  keyLabel: AuthorKeyLabel,
  keyid: KeyId,
})

export const Channel = Schema.Struct({
  name: ChannelName,
  displayName: Schema.String,
  description: Schema.String,
  /** `waiting-for-author`: staged until an author signs `channels.<c>.authors.json` v1. */
  status: Schema.Literals(['live', 'waiting-for-author']),
  authors: Schema.Array(AuthorRef),
  authorsExpires: Schema.optionalKey(Expires),
  itemCount: Schema.Int,
})

/** The editor state (mvp-spec C1); `markdown` is converted to `content_html` in the browser. */
export const DraftContent = Schema.Struct({
  itemId: Schema.String,
  title: Schema.String,
  markdown: Schema.String,
  image: Schema.optionalKey(Schema.String),
  tags: Schema.Array(Schema.String),
  language: Schema.optionalKey(Schema.String),
})

export const SaveDraft = Schema.Struct({ channel: ChannelName, content: DraftContent })

export const Draft = Schema.Struct({ id: Id, ...SaveDraft.fields, updatedAt: Instant })

export const ItemSummary = Schema.Struct({
  id: ItemId,
  title: Schema.String,
  datePublished: Rfc3339,
  dateModified: Schema.optionalKey(Rfc3339),
  signedBy: Schema.Array(AuthorRef),
})

export const PublishedItem = Schema.Struct({
  channel: ChannelName,
  item: Item,
  /** The editor state it was published from, so an edit (C4) starts from Markdown. */
  source: Schema.optionalKey(DraftContent),
  signedBy: Schema.Array(AuthorRef),
})

/** `item` carries the publishing author's signature in `sig`. */
export const PublishItem = Schema.Struct({
  item: Item,
  source: Schema.optionalKey(DraftContent),
  /** Deleted once the item is live. */
  draftId: Schema.optionalKey(Id),
})

// Operator

export const OperatorLogin = Schema.Struct({ token: Schema.String })

export const CreateInviteCode = Schema.Struct({ note: Text(200) })

export const InviteCode = Schema.Struct({
  code: Schema.String,
  note: Schema.String,
  createdAt: Instant,
  usedAt: Schema.optionalKey(Instant),
  usedBy: Schema.optionalKey(CompanySlug),
})

export const CompanyStatus = Schema.Struct({
  slug: CompanySlug,
  name: Schema.String,
  joinOrigin: JoinOrigin,
  contactEmail: Schema.String,
  createdAt: Instant,
  domain: DomainCheck,
  lastTimestampAt: Schema.optionalKey(Instant),
  expires: Schema.Struct({
    root: Expires,
    targets: Expires,
    snapshot: Expires,
    timestamp: Expires,
    channels: Schema.Array(
      Schema.Struct({ channel: ChannelName, channelMetadata: Expires, authorsMetadata: Expires }),
    ),
  }),
})

export const Dashboard = Schema.Struct({ companies: Schema.Array(CompanyStatus) })

// Landing page (G2). Field rules live in the handler so 400s carry readable sentences.

export const PilotRequest = Schema.Struct({
  company: Schema.String,
  name: Schema.String,
  email: Schema.String,
  message: Schema.String,
})

export const PilotRequestRecord = Schema.Struct({
  id: Id,
  ...PilotRequest.fields,
  createdAt: Instant,
})

/**
 * The running release (mvp-spec §5.9): the git commit and the SHA-256 of the console
 * bundle manifest (`sha256  path` lines of every built console file, sorted by path).
 */
export const Release = Schema.Struct({
  gitSha: Schema.String,
  consoleBundleSha256: Schema.String,
})
