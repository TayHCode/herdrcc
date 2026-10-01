# Contributing

This project may not be actively maintained. Small, well-tested fixes are the
most likely to be merged; feel free to fork.

- Keep Herdr authoritative. Control Center talks to agents only through the
  `herdr` command, and does not keep its own tasks or history.
- Be careful with anything that writes. It changes real sessions, so keep new
  write actions behind confirmation and covered by tests.
- Show unknown or missing data honestly. Chat depends on unofficial Codex and
  Claude Code log formats, so parsers must tolerate surprises and fall back to
  the terminal view.
- Keep fixtures and screenshots synthetic. Never commit real sessions, paths,
  hostnames or keys. Screenshots come from `--demo`.

```sh
npm ci
npm run typecheck
npm test
npm run build
```

Add tests for behavior you change. `tests/security.test.ts` and
`tests/pairing.test.ts` cover the trust boundary; do not weaken them.
