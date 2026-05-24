# Teacher Collection Workflow

Phase 2 teacher runs use disposable local cloned workspaces and keep capture artifacts outside those clones.

Required paths:

- cloned workspaces: `/Users/adamjackson/Projects/gemma-training/teacher-runs/repo-name/`
- capture artifacts: `/Users/adamjackson/Projects/gemma-training/captures/run-id/`

Run naming uses `YYYYMMDDTHHMMSSZ-slug` unless `CLAWPATCH_CAPTURE_RUN_ID` is set.

## Selected Pilot Repositories

The pilot selection is:

- `pallets/click` for Python CLI/library signal.
- `BurntSushi/ripgrep` for Rust CLI/library signal.
- `honojs/hono` for TypeScript web/library signal.

These repositories satisfy the planned tech-stack diversity requirement and have enough public source/test signal for clean/no-finding and non-empty review captures. Final qualification must still be recorded at run time because repository contents can change.

## Rejected Candidates To Record

The workflow records rejected candidates and reasons in `repository-qualification.json`. Expected candidates to inspect include:

- `encode/httpx`
- `cloudflare/vinext`
- `cweill/gotests`
- `fastify/fastify`
- `openclaw/clawpatch`

## Run Sequence

1. Clone or refresh each selected repository under `/Users/adamjackson/Projects/gemma-training/teacher-runs/repo-name/`.
2. Run `clawpatch init`.
3. Run `clawpatch map --capture-dir /Users/adamjackson/Projects/gemma-training/captures/run-id`.
4. Run enough `clawpatch review --capture-dir /Users/adamjackson/Projects/gemma-training/captures/run-id` passes to collect clean/no-finding and non-empty review examples.
5. Run `clawpatch revalidate --capture-dir /Users/adamjackson/Projects/gemma-training/captures/run-id` for open findings.
6. Verify `summary.json` has at least 250 accepted captures across `map`, `review`, and `revalidate`.
7. Produce `triage-subset.jsonl` with at least 30 accepted captures or 10% of accepted captures, whichever is larger.
8. Produce `collection-report.md` with repository qualification, selected/rejected repositories, capture counts, validation evidence, and the follow-up path to 5 repositories and 1,000 accepted captures.

Do not commit capture artifacts. They are private training material.
