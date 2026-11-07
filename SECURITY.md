# Security policy

Slabwatch is a study project. It runs only on Solana devnet with test tokens that have no value, it has no mainnet code path, and it has not been audited.

## Supported versions

Only the latest commit on `main`, and the live demo deployed from it, get security fixes.

## Reporting a vulnerability

Please report it privately through GitHub: open the [Security tab](https://github.com/ozykhan/rarible-study/security) and choose **Report a vulnerability**, or go straight to the [private report form](https://github.com/ozykhan/rarible-study/security/advisories/new). Do not open a public issue or pull request about it.

A useful report says what you found, how to reproduce it, and what an attacker could do with it.

I aim to reply within 7 days. This is a one-person project, so fixes are best effort. If you like, I will credit you in the published advisory.

## Scope

In scope: the code in this repository and the [live demo](README.md#live-demo). Examples of what I want to hear about:

- The agent buying outside a watch rule's limits, or a purchase that skips a check done in code.
- Spending another wallet's allowance, or replaying or forging a signature.
- Getting around the rate limits, the read-only demo mode or the daily model spend cap.
- Reading secrets, other users' data or the MCP bearer tokens.
- Prompt injection through seller text that changes what the agent or the matcher does.

Out of scope:

- Load tests, denial of service by volume, and automated scanners run against the live demo. Please do not run them.
- Problems in third-party services (GitHub, Vercel, Railway, Solana devnet). Report those to the service.
- Reports that only say devnet tokens have no value, or that the demo is not production ready. Both are true by design.

## How this repository is protected

- Secrets live only in `.env` (git-ignored) or the hosting platform's environment. gitleaks scans every commit in a pre-commit hook and in CI, and GitHub secret scanning with push protection is on.
- CodeQL analyzes the TypeScript, the Python script and the GitHub Actions workflows on every pull request, every push to `main` and once a week.
- Dependabot alerts and security updates are on. Version updates come monthly, and a new npm release waits 7 days before it is proposed.
- Workflows run with a read-only token, and every action is pinned to a commit SHA.
- `main` changes only through pull requests that pass CI. Force pushes and deleting `main` are blocked.
- The app's own limits (spend caps, rate limits, one-time signatures, checks in code before every purchase) are listed under [Guardrails](README.md#guardrails).
