# keryx-kit

A hosted publisher service for [Keryx](https://github.com/v1b3coder/keryx): signed,
one-way announcements from a company to its customers. Companies sign up, keep their
master key on a Trezor, and their team publishes from the browser with passkeys.

- Product spec: [`docs/mvp-spec.md`](docs/mvp-spec.md)
- Protocol: [`vendor/keryx/spec`](https://github.com/v1b3coder/keryx/tree/main/spec)

## Development

Requires Bun and Go (for the conformance check).

```
git submodule update --init
bun install
bun run lint && bun run typecheck && bun run test && bun run conformance
```

## License

GPL-3.0, see [LICENSE](LICENSE).
