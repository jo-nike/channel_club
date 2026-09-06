# Adversarial review remediation tracker

Baseline: `cfb180ca874eb5a98ed86c9b7e72f9cae65913f9`. Initial HEAD matches baseline; existing untracked review documents preserved unchanged. One atomic implementation commit per finding; ledger documentation commits are separate.

Statuses: Open → In progress → Fixed (acceptance verified), or Blocked with precise remaining action. Synthetic fixtures and temporary storage only; no deployment or physical-device claims.

| ID | Severity | Status | Dependencies | Responsible agent | Implementation notes | Verification evidence | Commit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FE-01 | High | Focused verified | — | root | exclude APIs from offline cache and purge legacy data | Real generated SW Chrome: admin→viewer→anonymous, legacy deletion, offline/11s upstream delays; no cached API entries | `076d93c` |
| MEDIA-01 | High | Focused verified | — | media | isolate recorder directories and contain lifecycle cleanup | Agent focused regressions pass; full aggregate checks pending | `06db357` |
| MEDIA-02 | High | Focused verified | — | root | offload and serialize upstream feed lookups | 46 focused route tests; delayed lookup permits concurrent ASGI health; 20 cold callers share failure | `d0ebf16` |
| MEDIA-03 | High | Focused verified | MEDIA-01, MEDIA-15 | media | enforce shared media admission budgets and release failed work | Agent focused regressions pass; full aggregate checks pending | `06d1d4d` |
| MEDIA-15 | High | Focused verified | MEDIA-01 | media | resolve every media input from authoritative catalogs | Agent focused regressions pass; full aggregate checks pending | `24e335d` |
| SEC-01 | High | Focused verified | — | security | reject unusable JWT signing secrets before startup | Agent focused regressions pass; full aggregate checks pending | `fcaaef1` |
| SEC-02 | High | Focused verified | — | security | disable local accounts with empty passwords | Agent focused regressions pass; full aggregate checks pending | `b52fa60` |
| SEC-03 | High | Focused verified | — | security | redact bearer credentials before server and browser log sinks | Agent focused regressions pass; full aggregate checks pending | `6f11412` |
| DEV-01 | Medium | Focused verified | — | root | route default browser API calls through the development proxy | 38 focused tests plus real Chrome/Vite synthetic auth on loopback and machine LAN address | `23206e2` |
| FE-02 | Medium | Focused verified | FE-01 | root | verify live media bypasses generated worker caches | Real generated SW Chrome: stream/segments/cast HLS uncached; offline errors instead of stale media | `5276e4e` |
| FE-03 | Medium | Focused verified | — | frontend | invalidate abandoned QR authentication attempts | Agent focused regressions pass; full aggregate checks pending | `8ed804e` |
| FE-04 | Medium | Focused verified | — | frontend | bind unauthorized responses to their login generation | Agent focused regressions pass; full aggregate checks pending | `fdc8f85` |
| FE-05 | Medium | Focused verified | — | frontend | keep live channel synchronized without optional catalog | Agent focused regressions pass; full aggregate checks pending | `4dad81a` |
| FE-06 | Medium | Focused verified | MEDIA-05 snapshot contract | frontend | export exact preview media without recapturing live buffer | 18 modal + 4 backend tests; actual FFmpeg color-frame decode validates original capture | `7833512` |
| FE-07 | Medium | Focused verified | — | frontend | hydrate Cast controls from existing receiver state | Agent focused regressions pass; full aggregate checks pending | `39947df` |
| FE-08 | Medium | Focused verified | — | frontend | own Cast resources and serialize receiver replacements | Agent focused regressions pass; full aggregate checks pending | `2e1b759` |
| FE-09 | Medium | Focused verified | — | frontend | preserve native controls in shared player shortcuts | Agent focused regressions pass; full aggregate checks pending | `13783ee` |
| FE-10 | Medium | Focused verified | — | frontend | recover exhausted WebSocket connections visibly and online | Agent focused regressions pass; full aggregate checks pending | `d47aa8e` |
| FE-11 | Medium | Focused verified | — | frontend | preserve rejected chat drafts and expose delivery uncertainty | Agent focused regressions pass; full aggregate checks pending | `725d32c` |
| MEDIA-04 | Medium | Focused verified | — | media | redirect process output and verify flood-safe progress | Actual harmless child emits1MiB stderr and progresses/terminates | `7a89900` |
| MEDIA-05 | Medium | Focused verified | — | media | snapshot completed segments into isolated cancellable exports | Concurrent isolated captures, stop/wrap mutation, cancellation reaps actual harmless encoder | `20d5b81` |
| MEDIA-06 | Medium | Focused verified | MEDIA-15 | media | isolate provider resolution and report catalog outages accurately | Agent focused regressions pass; full aggregate checks pending | `606cd6f` |
| MEDIA-07 | Medium | Focused verified | — | root | proxy HLS URI attributes and query-bearing playlists | 35 focused HLS tests; real browser/player integration in progress | `b260f70` |
| MEDIA-08 | Medium | Focused verified | — | root | bound upstream manifests logos and feed bodies | 138 Ersatz/bounded-body tests; false/absent lengths, read cap, timeout, early video MIME refusal | `09d546b` |
| MEDIA-09 | Medium | Focused verified | — | root | constrain logo origins and serve only safe raster content | 52 focused logo/route tests; off-origin no-connect, redirect validation, active content refused | `27652da` |
| MEDIA-10 | Medium | In progress | — | root | Mid-segment upstream failures are silently finalized as successful truncated responses | Pending | — |
| MEDIA-11 | Medium | Focused verified | — | root | share failed refreshes and back off stale caches | 39 EPG/parser tests; 20 callers share failed refresh, stale backoff, recovery deadline | `420d04d` |
| OPS-01 | Medium | Focused verified | — | root | serialize host deployment and refuse stale source revisions | Independent process interleaving and stale source refusal; host deployment not executed | `cc5d9f7` |
| OPS-02 | Medium | In progress | — | root | Rebuilding a release reuses a tag that Compose may never pull | Pending | — |
| SEC-04 | Medium | Focused verified | SEC-01 | security | apply current administrator grants to channel control | Agent focused regressions pass; full aggregate checks pending | `bc6a5ba` |
| SEC-05 | Medium | Focused verified | — | security | validate bounded WebSocket messages before shared state mutation | Agent focused regressions pass; full aggregate checks pending | `d35cd13` |
| SEC-06 | Medium | Focused verified | — | security | expire idle and active WebSockets at signed token deadline | Agent focused regressions pass; full aggregate checks pending | `d7edeb0` |
| SEC-07 | Medium | Focused verified | — | security | close failed broadcasts and cancel their session owners | Agent focused regressions pass; full aggregate checks pending | `213d87a` |
| SEC-08 | Medium | Focused verified | — | security | validate upstream status shapes and isolate service failures | Agent focused regressions pass; full aggregate checks pending | `4f6e3e3` |
| FE-12 | Low | Focused verified | — | frontend | advance programme headers and presence on shared clock | Agent focused regressions pass; full aggregate checks pending | `efa2595` |
| MEDIA-12 | Low | In progress | — | root | Trending GIF cache ignores the requested limit | Pending | — |
| MEDIA-13 | Low | In progress | — | root | Malformed/duplicate M3U entries can silently select the wrong channel | Pending | — |
| MEDIA-14 | Low | Focused verified | — | media | bound segment manifests across recording wrap cycles | Actual FFmpeg 40 segments/wrap4 retains3 ordered entries | `31f4d6d` |
| QA-01 | Low | Focused verified | — | root | isolate backend settings and forbid external networking | 712 full backend tests pass under blank JWT/invalid PORT/hostile URL parent values; external sockets/DNS denied | `e82120b` |

## Verification ledger

Latest full backend checkpoint: **712 passed** with hostile parent environment and socket guard. Frontend checkpoint: **994 passed**, ESLint and production build passed. Final checks will follow remaining fixes and integration review.

The generated production SW runs in real isolated Chrome. Cast SDK tests remain mocked; no physical Chromecast claim. Actual harmless subprocess and synthetic FFmpeg media tests are identified individually.

Final history cleanup will fold ID-targeted fixup commits and relocate a shared-file FE-12 hunk from FE-10; original review files remain untouched.

## Coverage gaps and design decisions

All 16 report follow-up areas will be assessed before completion.

## Coordination

Root owns tracker and summaries. Agents report evidence and hashes to root; commit only owned paths. Shared configuration changes require coordination.
