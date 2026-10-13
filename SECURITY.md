# Security Policy

## Supported versions

Security fixes are applied to the latest commit on the `main` branch.

## Reporting a vulnerability

Do not open a public issue, discussion, or pull request for a suspected
vulnerability.

Use GitHub's private vulnerability reporting form:

https://github.com/jthy10/nopostnow/security/advisories/new

Include the affected component, reproduction steps, impact, and any suggested
mitigation. Remove real credentials and private user content from the report.
You should receive an acknowledgment within seven days.

## What must stay private

Everything sensitive about an install lives in its data folder, which is never
part of this repository:

- `config.json` — holds the push-notification signing key
- `nopostnow.db` — accounts, password hashes, sessions, messages
- `files/` — members' photos

Never attach these to an issue or commit them. The repository's `.gitignore`
excludes the default `data/` folder and the `nopostnow.json` pointer file.

## How the software protects a site

- Passwords are stored as salted scrypt hashes. Sessions are random tokens
  kept in an HttpOnly cookie; only their hash is stored.
- Every read and write is authorized on the server (`server/rules.ts`).
  Anything not explicitly allowed is refused.
- Photos have no public URL. Each request is checked against the session, and
  uploads are verified to be images by their content.
- Requests that change anything must come from the site's own pages.
- Admin changes require the password to have been re-entered in the last 15
  minutes, plus an authenticator code when two-factor sign-in is enabled.
- Member profiles never contain email addresses.

## Advice for hosts

- Put the site behind HTTPS (a Cloudflare Tunnel or a reverse proxy) before
  inviting anyone. See `docs/GOING-ONLINE.md`.
- Keep sign-ups on invite-only unless you have a reason not to.
- Turn on two-factor sign-in for admin accounts.
- Back up the data folder, and keep the machine and Node.js up to date.
