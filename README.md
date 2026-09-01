# ReviewKit

**Pull requests for agent actions.**

Agents write to CRMs, send mail, and change production config. A yes/no button is not a review. ReviewKit turns an intended write into a versioned, hash-bound Action Proposal. The host executes. ReviewKit does not.

## Packages

- `@reviewkit/core` — types, SHA-256 hash, state machines, idempotency, local store. No network.
- `@reviewkit/react` — ActionReview UI: detail, list/batch, diffs, approve/edit/reject/defer, results. CSS vars, dark mode, i18n, a11y.
- Renderers: JSON field-level, Text line/word, Table row/cell.

## Quick start
Install dependencies, run tests, then start the example app (scripts: test and quickstart).

Host API: ActionReview with proposal, renderers, onDecision, onRequestExecution.

## Security boundary

ReviewKit shows diffs and binds a Decision to proposal id, version, and content hash. The host authenticates, holds credentials, and executes. Agent HTML and scripts are never executed. Core never sends business data to a network. Edit any execution field and you get a new version and hash; old approvals cannot run the new version. Duplicate decisions do not second-execute. Source version drift invalidates the proposal.

## Stack

TypeScript 5 strict, React 19, Vite example, tsdown builds, ArkType, Biome, Vitest, TanStack Virtual, CSS variables, Changesets (unpublished).

## License

MIT. Product spec lives in docs/PRD.md.
