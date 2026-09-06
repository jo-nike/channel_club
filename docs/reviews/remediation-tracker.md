# Adversarial review remediation tracker

Baseline: `cfb180ca874eb5a98ed86c9b7e72f9cae65913f9`. Initial HEAD matches baseline; existing untracked review documents preserved unchanged. One atomic implementation commit per finding; ledger documentation commits are separate.

Statuses: Open → In progress → Fixed (acceptance verified), or Blocked with precise remaining action. Synthetic fixtures and temporary storage only; no deployment or physical-device claims.

| ID | Severity | Status | Dependencies | Responsible agent | Implementation notes | Verification evidence | Commit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FE-01 | High | In progress | — | root | Shared PWA API cache crosses account/authorization boundaries | Pending | — |
| MEDIA-01 | High | In progress | — | media | User-controlled highlight channel IDs escape the recording directory and reach recursive deletion | Pending | — |
| MEDIA-02 | High | In progress | — | root | Public logo requests and async media routes synchronously fetch upstream feeds, blocking every request on the event loop | Pending | — |
| MEDIA-03 | High | In progress | MEDIA-01, MEDIA-15 | media | Authenticated media calls admit unlimited FFmpeg processes and encoding jobs | Pending | — |
| MEDIA-15 | High | In progress | MEDIA-01 | media | Empty channel ID preserves a client-supplied URL as FFmpeg input | Pending | — |
| SEC-01 | High | In progress | — | security | Empty signing key passes startup and permits forged administrator tokens | Pending | — |
| SEC-02 | High | In progress | — | security | Explicitly empty local passwords authenticate despite the startup warning | Pending | — |
| SEC-03 | High | In progress | — | security | Full bearer credentials are written to routine request logs | Pending | — |
| DEV-01 | Medium | In progress | — | root | Documented local startup sends API requests to the wrong port | Pending | — |
| FE-02 | Medium | In progress | FE-01 | root | Live HLS playlists and segments are cached under the API fallback policy | Pending | — |
| FE-03 | Medium | In progress | — | frontend | QR authentication survives cancellation/unmount and can authenticate the abandoned flow | Pending | — |
| FE-04 | Medium | In progress | — | frontend | A stale 401 response logs out a newly signed-in account | Pending | — |
| FE-05 | Medium | In progress | — | frontend | Live Channel 0 stops following backend channel changes when ErsatzTV is absent | Pending | — |
| FE-06 | Medium | In progress | MEDIA-05 snapshot contract | frontend | Highlight trimming/WebM export downloads a different capture from the preview | Pending | — |
| FE-07 | Medium | In progress | — | frontend | Cast controls forget a connected, playing receiver after player remount | Pending | — |
| FE-08 | Medium | In progress | — | frontend | Cast backend sessions lose ownership on replacement and disconnect races | Pending | — |
| FE-09 | Medium | In progress | — | frontend | Player keyboard shortcuts hijack native focused controls | Pending | — |
| FE-10 | Medium | In progress | — | frontend | Sustained WebSocket outage permanently disconnects the UI without a recovery control | Pending | — |
| FE-11 | Medium | In progress | — | frontend | Chat silently discards the draft when the socket cannot send | Pending | — |
| MEDIA-04 | Medium | In progress | — | media | FFmpeg stderr pipes are never drained, eventually freezing recording/transcoding | Pending | — |
| MEDIA-05 | Medium | In progress | — | media | Concurrent highlight exports share mutable input/output files and can delete each other's results | Pending | — |
| MEDIA-06 | Medium | In progress | MEDIA-15 | media | ErsatzTV lookup failure disables independent Dispatcharr highlights and cast | Pending | — |
| MEDIA-07 | Medium | In progress | — | root | HLS rewriting misses URI-bearing tags and playlists with query strings | Pending | — |
| MEDIA-08 | Medium | In progress | — | root | Manifest and logo fetches remain unbounded despite the segment-size cap | Pending | — |
| MEDIA-09 | Medium | In progress | — | root | Public logo proxy trusts feed-supplied targets and serves arbitrary active content on the application origin | Pending | — |
| MEDIA-10 | Medium | In progress | — | root | Mid-segment upstream failures are silently finalized as successful truncated responses | Pending | — |
| MEDIA-11 | Medium | In progress | — | root | Failed EPG refreshes serialize one new timeout per waiting caller instead of sharing the failure | Pending | — |
| OPS-01 | Medium | In progress | — | root | Concurrent releases can deploy older code after newer code | Pending | — |
| OPS-02 | Medium | In progress | — | root | Rebuilding a release reuses a tag that Compose may never pull | Pending | — |
| SEC-04 | Medium | In progress | SEC-01 | security | Channel control bypasses the existing stale-administrator check | Pending | — |
| SEC-05 | Medium | In progress | — | security | A viewer can poison presence data and disable the administrator user list | Pending | — |
| SEC-06 | Medium | In progress | — | security | An established WebSocket remains authorized after its JWT expires | Pending | — |
| SEC-07 | Medium | In progress | — | security | A broadcast timeout silently strands an otherwise live client | Pending | — |
| SEC-08 | Medium | In progress | — | security | Unexpected upstream status payloads crash the whole combined status endpoint | Pending | — |
| FE-12 | Low | In progress | — | frontend | Now-playing and presence metadata do not advance at programme boundaries | Pending | — |
| MEDIA-12 | Low | In progress | — | root | Trending GIF cache ignores the requested limit | Pending | — |
| MEDIA-13 | Low | In progress | — | root | Malformed/duplicate M3U entries can silently select the wrong channel | Pending | — |
| MEDIA-14 | Low | In progress | — | media | Highlight segment metadata grows without bound even though media files wrap | Pending | — |
| QA-01 | Low | In progress | — | root | Backend tests inherit local integration settings and can call the network | Pending | — |

## Verification ledger

Pending focused and full checks.

## Coverage gaps and design decisions

All 16 report follow-up areas will be assessed before completion.

## Coordination

Root owns tracker and summaries. Agents report evidence and hashes to root; commit only owned paths. Shared configuration changes require coordination.
