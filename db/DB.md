---
type: db-md
updated: 2026-10-01T15:40:00+00:00
owner: Carlos Galarza
scope: engineering
---
# Rewire engineering store

The db.md store for Rewire's engineering: every measurement with its method and
the run behind it, the devices measurements ran on, the build decisions and what
would reverse them, and the state of each phase. The product plan lives in
Carlos's command-center brain; this store holds what the build learns.

## Agent instructions

**Session.** Load the standard with `dbmd spec` if it is not already loaded,
read this file, then `dbmd log tail 20 --dir db`. Write through `dbmd`
(`write`, `fm set`, `body`, `section`, `link`). Finish with
`dbmd validate --all db`, then `cd db && dbmd log <kind> <object> -m "<note>"`.

**Capture before you transcribe.** A number enters the store as raw tool output
first: the JSON or log a tool printed, saved under `records/run/YYYY/MM/` as a
`run` with the exact command and the device. The `measurement` record links the
run and states the number, the method and the conditions. A timing taken on a
loaded machine is kept and marked `discarded: true` with the reason.

**Status is part of the record.** A `measurement` is `measured` while it
stands, `superseded` when a later one replaces it (`superseded_by` names it),
and `withdrawn` when it was wrong. Never delete either kind.

**Decisions.** A choice that closes a question (a format, a threshold, a step
shipped or dropped) gets a `decision` with its evidence and the condition that
would reverse it.

**Public.** This store ships with the repository when it goes public. Never
write credentials, tokens, private hostnames, IP addresses or personal data.

## Policies

### Frozen pages

### Ignored types

### Validation log kinds
- capture
- decide

## Folders

- records/measurements — what was measured, how, on which device, and whether it still stands
- records/decisions — what was decided, on which evidence, and what would reverse it
- records/devices — the devices and browsers measurements ran on
- records/plan — the state of each build phase and its exit check
- records/run — raw tool output captured before a number was transcribed, by date

## Schemas

### measurement
- title (required, string)
- date (required, date)
- phase (required, enum: setup, smoke, 0A, 0B, 1, 2, 3, 4, 5, 6)
- status (required, enum: measured, analysis, superseded, withdrawn)
- devices (link to records/devices/)
- runs (link to records/run/)
- superseded_by (link to records/measurements/)
- note (string)
- summary_template: {title}

### decision
- title (required, string)
- decided_on (required, date)
- status (required, enum: standing, reversed)
- evidence (link to records/)
- reversible_if (required, string)
- summary_template: {title}

### device
- title (required, string)
- kind (required, enum: mac, pc, phone, tablet, chromebook)
- chip (string)
- ram_gb (int)
- os (string)
- browsers (string)
- unique: title
- summary_template: {title}

### phase
- title (required, string)
- phase (required, enum: setup, smoke, 0A, 0B, 1, 2, 3, 4, 5, 6)
- status (required, enum: not_started, in_progress, passed, blocked)
- exit (required, string)
- summary_template: {title}

### run
- title (required, string)
- tool (required, string)
- command (required, string)
- devices (required, link to records/devices/)
- captured_at (required, date)
- discarded (required, bool)
- shard: by-date
- summary_template: {title}
