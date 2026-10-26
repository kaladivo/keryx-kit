import { sha256 } from '@noble/hashes/sha2.js'
import { publicKeyFromSeed, seedSigner, utf8 } from '../src/index.ts'

/** The same deterministic seeds the Go golden program uses. */
export const seedOf = (name: string): Uint8Array => sha256(utf8(`keryx-golden/${name}`))
export const signerOf = (name: string) => seedSigner(seedOf(name))
export const publicOf = (name: string) => publicKeyFromSeed(seedOf(name))
export const authorKey = (name: string) => ({ publicKey: publicOf(name), name })
