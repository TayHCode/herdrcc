# Security

Herdr Control Center can send messages to your coding agents, answer their
permission prompts, rename and close their panes. An agent can run commands on
your machine. **Anyone who can use Control Center can therefore run commands as
you.** Treat access to it like access to a terminal.

## Supported setup

- Control Center binds to `127.0.0.1` only.
- Other devices reach it through `tailscale serve`, which gives an HTTPS address
  visible only to your tailnet. Control Center never binds a network address
  itself, and `--remote` refuses to run if Tailscale Funnel is on for the port.
- Reverse proxies, port forwards, public hosting and other tunnels are not
  supported. Do not put it on the internet.

## How access works

- **On the machine itself:** each launch makes a random key, printed once as a
  link. The browser keeps it in memory for the tab and sends it as a bearer
  token.
- **From another device:** the key does not work. A device must pair first, using
  a one-time code (10 minutes, single use, rate limited) that someone at the host
  creates with `pair` or from Settings. Pairing sets an HttpOnly, Secure,
  SameSite=Strict cookie. The host stores only a hash of each device token, in a
  file readable only by its owner. Revoke a device in Settings and it stops
  working immediately.
- **Every request** is also checked for the expected Host, Origin and fetch
  metadata, and over Tailscale it must arrive from the local `tailscale serve`
  proxy.
- Closing a pane needs an explicit confirmation, and the server refuses it
  without one.
- Sending keys to an agent is limited to a short allowlist (Enter, Escape, Tab,
  arrows, y, n, 1, 2, 3, Ctrl-C).

## What it does not protect against

- Anyone on your tailnet who obtains a pairing link before you use it, or a
  paired phone that is stolen unlocked. Revoke lost devices.
- Malware or other users on the host, or a compromised browser.
- Anything the agents themselves do. Control Center does not sandbox them.
- Terminal output and session logs can contain secrets. Control Center shows
  them to paired devices; do not share screenshots of real sessions.

## What it stores

Paired device records (name, timestamps, token hash) in
`~/.config/herdrcc/devices.json`, and a small runtime file with the
current local key while it runs. It keeps no conversation history, telemetry or
analytics. The Archived list lives in the browser.

## Reporting a problem

Use GitHub's private vulnerability reporting on this repository if it is
enabled. Otherwise open an issue that describes the problem without including
exploit details or real session data. This project may not be actively
maintained, so there is no promised response time.
