# Stock News Discovery — lightweight delivery branch

Status: **DEVELOPMENT ONLY / NOT OPERATIONAL**. Created 2026-11-11.

## Scope
A separate news-only collector using source-published metadata. No ticker list, no price/volume movement trigger, no investment analysis. No modifications to SEC functions, schedules, checkpoint tables, existing GitHub workflows, or existing news archives.

## Verified evidence
- Previous one-feed RSS test run: `20261111T185718Z--ee8b2cb12302d785`; 40 records / 40 source item occurrences, source `VERIFIED_PARTIAL`, 16 readback-verified files, no checkpoint, no recurrence.
- A separate JSON Feed HTTP 200 retrieval returned 40 current items on 2026-11-11.
- A standalone Node regression harness in the user conversation passed 36/36 tests after a missing explicit checkpoint flag was corrected.
- A Gmail delivery-test message was sent and independently located in Sent on 2026-11-11.
- ChatGPT scheduled task creation is currently BLOCKED by the account's limit of 5 active scheduled tasks. No existing tasks may be paused or replaced for this project.

## Lower-storage design
Use small source-scoped GUID+revision hashes and delivery receipts in existing free infrastructure or Gmail Sent, not recurring copies of full article bodies. One source per independent collection. Preserve source credits and direct URLs. At-least-once delivery may produce repeats after ambiguous email failures; never mark email delivered until confirmed. Bounded retries, 429 handling, feed-window gaps, full pagination for APIs that provide it, and strict free quota caps are mandatory.

## Stop gates
Do not schedule unattended email or enable GitHub Actions yet. First prove a hosted replay/failure test, verify the free email transport credentials and readback, and ensure a durable minimal dedup/checkpoint mechanism. Avoid creating storage buckets or any new paid services.

## Historic independence
Protected branch: `tickerbot-cursor-safety-2026-11-02`. This branch does not replace it.
