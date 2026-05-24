# Clawpatch Training Data Capture

This charter defines the approved Phase 0 through Phase 2 workflow for collecting private Clawpatch non-fix provider traces for a future Gemma fine-tuning experiment.

## Scope

- Capture source operations: `map`, `review`, and `revalidate`.
- Non-goals: Gemma training, Gemma runtime provider integration, and `fix` capture or replacement.
- Current target: 5 qualified public repositories, at least 500 accepted review captures, at least 100 accepted revalidate captures when findings exist, and continued map expansion until the retained map corpus reaches the target minimum.
- Follow-up path: keep expanding repository roots until the retained corpus reaches the review, revalidate, and map target minimums without counting duplicate or metadata-only captures.
- Success criterion: accepted captures are schema-valid and pass Clawpatch operation-specific validation, including review evidence/path/line validation where applicable.

## Privacy Boundary

Captured data is private training material. Secrets, provider credentials, and captured private transcripts must not be committed into the Clawpatch repository.

Capture is opt-in only. It is enabled by passing `--capture-dir <path>` to `map`, `review`, or `revalidate`, or by setting `CLAWPATCH_CAPTURE_DIR`. Without one of those settings, no capture artifacts are written.

Before persistence, capture records scan the prompt, schema, raw output, accepted output, provider metadata, repo metadata, rejected records, and capture summary fields for common secrets and provider credentials. Suspected secrets are masked and reflected in `redactionState`. Material that cannot be safely masked is downgraded to metadata-only rejected/eval material.

## Capture Record

Capture records are written as JSONL to `<capture-dir>/captures.jsonl`, with a summary at `<capture-dir>/summary.json`.

Each full accepted record includes:

- `captureId`
- `captureRunId`
- `operation`
- `status`
- `validationStatus`
- `provider`
- `repo`
- `prompt`
- `schema`
- `rawOutput`
- `acceptedOutput`
- `rejectedOutput`
- `error`
- `tags`
- `redactionState`

Rejected records and unsafe records are retained as metadata-only rejected/eval material so they cannot inflate accepted capture counts.

## User Review Boundaries

Ask for review before changing any of these boundaries:

- Capturing `fix` calls.
- Enabling capture by default.
- Persisting unredacted private transcripts.
- Weakening Clawpatch schema or operation validation to increase accepted counts.
- Moving Phase 2 capture artifacts into cloned repositories.
- Treating repositories as qualified when they do not satisfy the balanced training-signal standard.

## Repository Qualification Rule

A Phase 2 repository qualifies only if it satisfies the balanced training-signal standard:

- public repository
- permissive/open license
- supported mapper ecosystem
- successful `clawpatch init/map`
- at least 12 source-like files
- at least 5 test-like files
- no weak-map result
- at least 3 tech stacks across the 5 repositories
- at least 20 source-like files and 10 test-like files per repo where practical
- validation/test commands detectable or easy to document
- limited generated/vendor dominance
- enough feature diversity to produce both clean/no-finding and non-empty review captures

## Triaged Evaluation Subset

Before later training, retain a triaged evaluation subset containing at least 30 accepted captures or 10% of accepted captures, whichever is larger. The subset must cover `map`, `review`, and `revalidate`, include clean/no-finding and non-empty review examples where available, and retain artifact fields for capture id, operation, repo, validation status, triage status, triage reviewer or method, and triage notes.
