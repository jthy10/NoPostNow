# Contributing

Thank you for helping improve NoPostNow.

## Before you start

- Search existing issues and pull requests.
- Open an issue first for large changes to behavior, data or dependencies.
- Report security problems privately. See [SECURITY.md](SECURITY.md).
- Never submit secrets, private user data, or anything from a real site's
  data folder.

## Making a change

Needs Node.js 22.18 or newer.

1. Fork the repository and create a branch.
2. `npm ci`
3. `npm run setup` to create a test site. Use a throwaway data folder.
4. `npm run dev` and make your change. Keep it small and focused.
5. `npm run check` (lint, typecheck, tests, build) and `npm run test:e2e`.

## Pull requests

Say what changed, why, and how you tested it. Mention any effect on security,
privacy, access rules or stored data. Screenshots help for visual changes;
remove personal information first.

Contributions are licensed under the [MIT License](LICENSE).
