# NoPostNow

[![CI](https://github.com/jthy10/nopostnow/actions/workflows/ci.yml/badge.svg)](https://github.com/jthy10/nopostnow/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A private photo feed for you and your friends, running on a computer you own.

No algorithm, no ads, no strangers, and no cloud account to sign up for. One
command sets it up; your photos stay in a folder you choose.

## What you get

- One shared, chronological feed: photos, captions, likes, comments, @mentions
- Direct messages, a notification bell, and push notifications
- Installs to a phone's Home Screen like an app (no app store)
- Profiles with posting streaks and a likes podium
- Blocking, data export, and account deletion for every member
- An admin console: invites, moderation, announcements, stats, and a private
  line between members and the admins
- An optional "daily moment" — a reminder at a time you pick, with a badge for
  photos posted on that exact minute
- Your own name and accent colour

## Quick start

You need a computer that stays on (a spare PC, a mini PC, a home server) with
Linux, macOS or Windows. [Download the code](https://github.com/jthy10/nopostnow/archive/refs/heads/main.zip)
or clone it, then run the launcher from that folder:

**Linux / macOS**

```bash
./nopostnow.sh
```

**Windows** — double-click `nopostnow.cmd`, or in a terminal:

```
.\nopostnow.cmd
```

The first run walks you through setup — the site's name and colour, where the
photos are stored, the address and port, and your admin account — then starts
the site. If Node.js isn't installed, the launcher downloads an official copy
into the folder for its own use.

Already have Node.js 22.18 or newer? The same thing by hand:

```bash
npm ci
npm run setup
npm run build
npm start
```

Then open the address it prints (by default <http://localhost:3000>).

## Getting it online

Out of the box the site is reachable from your own network. To let friends in
from anywhere — and to let phones install it and receive notifications — it
needs a public `https://` address. The easiest way is a free Cloudflare Tunnel,
which needs no router changes. **[docs/GOING-ONLINE.md](docs/GOING-ONLINE.md)**
has step-by-step instructions.

## Day to day

| Task | Command |
| --- | --- |
| Start the site | `./nopostnow.sh` or `npm start` |
| Change the name, port, data folder… | `./nopostnow.sh setup` or `npm run setup` |
| List accounts | `npm run users -- list` |
| Make an invite link | `npm run users -- invite` (or Admin → Members) |
| Someone forgot their password | `npm run users -- reset their@email` (or Admin → Members) |
| Locked out of the only admin account | `npm run users -- reset your@email` |

The site sends no email. Invites and password resets are links that you pass
along yourself.

### Backups

Everything — photos, accounts, settings — is in the data folder you chose
during setup (`data/` by default). Copy that folder somewhere safe on a
schedule. To move to a new machine, copy the folder across and point setup at
it.

### Updating

Get the new code (`git pull`, or download and replace the files, keeping your
data folder), then run `npm ci` and `npm run build`, and start it again.

## How it works

NoPostNow is a [Next.js](https://nextjs.org) app with its own small server
side. There are no outside services:

- **Data** — one SQLite file (`nopostnow.db`), using the SQLite built into
  Node.js. Nothing to install or administer.
- **Photos** — plain files under `files/` in the data folder, served only to
  signed-in members.
- **Accounts** — email and password, stored as scrypt hashes, with cookie
  sessions and optional authenticator-app two-factor sign-in.
- **Access control** — every read and write is checked on the server by
  [`server/rules.ts`](server/rules.ts).
- **Settings** — `config.json` in the data folder, written by the setup wizard.

See [SECURITY.md](SECURITY.md) for the security model and advice for hosts.

## Development

```bash
npm ci
npm run setup   # create a local test site
npm run dev     # run with live reload
npm run check   # lint, typecheck, tests, production build
```

Contributions are welcome — read [CONTRIBUTING.md](CONTRIBUTING.md) and the
[Code of Conduct](CODE_OF_CONDUCT.md) first.

## License

[MIT](LICENSE)
