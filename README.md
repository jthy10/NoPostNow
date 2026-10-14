# NoPostNow

[![CI](https://github.com/jthy10/nopostnow/actions/workflows/ci.yml/badge.svg)](https://github.com/jthy10/nopostnow/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A private photo feed for you and your friends, running on a computer you own.

No algorithm, no ads, no strangers, no cloud account. One command sets it up,
and your photos stay in a folder you choose.

- **Feed** — photos, captions, likes, comments, @mentions, in order
- **Messages** — direct messages and push notifications
- **Phone app** — installs to the Home Screen, no app store
- **Admin console** — invites, moderation, announcements, stats
- **Yours** — your own name and colour; members can export or delete their data

## Quick start

You need a computer that stays on, running Linux, macOS or Windows.

1. [Download the zip](https://github.com/jthy10/nopostnow/archive/refs/heads/main.zip)
   and unpack it, or `git clone https://github.com/jthy10/nopostnow.git`.
2. Run the launcher from that folder:

   | System | Command |
   | --- | --- |
   | Linux / macOS | `sh nopostnow.sh` |
   | Windows | double-click `nopostnow.cmd` |

3. Answer the questions in the control panel that opens: site name, where to
   keep photos, and your admin account.
4. Open the address it shows (by default <http://localhost:3000>) and sign in.

Node.js is downloaded into the folder if you don't have it. Nothing is
installed system-wide.

**No screen (SSH)?** The launcher uses a terminal wizard instead. Force it
with `sh nopostnow.sh start`.

## Invite your friends

Friends outside your home need a public `https://` address. Phones need one
too, to install the app and get notifications.

Follow **[docs/GOING-ONLINE.md](docs/GOING-ONLINE.md)**. The usual route is a
domain (about $10 a year) plus a free Cloudflare Tunnel, with no router changes.

## Commands

| Task | Command |
| --- | --- |
| Start with the control panel | `sh nopostnow.sh` |
| Start in the terminal only | `sh nopostnow.sh start` |
| Change settings | **Options** in the panel, or `sh nopostnow.sh setup` |
| List accounts | `sh nopostnow.sh users list` |
| Make an invite link | `sh nopostnow.sh users invite` |
| Reset a password | `sh nopostnow.sh users reset their@email` |
| Make someone an admin | `sh nopostnow.sh users admin their@email` |
| Lock an account out | `sh nopostnow.sh users disable their@email` |

On Windows, use `.\nopostnow.cmd` in place of `sh nopostnow.sh`.

Invite and reset links are also in the panel and under Admin → Members. The
site sends no email, so you pass these links along yourself.

## Backups and updates

- **Back up** the data folder (`data/` by default). It holds every photo,
  account and setting.
- **Move machines** by copying that folder across and pointing setup at it.
- **Update** with `git pull` (or replace the files, keeping your data folder),
  then start it again.

## How it works

A [Next.js](https://nextjs.org) app with its own small server and no outside
services. Everything lives in the data folder:

| What | Where |
| --- | --- |
| Posts, accounts, messages | `nopostnow.db`, one SQLite file |
| Photos | `files/`, served only to signed-in members |
| Deleted photos | `deleted/`, only if the admin turns on **Keep deleted photos** (off by default) |
| Settings | `config.json` |

Every read and write is checked on the server by
[`server/rules.ts`](server/rules.ts). See [SECURITY.md](SECURITY.md) for the
security model and advice for hosts.

## Development

Needs Node.js 22.18 or newer.

```bash
npm ci
npm run setup   # create a local test site
npm run dev     # run with live reload
npm run check   # lint, typecheck, tests, production build
```

[`site/`](site/) and `vercel.json` are the project website,
<https://nopostnow.com>. A self-hosted site does not use them.

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) and the
[Code of Conduct](CODE_OF_CONDUCT.md) first.

## License

[MIT](LICENSE)
