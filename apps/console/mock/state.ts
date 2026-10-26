/** In-memory state of the dev mock API. Nothing here ships in the console bundle. */
import type {
  AuditEntry,
  DomainCheck,
  DraftContent,
  Intent,
  InviteCode,
  Operation,
  PilotRequestRecord,
  SignupRequest,
} from '@keryx-kit/api'
import type { Repo, Signature } from '@keryx-kit/domain'

export interface MockMember {
  readonly id: string
  readonly name: string
  readonly keyLabel: string
  readonly keyid: string
  readonly authorPublicKey: string
  readonly registeredAt: string
  readonly passkeys: ReadonlyArray<{
    readonly credentialId: string
    readonly iv: string
    readonly ciphertext: string
  }>
}

export interface MockInvite {
  readonly id: string
  readonly token: string
  readonly label: string
  readonly createdAt: string
  readonly expiresAt: string
  used: boolean
}

export interface MockCeremony {
  readonly id: string
  readonly intent: Intent
  readonly operation: Operation
  readonly summary: string
  status: 'awaiting-owner' | 'staged' | 'applied' | 'discarded'
  ownerSignatures: ReadonlyArray<{
    readonly role: 'root' | 'targets'
    readonly signature: Signature
  }>
  authorsSignature?: Signature
  /** Authors-file issues that keep a staged change from applying. */
  missingFiles: ReadonlyArray<string>
  readonly createdAt: string
  updatedAt: string
}

export interface MockDraft {
  readonly id: string
  readonly memberId: string
  channel: string
  content: typeof DraftContent.Type
  updatedAt: string
}

export interface MockCompany {
  readonly slug: string
  readonly joinOrigin: string
  readonly contactEmail: string
  readonly createdAt: string
  readonly identityKey: string
  readonly opsSeed: Uint8Array
  readonly channelSeeds: Record<string, Uint8Array>
  repo: Repo
  domain: typeof DomainCheck.Type
  lastTimestampAt: string
  members: Array<MockMember>
  invites: Array<MockInvite>
  ceremonies: Array<MockCeremony>
  drafts: Array<MockDraft>
  audit: Array<typeof AuditEntry.Type>
  /** Editor state each published item came from, by target path. */
  sources: Record<string, typeof DraftContent.Type>
}

export type Session =
  | { readonly kind: 'owner'; readonly slug: string }
  | { readonly kind: 'member'; readonly slug: string; readonly memberId: string }
  | { readonly kind: 'operator' }

export interface MockState {
  readonly companies: Map<string, MockCompany>
  readonly sessions: Map<string, Session>
  readonly signups: Map<
    string,
    {
      readonly request: typeof SignupRequest.Type
      readonly opsSeed: Uint8Array
      readonly now: string
      readonly repoBase: string
    }
  >
  readonly ownerChallenges: Map<string, string>
  readonly registrations: Map<
    string,
    { readonly slug: string; readonly inviteToken: string; readonly name: string }
  >
  /** Operations handed out with author tasks, so completion rebuilds the same bytes. */
  readonly taskOperations: Map<string, Operation>
  readonly inviteCodes: Array<typeof InviteCode.Type>
  readonly pilotRequests: Array<typeof PilotRequestRecord.Type>
  readonly operatorToken: string
}

export const emptyState = (): MockState => ({
  companies: new Map(),
  sessions: new Map(),
  signups: new Map(),
  ownerChallenges: new Map(),
  registrations: new Map(),
  taskOperations: new Map(),
  inviteCodes: [],
  pilotRequests: [],
  operatorToken: 'operator-demo-token',
})
