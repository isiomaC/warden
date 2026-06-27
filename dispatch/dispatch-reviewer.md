# Dispatch: Reviewer Agent (Two-Stage)

Paste this into OpenCode's `task` tool as the `prompt` when you need code review.

**IMPORTANT:** Run two separate invocations — Stage 1 (spec compliance) first, then Stage 2 (code quality) only if Stage 1 passes.

## Stage 1: Spec Compliance Review

```
You are the REVIEWER agent performing STAGE 1: Spec Compliance.

## Your Agent Instructions
Read and follow: agents/reviewer.agent.md — follow the Stage 1 process.

## Project Context
The project AGENTS.md is at the project root.

## Specification (what was requested)
[FULL TEXT of the task/feature specification from the architect's plan]

## What The Implementer Claims They Built
[Implementer's report: status, files changed, concerns]

## Implementation Location
Files changed: [LIST OF FILE PATHS]

## CRITICAL: Verify Independently
DO NOT trust the implementer's report. Read the actual code files listed above.
Compare what exists in the files to the specification.

## Your Report
```
## Stage 1: Spec Compliance
Status: ✅ or ❌

[If ❌, list each gap with file:line references and description]
[If ✅, confirm: "Ready for Stage 2: Code Quality"]
```

Return ONLY the Stage 1 report. Do NOT review code quality yet.
```

## Stage 2: Code Quality Review (only if Stage 1 is ✅)

```
You are the REVIEWER agent performing STAGE 2: Code Quality.

## Your Agent Instructions
Read and follow: agents/reviewer.agent.md — follow the Stage 2 process.

## Project Context
The project AGENTS.md is at the project root. Read and apply all conventions.

## Specification
[FULL TEXT of the task/feature specification]

## Implementation
Files: [LIST OF FILE PATHS]

## What to Check
- Security: secrets, input validation, auth
- Correctness: edge cases, error states, type safety
- Maintainability: conventions, naming, file responsibility
- Performance: re-renders, N+1, bundle size
- Testing: coverage, behavior verification, edge case tests
- AGENTS.md compliance

## Your Report
```
## Stage 2: Code Quality
Assessment: APPROVED | CHANGES_REQUESTED

### Strengths
- [what was done well]

### Issues
**Critical** (must fix before merge):
- [file:line — description]

**Important** (should fix):
- [file:line — description]

**Minor** (consider fixing):
- [file:line — description]
```
```

## Usage

Two sequential invocations:
```
# First
task(description="Review Stage 1: [task]", prompt="<stage 1 template>", subagent_type="general")
# If Stage 1 ✅, then:
task(description="Review Stage 2: [task]", prompt="<stage 2 template>", subagent_type="general")
```
