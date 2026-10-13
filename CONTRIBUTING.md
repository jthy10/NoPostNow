# Contributing

Thank you for helping improve NoPostNow.

## Before opening a change

- Search existing issues and pull requests.
- Discuss large behavior, data-model, or dependency changes in an issue first.
- Report security vulnerabilities privately as described in `SECURITY.md`.
- Do not submit secrets, private user data, or anything from a real site's
  data folder.

## Development

1. Fork the repository and create a focused branch.
2. Run `npm install`.
3. Run `npm run setup` to create a local test site, then `npm run dev`.
   Use a throwaway data folder, never a real site's.
4. Make the smallest coherent change and add documentation where needed.
5. Run `npm run check`.

## Pull requests

Explain what changed, why it changed, how it was tested, and any security,
privacy, access-rule, or data-format impact. Screenshots are useful for visual
changes, but remove personal information first.

By contributing, you agree that your contribution is licensed under the MIT
License.
