# Contributing to Warden

Thanks for your interest in contributing. Warden is a security layer for AI agents — we take code quality and review seriously.

## Development Setup

```bash
# Clone and enter the repo
git clone https://github.com/wardenlabs/warden.git
cd warden

# Install dependencies
npm install

# Verify TypeScript strict mode (must exit 0)
npx tsc --noEmit

# Run the full test suite (must pass with no failures)
npx vitest run
```

If either command fails, your environment is not set up correctly. Fix any errors before making changes.

### Running Specific Tests

```bash
# Core enforcement logic (unit tests)
npx vitest run packages/core/tests/

# Hook server (integration tests)
npx vitest run packages/hook-server/tests/

# MCP gateway
npx vitest run packages/mcp-gateway/tests/
```

## Code Standards

These are **hard requirements**. PRs that violate them will not be merged.

### TypeScript

- **Strict mode only.** No `any`, no implicit returns, no unchecked index access. The `tsconfig.json` enforces this — `npx tsc --noEmit` must exit 0.
- **Explicit types on public APIs.** Every exported function, class, and method must have explicit parameter and return types.
- **No implicit type assertions.** Use explicit type guards; never cast through `unknown` or `any` to bypass the type system.

### File Naming

- All files use **kebab-case**: `hook-server.ts`, `supply-chain.test.ts`, `pre-tool-use.ts`.
- Exceptions: `index.ts` entry points, `AGENTS.md`, and config files at the root.

### Dependencies

- **Do not add new dependencies without prior discussion.** The tech stack is locked (see `AGENTS.md`). If you need a library not already in `package.json`, open an issue first explaining why the existing stack cannot solve the problem.
- All dependencies are workspace-level. Do not add package-specific `package.json` dependencies unless approved.

### Testing

- **Every module needs tests.** A new module in `packages/core/src/` must have a corresponding `packages/core/tests/` file.
- Test file naming: `module-name.test.ts` mirrors `module-name.ts`.
- Tests must cover: happy path, edge cases, error conditions, and boundary values.
- Run `npx vitest run` before committing — any failing test blocks merge.

### Architecture

- Follow the implementation order in `docs/internal/planV2.md`. Do not introduce forward dependencies.
- Respect the 10 architectural invariants (see `README.md`). DENY is always the default.
- Policy engine and hook handlers are **pure deterministic code** — no LLM calls in the security path.

## Pull Request Process

1. **Fork** the repo and create a branch from `main`:
   ```bash
   git checkout -b your-feature
   ```

2. **Make your changes.** Follow the code standards above.

3. **Verify before pushing:**
   ```bash
   npx tsc --noEmit        # Must exit 0
   npx vitest run          # Must pass with no failures
   ```

4. **Write a clear PR description.** Include:
   - What the change does
   - Why it's needed
   - Any breaking changes or configuration updates
   - How you verified it (test output, manual testing steps)

5. **Open the PR** against `main`. The CI will run typecheck and tests automatically.

6. **One approval required.** A maintainer must review and approve before merge. The reviewer follows a two-stage process:
   - Stage 1: spec compliance (does it match `docs/internal/planV2.md`?)
   - Stage 2: code quality (standards, tests, architecture)

7. **Merge.** Once approved and CI is green, a maintainer will merge.

## Reporting Security Issues

**Do NOT open a public issue for security vulnerabilities.**

Email [chuck.contactme@gmail.com](mailto:chuck.contactme@gmail.com) with:

- A clear description of the vulnerability
- Steps to reproduce
- Affected versions (if known)
- Any suggested fixes (optional)

You will receive a response within 48 hours. We follow coordinated disclosure:

1. Acknowledge receipt within 48 hours
2. Confirm and assess severity within 5 business days
3. Patch and release — target is 30 days for non-critical, 7 days for critical
4. Public disclosure after the patch is released

We appreciate responsible disclosure and will credit reporters (with permission) in release notes.

## Code of Conduct

- **Be respectful.** Disagreement is fine; personal attacks are not.
- **Be constructive.** Critique the code, not the person. Offer alternatives, not just complaints.
- **Assume good intent.** Everyone is here to build something useful. Start from that assumption.
- **No gatekeeping.** Questions are welcome. "RTFM" is not a helpful answer.

Violations may result in temporary or permanent removal from the project at maintainer discretion.

## Questions?

Open a [GitHub Discussion](https://github.com/wardenlabs/warden/discussions) for general questions. For bugs or feature requests, use [Issues](https://github.com/wardenlabs/warden/issues).
