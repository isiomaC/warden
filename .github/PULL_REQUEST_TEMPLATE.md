## What does this PR do?

<!-- Short description of the change and why it's needed. Link related issues. -->

## Checklist

- [ ] `npx tsc --noEmit` passes (zero errors)
- [ ] `npx vitest run` passes (every enforcement path must have a test — see docs/TESTING.md)
- [ ] New behavior fails **closed** (errors/timeouts result in DENY, never ALLOW)
- [ ] No LLM calls added to the security path
- [ ] Docs updated if config, CLI, or API surface changed

## Security-relevant?

<!-- If this touches policy evaluation, trust tagging, the ledger, the vault,
     path/tool allowlists, or auth: describe the threat model impact. -->
