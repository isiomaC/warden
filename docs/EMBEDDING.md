# Embedding Warden

Import `createWarden` and `definePolicy` from `@stlw/warden`. The core package
does not start a server. An evaluation request supplies arbitrary typed
`subject`, `action`, `resource`, and optional `context` values.

Extensions register uniquely named conditions and resolvers. Conditions return
a deterministic boolean. A condition name may use `resolver:condition` to pass
resolved data to a condition. Resolver calls are bounded by
`resolverTimeoutMs`. Unknown registrations, exceptions, and timeouts produce a
structured DENY with reason code `EVALUATION_ERROR`.

Policies are bounded to 1,000 rules, rule identifiers must be unique, and an
empty or unmatched policy returns DENY. Existing `evaluate()` tool-policy APIs
remain available unchanged.

## Audit format

`AuditChain` accepts generic `AuditEvent` envelopes and emits entries containing
`ledgerFormatVersion`, `canonicalizationVersion`, and `hashAlgorithm`.
Version 1 recursively sorts object keys before SHA-256 hashing. Use the
storage-neutral `verifyAuditChain()` function to verify exported entries.

Persisted ledgers can construct their next entry without loading the full chain:

```typescript
import { createAuditEntry } from "@stlw/warden";

const entry = createAuditEntry(event, persistedChainHeadHash);
```

Omit the second argument only for a genesis entry. A supplied chain-head hash
must contain exactly 64 lowercase hexadecimal characters; malformed hashes
throw instead of being treated as genesis. The caller remains responsible for
serializing concurrent updates to its persisted chain head.

Hash chains detect modified, removed-middle, and reordered entries. Detecting
truncation of the final entry requires comparing the final hash or entry count
with an independently retained checkpoint.

## Approval contract

`createApprovalRequest()` records request identity, authenticated requester,
action/resource evidence, and expiry. `resolveApproval()` requires an
authenticated approver identity and permits exactly one APPROVED or REJECTED
resolution before expiry.
