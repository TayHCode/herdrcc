# Architecture

One Node process serves a React app and a small JSON API on `127.0.0.1`.

```
browser ── (tailscale serve, HTTPS, tailnet only) ──> 127.0.0.1:PORT
                                                      │
        src/server/app.ts    host/origin checks, auth (launch key or paired device)
        src/server/live.ts   /api/v2 routes; HerdrLive runs the `herdr` CLI
        src/server/chat.ts   reads Codex/Claude session logs into chat messages
        src/server/devices.ts pairing codes and hashed device tokens
        src/server/demo.ts   the same interface with made-up agents
        src/server/cli.ts    commands: run, pair, install-service, --remote
        src/client/          React app (no router or state library beyond TanStack Query)
```

## Data flow

- **State:** `herdr api snapshot` every two seconds gives workspaces, tabs and
  agents with their status. Nothing is cached on disk.
- **Terminal:** `herdr agent read <pane>` gives the screen text.
- **Chat:** the agent's session id (from the snapshot) locates its Codex or
  Claude log; the tail of the file is parsed into messages, with tool calls
  collapsed into "worked" steps. If no log is found the UI shows the terminal.
- **Writes:** `herdr agent prompt`, `herdr agent send-keys` (allowlisted keys),
  `herdr agent rename`, `herdr pane close`. Each is a POST that needs auth.

## Herdr contract

Built against Herdr 0.9.x (`herdr api schema`: schema 1, protocol 22). Commands
used: `api snapshot`, `agent read|prompt|send-keys|rename`, `pane close`,
`--version`. A different Herdr version may work; if a field is missing the UI
shows what it has.

## Remote access

`--remote` asks `tailscale serve` to proxy an HTTPS port on the tailnet name to
the local port. A request is accepted over that path only if its Host equals the
configured tailnet host, it comes from loopback (the proxy), and it carries a
paired-device cookie. See [SECURITY.md](../SECURITY.md).

## Design notes

- Status vocabulary: Needs you (blocked), Finished (a turn ended, not
  necessarily successfully), Working, Idle, Unknown.
- All colors, type and spacing are CSS custom properties in
  `src/client/styles/tokens.css`; light and dark themes override the same names.
