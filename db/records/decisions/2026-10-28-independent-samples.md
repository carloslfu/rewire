---
type: decision
id: 01m62f1ytq7hfmxrcnq66pfg3g
created: 2026-10-28T23:55:47.927977+00:00
updated: 2026-10-28T23:55:47.927977+00:00
summary: Use independent editable samples with a shared composer and manual model controls
decided_on: 2026-10-28
evidence: '[[records/measurements/2026-10-28-independent-samples]]'
reversible_if: Visitor testing shows that independent samples prevent the intended learning task, or an explicitly designed conversation mode makes context boundaries clear without compromising controlled comparisons.
title: Use independent editable samples with a shared composer and manual model controls
status: standing
---
# Independent questions and visible sample controls

Carlos approved independent questions, visible Edit and Remove controls with Undo, a retained composer and suggested examples, testing and deployment on October 28. This replaces the conversation-context behavior of the earlier conversation-first interface while preserving the hands-on guide in [[records/decisions/2026-10-28-manual-guided-examples]].

Every question starts from the same short system prompt and its own question only. Original and changed answers use identical input, seed and temperature. Sampling position is independent of the sample list index. Generation, comparisons, continuation and token inspection exclude every other sample.

Each sample shows Edit and Remove. Editing regenerates only that answer pair with its saved sampling settings; removal preserves the other samples. Undo restores the cached pair unless current model settings differ, in which case it retains the original and regenerates only the restored changed answer. Multiple removals can be undone in reverse order. Global model changes update each sample independently while retaining original answers.

The composer says Test question and explains independence. Suggested questions fill an editable draft and require the visitor to submit. Selecting an example clears samples and restores the model, while Clear samples retains the chosen guide and model changes. No extra conversation mode is introduced. Evidence: [[records/measurements/2026-10-28-independent-samples]].
