# Acceptance and evidence

## Separate questions, separate results

1. Does the browser prepare only the approved donor-name spans, preserving every other input byte and the destination? This is a product requirement, independently checked on the actual downloaded donor.
2. Does the pinned native CAD consumer reproduce both collision failures and preserve the prepared block geometry/editability, including save/reopen? This is a native behavior requirement.
3. Does every native-resaved DXF pass an absolute zero-repair SDK audit? The existing strict experiment answered **no**, including for unchanged input baselines. That result remains failed and visible.

The scoped behavior validator is not a blanket exception for code 202 or a tolerated error count. It requires fixed previously reviewed semantic identities, exact owner-only deltas and fix records, full snapshots outside those changes, complete native cases and negative controls. A new unknown difference fails. It must never derive its acceptance list from the current run's own baseline.

## Input versus consumer output

The product exports a patched original donor. It never exports the QCAD-resaved merged file. The owner-complete synthetic source family independently checks authored raw owners against loaded owners, then compares full audit snapshots, including tags, attributes, headers, inventory and membership. Prepared browser output must add no structural findings or changes and must equal the independent approved-span patch.

Snapshot hashes describe one SDK read. ezdxf may synthesize absent FINGERPRINTGUID and VERSIONGUID header values in memory, so a fresh read can have different snapshot hashes. Acceptance compares complete before/after snapshots within the same in-memory audit. Original-file SHA-256 and the frozen semantic policy remain the stable bindings; no audited document is written back.

Native-resaved files are test observations of the consumer. The pinned exporter omits owner fields in its default metadata and table records. Both untouched native baselines reproduce these omissions. The new behavior result documents this boundary rather than asserting that the native serialized file is universally clean.

## Historical evidence

- Initial strict run: `37304876911`, commit `2082c12fd8d275ef216603f3652fed35eb7f8f72`, native behavior 455 assertions passed; strict native-output audit failed
- Baseline diagnostic: `37310795371`, attempt 2, commit `51500237c9d2e0aef21e8827f91f86c30adb5831`, native behavior 502 assertions and all seven exact geometry checks passed; strict native-output audit failed
- Attempt 1 of the diagnostic stopped during upstream source checkout; it provides no native result
- Verified product run: `37323082182`, commit `dbd0914401410a505349d5a225522682eeda4b03`, all core, sandboxed browser and scoped native jobs passed. Actual downloaded donor SHA-256 is `249b9e396ccfa307d5b63a19794d42f7b9efb7c014925672a95d7abcafbcb173`; exactly nine name tokens changed and every other donor byte remained unchanged
- All 14 desktop/mobile screenshots from that exact run were independently inspected with no blocking issues
- Fresh strict run `37323082239` on the same code commit reproduced the strict zero-repair failure and remains failed
- [Release evidence](../evidence/verification.json), [native evidence](../evidence/native-behavior.json), [browser evidence](../evidence/browser-summary.json), and [visual inspection](../evidence/visual-review.json) record these separate outcomes

The first fixtures and old strict workflow remain unchanged. No earlier failed result is relabeled as success.
