# keryx-kit

Hosted publisher service for the Keryx protocol. Product spec: `docs/mvp-spec.md`.
Protocol spec: `vendor/keryx/spec/` (normative; it wins over `docs/mvp-spec.md`).
`vendor/keryx` is a pinned submodule: read it, port from it, never edit it.

## Conventions

- pnpm for dependencies, Bun as the server runtime. Internal packages are consumed as
  TypeScript source (`exports` points at `src/index.ts`), so there is no build step between them.
- Effect 4 (`effect@4.x`). Its API differs from Effect 3, and HTTP lives in `effect/http` and
  `effect/http-api`. Look up signatures in `node_modules/effect/src` before writing Effect code.
- Strict TypeScript. Use `unknown` plus a Schema decode where a type is not known.
- Code explains itself through names and small functions. Comments only explain the
  unidiomatic, briefly.

## Crypto invariants

- Canonical JSON, keyids, signing and metadata building live only in `packages/domain`.
  Other packages import them.
- Master and author private keys exist only in the browser, only for one signing operation.
  Server APIs carry public keys and signatures.
- Every repo the TypeScript code writes must pass `pnpm conformance` (the Go SDK in
  `vendor/keryx/sdk` verifies it).

## Done

`pnpm lint && pnpm typecheck && pnpm test && pnpm conformance` all pass.
