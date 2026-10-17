# Contributing to Keylink

Keylink is a small authentication service. Changes should stay boring in the crypto and obvious in the interface.

## Setup

You need Node.js 22 or newer and pnpm 10. Python 3.9 or newer is only required for the Python SDK tests.

```bash
pnpm install
pnpm build
pnpm test
```

Run the server and the Fieldnote demo together:

```bash
export KEYLINK_MASTER_KEY="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
export KEYLINK_ADMIN_PASSWORD="a-local-password"
export KEYLINK_BOOTSTRAP_APP="Fieldnote"
export KEYLINK_BOOTSTRAP_ORIGINS="http://localhost:4781"
export KEYLINK_API_KEY_FILE="./data/bootstrap-api-key"
pnpm dev
```

- Console: http://localhost:4780/admin
- Demo: http://localhost:4781

## Layout

- `packages/server` — HTTP API, admin console, TOTP, backup codes
- `packages/widget` — browser widget (script tag and npm)
- `packages/sdk` — Node.js server SDK
- `packages/sdk-python` — Python server SDK
- `packages/demo` — Fieldnote, a minimal host application

## Tests

`pnpm test` runs the Node test runner and the Python unittest suite. Crypto changes need a vector in `packages/server/src/crypto/totp.test.ts` or an API test that enrolls and verifies a real code. Do not weaken replay protection, lockout, or hashing to make a test pass.

## Pull requests

Keep a pull request to one change. Explain the user-visible effect and how you tested it. Do not commit `.env` files, database files, or generated API keys.

## Security

Keylink stores authenticator secrets. If you find a vulnerability, open a private security advisory on the repository rather than a public issue. Include a reproduction and the version you tested.

Please do not file vulnerabilities for the development defaults (`dev-admin-password` and the development master key). Those are refused when `NODE_ENV=production` unless you set them yourself.
