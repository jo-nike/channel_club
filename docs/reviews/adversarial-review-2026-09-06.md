# IPTV Viewer — adversarial code review

Reviewed **6 September 2026** · Baseline **`cfb180ca874eb5a98ed86c9b7e72f9cae65913f9`** · Whole-project review

**39 actionable findings: 0 Critical, 8 High, 26 Medium, 5 Low.** Application code was not changed. Findings describe the reviewed revision; all are open. This review does not certify the deployment or assert that every possible defect was found.

## Assessment

The main risks are unsafe authentication configuration, credential-bearing logs, cross-account offline caching and insufficient isolation of media inputs/processes. Smaller but user-visible defects concern cancellation, live-channel synchronization, highlight export correctness, keyboard controls and recovery after network interruptions. The passing unit suites leave important lifecycle and browser contracts untested.

Start with the High findings before expanding access to the app. Treat prerequisites as part of each finding: highlight/cast features are disabled by source defaults, viewer channel control is configurable, and the signing-key/password defects require explicit unsafe configuration. This review did not inspect real secret values or determine which optional features or external gateway protections are active in production.

## Classification and evidence

| Level | Meaning used in this review |
| --- | --- |
| Critical | Direct, broadly reachable compromise or destructive loss with minimal preconditions. No finding is assigned this level without sufficient evidence. |
| High | Material credential exposure, authentication compromise, destructive filesystem reach or substantial resource abuse; stated configuration/access prerequisites still apply. |
| Medium | A reproducible or fully traced feature failure, bounded abuse, inconsistent authorization, state loss or recovery/deployment defect. |
| Low | Narrow correctness, metadata, test isolation or usability defect with limited direct impact. |

Severity describes consequence and reachability together. Confidence describes evidential strength, not impact. **Probe-confirmed/reproduced** means a safe local execution demonstrated the behavior; **source-confirmed/source-traced** means callers, implementation and sinks were inspected, without claiming a live device or production exploit. Mocks were used for process execution and destructive operations. A passing bug-demonstration probe asserts that the defect exists; it is not a regression test that the repaired implementation should preserve.

Related issues retain separate IDs when their user impact and acceptance tests differ. FE-01 and FE-02 share the broad service-worker routing policy and should be fixed together. Frontend credential logging is merged into SEC-03 rather than counted again. There are no stylistic lint findings padded into the issue count.

## Scope and trust boundaries

- **Application:** 45 tracked backend Python source files and 123 frontend source/assets files were inventoried. Review work covered authentication, API guards, WebSocket state/chat/presence, source integrations/parsers, FFmpeg recording/transcoding, TV/player/EPG flows, client stores and async hooks, PWA caching, Docker and CI deployment.
- **Tests/configuration:** Backend tests, 78 frontend test/support files, dependency manifests/locks, environment examples, Vite/TypeScript/lint configuration and deployment scripts were inspected. Inventory is not a claim of equal line-by-line depth in every presentational component.
- **Trusted boundaries under challenge:** browser→API/WebSocket; one signed-in user→another user or shared server state; channel IDs/URLs→filesystem and FFmpeg; upstream API/playlist→parser/cache; async completion→current login/player/session; build job→shared deployed service.
- **Threat model:** anonymous visitors, ordinary authenticated viewers, formerly privileged token holders, shared-browser users, malformed or slow configured upstream services, and overlapping normal user/CI actions. Reverse-proxy access restrictions and account policy are unknown.
- **Excluded from product review:** vendored `_bmad/` tooling, historical `_bmad-output/` planning as executable code, generated dist/node_modules internals except targeted dependency tracing, and real `.env` contents. Local installed dependency behavior was inspected when necessary.

## Validation ledger

| Check | Result and limits |
| --- | --- |
| Backend full suite | **603 passed**, one installed Starlette/httpx deprecation warning, 2.90 s in the final isolated run. Nonlocal socket connections were blocked; unused integration credentials were blanked. Installed backend package versions matched `uv.lock`. |
| Frontend full suite | **960 passed** across **76 files**, 28.66 s. These are mostly jsdom/unit/component tests. |
| Backend lint and formatting | Ruff check passed; 87 files already formatted. |
| Backend type check | basedpyright: **0 errors, 0 warnings, 0 notes** using the project Python environment. |
| Frontend lint and build | ESLint passed; TypeScript and production Vite/PWA build passed. Build warned about a roughly 1.17 MB minified main JS chunk (331 KB gzip) and stale Browserslist data; these are observations, not proven performance failures. |
| Browser cache probe | Real headless Chrome loaded the generated production worker against a temporary localhost server with synthetic API data. Admin→viewer offline request returned cached admin JSON with HTTP 200; offline live playlist returned stale media sequence 42 with HTTP 200. |
| Frontend adversarial probes | Eight assertions in two isolated test files reproduced QR cancellation/timer races, stale-login 401 handling, live selection staleness, focused-button shortcut handling and Cast state/ownership races. |
| Backend adversarial probes | Synthetic ASGI/WebSocket/auth tests demonstrated all eight SEC findings. Mocked media/process/parser probes demonstrated the behaviors cited under media findings; recursive deletion and real FFmpeg network execution were not performed. |
| Environment artifacts resolved | Initial sandbox TestClient hang and type-checker dependency-discovery errors disappeared outside the sandbox. Ten initial backend failures came from a review URL override conflicting with hardcoded fixtures. A network guard then exposed four unmocked role-lookup calls; isolated settings restored the full pass. See QA-01. These intermediate runs are not reported as product runtime failures. |
| Not executed | Deployment/rollback, image build or current registry vulnerability/secret scans, load/soak testing, live Plex/Dispatcharr/ErsatzTV flows, actual video decode, Safari/mobile/TV hardware and a physical Chromecast. No current CVE clearance is implied. |

The final test environment used Python 3.13.7 and Node 22.21.0. Runtime integration conclusions from doubles remain explicitly qualified. Temporary probe paths from reviewer working notes are not prerequisites for acting on this report: each finding below specifies its trigger and regression criteria.

## Recommended repair order

1. **Contain the High issues:** validate configuration; constrain media identifiers and filesystem roots; enforce stream provenance/resource budgets; remove reusable credentials from logging; deploy a service-worker policy that also deletes old privileged caches.
2. **Make state ownership explicit:** enforce current authorization and WebSocket expiry, validate incoming messages, close failed broadcast clients, bind async callbacks and media processes to the operation that owns them.
3. **Repair user-visible contracts:** live-only channel following, stable highlight previews/exports, Cast resume and replacement, native keyboard controls, chat delivery feedback and outage recovery.
4. **Harden integration/deployment behavior:** malformed response isolation, parser/HLS cases, cache keys, release serialization/artifact identity, and a hermetic local test/onboarding path.

Use small commits grouped by shared root cause. Add the stated failing regression before the fix where practical, run the affected tests, then the existing full suites. Review changed attack paths again, especially streaming URL handling and filesystem cleanup. Do not replay destructive payloads against a real instance.

## Finding index

| ID | Severity | Area | Finding |
| --- | --- | --- | --- |
| [FE-01](#fe-01) | High | Frontend | Shared PWA API cache crosses account/authorization boundaries |
| [MEDIA-01](#media-01) | High | Media & integrations | User-controlled highlight channel IDs escape the recording directory and reach recursive deletion |
| [MEDIA-02](#media-02) | High | Media & integrations | Public logo requests and async media routes synchronously fetch upstream feeds, blocking every request on the event loop |
| [MEDIA-03](#media-03) | High | Media & integrations | Authenticated media calls admit unlimited FFmpeg processes and encoding jobs |
| [MEDIA-15](#media-15) | High | Media & integrations | Empty channel ID preserves a client-supplied URL as FFmpeg input |
| [SEC-01](#sec-01) | High | Security & backend | Empty signing key passes startup and permits forged administrator tokens |
| [SEC-02](#sec-02) | High | Security & backend | Explicitly empty local passwords authenticate despite the startup warning |
| [SEC-03](#sec-03) | High | Security & backend | Full bearer credentials are written to routine request logs |
| [DEV-01](#dev-01) | Medium | Delivery & tests | Documented local startup sends API requests to the wrong port |
| [FE-02](#fe-02) | Medium | Frontend | Live HLS playlists and segments are cached under the API fallback policy |
| [FE-03](#fe-03) | Medium | Frontend | QR authentication survives cancellation/unmount and can authenticate the abandoned flow |
| [FE-04](#fe-04) | Medium | Frontend | A stale 401 response logs out a newly signed-in account |
| [FE-05](#fe-05) | Medium | Frontend | Live Channel 0 stops following backend channel changes when ErsatzTV is absent |
| [FE-06](#fe-06) | Medium | Frontend | Highlight trimming/WebM export downloads a different capture from the preview |
| [FE-07](#fe-07) | Medium | Frontend | Cast controls forget a connected, playing receiver after player remount |
| [FE-08](#fe-08) | Medium | Frontend | Cast backend sessions lose ownership on replacement and disconnect races |
| [FE-09](#fe-09) | Medium | Frontend | Player keyboard shortcuts hijack native focused controls |
| [FE-10](#fe-10) | Medium | Frontend | Sustained WebSocket outage permanently disconnects the UI without a recovery control |
| [FE-11](#fe-11) | Medium | Frontend | Chat silently discards the draft when the socket cannot send |
| [MEDIA-04](#media-04) | Medium | Media & integrations | FFmpeg stderr pipes are never drained, eventually freezing recording/transcoding |
| [MEDIA-05](#media-05) | Medium | Media & integrations | Concurrent highlight exports share mutable input/output files and can delete each other's results |
| [MEDIA-06](#media-06) | Medium | Media & integrations | ErsatzTV lookup failure disables independent Dispatcharr highlights and cast |
| [MEDIA-07](#media-07) | Medium | Media & integrations | HLS rewriting misses URI-bearing tags and playlists with query strings |
| [MEDIA-08](#media-08) | Medium | Media & integrations | Manifest and logo fetches remain unbounded despite the segment-size cap |
| [MEDIA-09](#media-09) | Medium | Media & integrations | Public logo proxy trusts feed-supplied targets and serves arbitrary active content on the application origin |
| [MEDIA-10](#media-10) | Medium | Media & integrations | Mid-segment upstream failures are silently finalized as successful truncated responses |
| [MEDIA-11](#media-11) | Medium | Media & integrations | Failed EPG refreshes serialize one new timeout per waiting caller instead of sharing the failure |
| [OPS-01](#ops-01) | Medium | Delivery & tests | Concurrent releases can deploy older code after newer code |
| [OPS-02](#ops-02) | Medium | Delivery & tests | Rebuilding a release reuses a tag that Compose may never pull |
| [SEC-04](#sec-04) | Medium | Security & backend | Channel control bypasses the existing stale-administrator check |
| [SEC-05](#sec-05) | Medium | Security & backend | A viewer can poison presence data and disable the administrator user list |
| [SEC-06](#sec-06) | Medium | Security & backend | An established WebSocket remains authorized after its JWT expires |
| [SEC-07](#sec-07) | Medium | Security & backend | A broadcast timeout silently strands an otherwise live client |
| [SEC-08](#sec-08) | Medium | Security & backend | Unexpected upstream status payloads crash the whole combined status endpoint |
| [FE-12](#fe-12) | Low | Frontend | Now-playing and presence metadata do not advance at programme boundaries |
| [MEDIA-12](#media-12) | Low | Media & integrations | Trending GIF cache ignores the requested limit |
| [MEDIA-13](#media-13) | Low | Media & integrations | Malformed/duplicate M3U entries can silently select the wrong channel |
| [MEDIA-14](#media-14) | Low | Media & integrations | Highlight segment metadata grows without bound even though media files wrap |
| [QA-01](#qa-01) | Low | Delivery & tests | Backend tests inherit local integration settings and can call the network |

## Detailed findings

<a id="fe-01"></a>

### FE-01 — Shared PWA API cache crosses account/authorization boundaries

- Severity: **High**. Category: security/privacy; session isolation. Confidence: high. Evidence: **browser-confirmed with generated production service worker** plus source trace.
- Locations: `frontend/vite.config.ts:20–32`; `frontend/src/stores/authStore.ts:33–39`; `frontend/src/hooks/useActiveUsers.ts:41–43`; `frontend/src/hooks/useSystemStatus.ts:81–83`.
- Root cause: Workbox `NetworkFirst` captures every HTTP(S) `/api/` GET except paths beginning `ws`, using a single `api-cache` with five-minute retention and a ten-second fallback timeout. Authentication is a request Authorization header, but responses have no `Vary: Authorization`; Cache API matching therefore does not partition these records by token. Logout removes three localStorage keys, leaving Cache Storage intact. Installed Workbox code in `workbox-strategies/src/StrategyHandler.ts:274–288,399–402` confirms request cache matching and unconditional eligible-response cache insertion.
- Trigger/reproduction: While controlled by the production service worker, fetch `/api/admin/active-users` or `/api/admin/status` as admin. Log out, log in as viewer, then request the identical URL during a network failure or a delay over ten seconds. The cache can return the prior administrator's 200 response. A same-browser user can also enumerate the retained response using Cache Storage. The Chrome probe exercised the generated worker against a synthetic API: after admin priming and API connection drops, viewer Authorization received admin-only JSON with status 200. The normal online server's 403 is not itself bypassed; the defect is retained data and offline/timeout fallback.
- Impact: Another account sharing a browser profile can access administrator-only usernames, presence, source/client IP addresses, user-agent data and infrastructure status previously fetched there. Unauthorized cached content remains accessible after logout. This is a client-side disclosure, not a claim of remote server privilege escalation.
- Fix: Exclude authenticated/admin/auth API routes from offline caching (prefer an explicit public-resource allowlist); delete old `api-cache` during worker migration and clear any deliberately retained per-user caches at logout. Merely adding HTTP Cache-Control is insufficient for an explicit Cache API writer without policy enforcement.
- Acceptance: Actual production SW tests with admin→viewer→anonymous transitions must never return cached privileged content, including offline and ten-second network delays. Verify legacy caches are removed, not just ignored by the new fetch handler.

<a id="media-01"></a>

### MEDIA-01 — User-controlled highlight channel IDs escape the recording directory and reach recursive deletion

- **Severity:** High
- **Category:** Security / path traversal / destructive filesystem operation (CWE-22, CWE-73). **Confidence:** High; actual FastAPI routing, service registration, path calculation and deletion call reproduced with FFmpeg and deletion mocked.
- **Locations:** `backend/app/routers/highlight.py:53-77`; `backend/app/services/highlight.py:74-77`, `115-116`, `225-229`, `605-610`; `backend/app/routers/channels.py:126-132`; `backend/app/models/channel.py:28-34`.
- **Trigger:** With highlights enabled and a working/cached ErsatzTV channel lookup, an authenticated viewer requests `/api/highlight/status/%2e%2e`. The route decodes the ID to `..`; lookup accepts any nonempty ID as Dispatcharr fallback. Recorder output becomes `<highlight_temp_dir>/..`. A JSON channel-selection request can also carry an absolute or multi-component ID when the user has channel-control permission.
- **Necessary lifecycle precondition:** FFmpeg must still be alive at the 0.5-second startup check for the recorder to enter the service registry. A prompt failed upstream response can prevent registration; a slow connection/response can satisfy it. Subsequent stop or shutdown recursively removes that chosen directory. Idle deletion requires the process still be running when cleanup checks it; do **not** claim unconditional deletion after 120 seconds. Shutdown/explicit stop processes a retained recorder even if FFmpeg later exits.
- **Evidence:** Safe HTTP probe returned `200`, registered `..`, calculated `/tmp/media-review-…/highlights/..`, and called mocked `shutil.rmtree` with that escaped path. Default config is `/tmp/highlights`, so the parent is `/tmp`. All deletion remained mocked.
- **Impact:** A viewer can make a future lifecycle cleanup delete files outside the intended channel buffer directory, subject to OS permissions and prerequisites above. Absolute JSON IDs increase reachable scope for callers with channel-control permission.
- **Fix:** Resolve channels from an authoritative catalog; reject empty, dot, dot-dot and path-like identifiers at API boundaries. Allocate opaque server-generated filesystem directory names independent of channel IDs. Before recursive removal, enforce resolved containment beneath the configured root and reject the root itself.
- **Regression acceptance:** Actual route tests reject encoded dot/dot-dot and JSON absolute/traversal IDs before subprocess creation. Directory cleanup cannot delete a sibling sentinel even when a malicious recorder object exists; normal IDs still start/stop. Exercise failed, slow, cancelled, and later-dead startup paths.

<a id="media-02"></a>

### MEDIA-02 — Public logo requests and async media routes synchronously fetch upstream feeds, blocking every request on the event loop

- **Severity:** High
- **Category:** Availability / synchronous I/O in async endpoints. **Confidence:** High; sibling-task stall reproduced.
- **Locations:** `backend/app/routers/ersatztv.py:44-49`, `66`, `82`, `148`, `337`; `backend/app/services/ersatztv/m3u_parser.py:52-63`; `backend/app/services/ersatztv/xmltv_parser.py:98-108`; `backend/app/routers/highlight.py:72`; `backend/app/services/highlight.py:593`.
- **Trigger:** Cold/expired M3U or XMLTV cache invokes blocking `httpx.get(..., timeout=30)` inside an `async def`. `/api/ersatztv/logos/{channel_id}` is unauthenticated and performs the lookup even for nonexistent channel IDs. A slow/unavailable ErsatzTV instance therefore lets ordinary/public requests stall the backend loop. Failed refreshes leave the cache expired, so subsequent requests repeat it.
- **Evidence:** A mocked 200ms channel lookup in the real async logo handler delayed an unrelated 10ms timer to 201ms. Code allows approximately 30 seconds per network timeout, with parsing also synchronous. Cast lookup already uses `asyncio.to_thread`, demonstrating the inconsistent treatment.
- **Impact:** Authentication, WebSockets, channel controls, health endpoints, and playback segment handling on the same worker stop progressing during that call.
- **Fix:** Async shared clients for feed fetching, or offload the full sync lookup/parse to a bounded thread pool; add single-flight refresh and retry backoff with stale data support. Public logos should not trigger full synchronous catalog refresh.
- **Regression acceptance:** While M3U/XMLTV fetch is deliberately delayed, concurrent health/auth/segment operations remain responsive; many callers share one refresh; repeated upstream failure does not create serial 30-second stalls.

<a id="media-03"></a>

### MEDIA-03 — Authenticated media calls admit unlimited FFmpeg processes and encoding jobs

- **Severity:** High
- **Category:** Security / resource exhaustion (CWE-770). **Confidence:** High; service admission reproduced; no stress load generated.
- **Locations:** `backend/app/routers/cast.py:63-107`; `backend/app/services/cast.py:350-365`; `backend/app/routers/highlight.py:91-130`; `backend/app/services/highlight.py:341-376`, `410-418`, `594-610`.
- **Trigger:** With cast enabled, repeatedly create MPEG-TS sessions for the same valid channel. Every request allocates a new UUID/process; no user/global quota or channel reuse exists. With highlights enabled, repeated WebM exports launch independent VP9 subprocess jobs through the default thread executor, without admission limits. Highlight status can also start recorders for arbitrary distinct IDs.
- **Evidence:** Thirty concurrent mocked `create_session` calls for one channel were all admitted and retained as thirty sessions. Each real MPEG-TS admission calls `CastSession.start` and `Popen`. Cast idle timeout is 300 seconds by default, checked every 30 seconds; it is cleanup, not an admission limit.
- **Impact:** A regular authenticated user can exhaust CPU, process slots, network bandwidth, disk and queued executor work. Many legitimate viewers can trigger the same failure accidentally. Dead highlight recorders are also excluded from idle cleanup (`highlight.py:496`), retaining state/files until stop/shutdown.
- **Fix:** Global and per-user concurrency budgets, bounded export queue with explicit overload responses, same-channel sharing where appropriate, and cleanup for failed/dead/cancelled jobs. Associate process ownership with authenticated identity.
- **Regression acceptance:** Requests beyond configured limits receive 429/503 without spawning/queuing work; cancellations and failures release slots; duplicate same-channel sessions do not exceed the intended process budget; dead recorders are reclaimed.

<a id="media-15"></a>

### MEDIA-15 — Empty channel ID preserves a client-supplied URL as FFmpeg input

- **Severity:** High
- **Category:** Security / server-side request forgery / stream authority
- **Confidence:** High; service behavior reproduced with subprocess creation mocked and independently traced through channel selection.
- **Locations:** `backend/app/models/channel.py:28-34`; `backend/app/routers/channels.py:107-132`; `backend/app/services/highlight.py:60-79`, `590-598`.
- **Prerequisites:** Highlights enabled; caller has channel-control permission (admin, or viewer while user channel selection is enabled); nonempty supplied streamUrl; ErsatzTV lookup returns no match rather than throwing. This is not an anonymous arbitrary-URL endpoint.
- **Trigger:** Channel selection accepts an empty id and a client-chosen streamUrl. `get_stream_url('')` returns None. `HighlightService.start_recording` then preserves the original supplied URL instead of rejecting unresolved channels. A local probe with a synthetic URL confirmed that it became the recorder's source. FFmpeg attempts the outbound input even if its startup subsequently fails.
- **Impact:** A channel-control caller can make the backend media process request a URL outside the configured source catalog, including services reachable only from the server. This bypasses the intended server-side stream resolution. No shell injection or successful internal-service exploitation is claimed.
- **Remediation:** Reject empty/unknown IDs, resolve source/type/URL from an authoritative server-side catalog, and reject rather than retain client input when resolution fails. Apply appropriate network/protocol restrictions to FFmpeg inputs. Treat this with MEDIA-01, but test the network-input boundary independently from filesystem containment.
- **Acceptance criteria:** Empty, whitespace and unknown IDs never start FFmpeg. A supplied off-catalog streamUrl cannot become the process input even if channel lookup fails/returns None. Valid resolved Dispatcharr and ErsatzTV channels still start under the correct permission policy.

<a id="sec-01"></a>

### SEC-01 — Empty signing key passes startup and permits forged administrator tokens

- **Severity:** High. **Confidence:** Confirmed by executable probe. **Category:** Authentication / unsafe configuration. **Prerequisite:** Deployment explicitly provides an empty `JWT_SECRET` (for example, an unset interpolated variable). This is not a bypass with a strong configured key.
- **Location:** `backend/app/main.py:39-50`; related `backend/app/config.py:33` and `backend/app/services/auth.py:48-49`.
- **Cause:** Startup rejects four exact public strings but accepts `""`, whitespace and arbitrarily short secrets. Pydantic preserves an explicitly empty environment string. HS256 accepts the empty key.
- **Trigger / reproduction:** Assign the synthetic test setting `settings.jwt_secret = ''`; call `validate_auth_configuration()` (no exception); sign `{sub:'admin', role:'admin', exp:<future>}` using the empty key and call `GET /api/admin/active-users`. Probe returned **200**. No account password or valid Plex token is required.
- **Impact:** Full administrator impersonation under this configuration, even when login methods are disabled. The public-placeholder protection gives false assurance for a common missing-secret deployment error.
- **Fix:** Reject empty/whitespace-only keys and enforce a meaningful minimum key length before serving any route; keep explicit public-placeholder rejection. Do not silently replace missing production secrets with a fallback.
- **Regression acceptance:** Startup rejects empty, whitespace, short and existing known-public keys regardless of login flags; a sufficiently long random key succeeds. Include an environment-derived `JWT_SECRET=` case.

<a id="sec-02"></a>

### SEC-02 — Explicitly empty local passwords authenticate despite the startup warning

- **Severity:** High. **Confidence:** Confirmed by executable probe. **Category:** Authentication / unsafe configuration. **Prerequisite:** Local authentication enabled and `ADMIN_PASSWORD=` or `VIEWER_PASSWORD=` explicitly configured.
- **Location:** `backend/app/routers/auth.py:51-58`; related `backend/app/main.py:70-76`.
- **Cause:** The credential comparison accepts an empty submitted password when the configured password is an empty string. Startup treats both `None` and `''` as unset, logging that every login will be rejected, but only `None` has that behavior.
- **Trigger / reproduction:** With a synthetic strong JWT key, local auth enabled and `settings.admin_password=''`, startup validation succeeds and warns that every login will be rejected. `POST /api/auth/token` with `{"username":"admin","password":""}` returns **200** and an administrator token.
- **Impact:** Passwordless administrator access for an accidentally empty environment variable; the same defect grants viewer access for empty viewer credentials.
- **Fix:** Require a configured nonempty password before comparison, or normalize blank passwords to disabled accounts; reject unusable local-auth configuration where appropriate. Align the startup diagnostic with actual behavior.
- **Regression acceptance:** `None` and empty configured passwords never authenticate, even for an empty request password; a configured nonempty viewer password can work while the administrator account remains disabled.

<a id="sec-03"></a>

### SEC-03 — Full bearer credentials are written to routine request logs

- **Severity:** High. **Confidence:** Confirmed by local dependency trace and synthetic log probe. **Category:** Sensitive information exposure. **Prerequisite:** Access to application/container logs or their downstream collector; no claim of public log access.
- **Location:** `backend/app/logging_config.py:28` and `64-69`; token sources `backend/app/routers/websocket.py:65` and `backend/app/routers/auth_deps.py:45-46`; `Dockerfile:90` enables default Uvicorn logging.
- **Cause:** WebSockets and HLS URLs contain the reusable application JWT in `?token=...`. The logging interceptor forwards the full formatted message without redaction. Installed Uvicorn's `websockets_impl.py:279-284` logs the complete path/query on acceptance, and `h11_impl.py:481-489` does the same for HTTP access logs. This occurs at INFO; the application's explicit first-eight-character token logs do not prevent it.
- **Trigger / reproduction:** The exact Uvicorn WebSocket log template with `/api/ws?token=DUMMY_BEARER_SECRET&view=live`, passed through `InterceptHandler.emit`, preserves the complete secret. Every real frontend connection constructs that same query shape. HLS requests repeat it.
- **Impact:** Log readers/collectors can replay viewer or administrator credentials for their remaining seven-day token life. Log retention needlessly expands the credential exposure surface.
- **Fix:** Redact credential-bearing query parameters in all configured logging paths, including `uvicorn.error` WebSocket acceptance and HTTP access logs. Prefer short-lived, narrowly scoped streaming/socket credentials over a reusable full-access JWT where feasible; review reverse-proxy logging separately.
- **Regression acceptance:** With synthetic token sent through HTTP HLS and WebSocket handshakes, captured pretty and JSON logs contain no complete token (including record arguments/structured fields), while request diagnostics remain useful.

**Browser manifestation (merged FE-13):** `frontend/src/hooks/useHLSRetry.ts:70-71` logs the full stream URL after retry exhaustion. `frontend/src/services/ersatztvApi.ts:72-75` appends the application JWT to that URL. Warnings are enabled in production, so copied diagnostics can carry a usable credential. Include frontend HLS/Cast logs at every level in the same redaction acceptance test. Browser console access alone is not a new privilege; copying credentials into retained diagnostics expands exposure.

<a id="dev-01"></a>

### DEV-01 — Documented local startup sends API requests to the wrong port

- **Severity:** Medium
- **Category:** Developer experience / configuration
- **Confidence:** High
- **Evidence level:** Source-traced configuration mismatch.
- **Locations:** `README.md:7-15`, `run.sh:19-24`, `frontend/src/services/api.ts:12`, `frontend/.env.example:2-3`, `frontend/vite.config.ts:104-111`
- **Trigger:** Follow README/run.sh in a fresh checkout with no frontend env override, or copy the supplied frontend example. The backend listens on 8001, Vite proxies /api to 8001, but the shared API client defaults to the absolute URL http://localhost:8000/api and the example repeats it. Absolute requests bypass the correct Vite proxy. On a LAN client, localhost also points at the client device.
- **Impact:** Authentication/API calls fail even when both documented dev servers are healthy; other API consumers that use relative /api can behave inconsistently.
- **Remediation:** Default the shared client and frontend example to `/api`, using the existing Vite proxy; document any intentional absolute URL override and keep cast URL derivation covered. Describe generating the required JWT secret during onboarding, since the backend correctly rejects the example placeholder.
- **Acceptance criteria:** In a fresh environment with no frontend .env, run the documented commands and fetch auth config/login through the browser origin. Repeat from a LAN browser. Both must reach the backend on 8001 without manual source edits.

<a id="fe-02"></a>

### FE-02 — Live HLS playlists and segments are cached under the API fallback policy

- Severity: **Medium**. Category: streaming reliability/resource use. Confidence: high. Evidence: **browser-confirmed with generated production service worker**. Shares its routing-policy root cause with FE-01; repair together.
- Locations: `frontend/vite.config.ts:20–32,62–68`; `frontend/src/services/ersatztvApi.ts:72–75`.
- Root cause: The runtime matcher includes `/api/ersatztv/stream`, `/segments` and `/api/cast/hls`. The later `navigateFallbackDenylist` excludes these paths only from SPA navigation fallback; it does not exclude fetches from runtime caching. All successful live playlists and media fragments enter `api-cache`.
- Reproduction: Start HLS playback with the installed worker and inspect `api-cache`; playlist/segment responses will be present. Delay a subsequent playlist refresh beyond ten seconds or interrupt transport. The Chrome probe confirmed a cached sequence-42 playlist was returned with status 200 after API connection drops. Workbox can return the old sliding-window playlist for up to five minutes even though its referenced segments have expired upstream.
- Impact: Stalled/stale live-edge playback during recovery, extra cloning and disk writes for large media segments, and eviction of useful API entries from the shared 50-entry cache. Even cast playlist `Cache-Control: no-store` is not an explicit Workbox exclusion.
- Fix: Make live manifest, segment and streaming endpoints `NetworkOnly`, or bypass the worker. Keep any deliberately cached immutable media separate with explicit size/quota policy.
- Acceptance: Production SW integration asserts none of these endpoints enter caches, and network failure for the manifest surfaces as a transport error instead of stale success. Do not validate only a duplicated regex constant in a unit test.

<a id="fe-03"></a>

### FE-03 — QR authentication survives cancellation/unmount and can authenticate the abandoned flow

- Severity: **Medium**. Category: auth lifecycle/race. Confidence: high. Evidence: **two probe-confirmed paths**.
- Locations: `frontend/src/hooks/usePlexQRAuth.ts:52–80,94–128`; `frontend/src/components/QRPlexLogin.tsx:25–29`.
- Root cause: Cleanup only cancels already-created timers. Neither PIN creation nor PIN polling captures/checks a lifecycle generation after awaiting. `setInterval(async …)` also permits overlapping polls. Cancel/retry/unmount cannot invalidate an in-flight operation, and a completed obsolete operation can clear the replacement flow's timers via shared refs.
- Reproduction A: Defer both `createPlexPin` promises, start the hook, unmount, then resolve them. The probe observes three newly running timers and PIN polling after unmount. React StrictMode effect replay increases exposure during development.
- Reproduction B: Start a pending `checkPlexPin`, press Cancel, then resolve the old check with a token. The probe sees `onSuccess('old-account-token')` fire and status change from idle to success. The callback may exchange the abandoned Plex account's token despite the user's cancellation/new flow.
- Fix: Increment an attempt generation on start, cancel, timeout and unmount; guard every async continuation and success callback. Abort network requests where possible and use serial polling scheduled after completion. Keep timer ownership local to the attempt.
- Acceptance: Deferred creation/poll resolution after cancel, retry, timeout and unmount makes no state/auth changes or new timers; simultaneous slow polls deliver success at most once; an old attempt cannot cancel a newer attempt.

<a id="fe-04"></a>

### FE-04 — A stale 401 response logs out a newly signed-in account

- Severity: **Medium**. Category: auth concurrency/reliability. Confidence: high. Evidence: **probe-confirmed**.
- Location: `frontend/src/services/api.ts:95–115`.
- Root cause: `fetchWithAuth` captures a token for a request but unconditionally calls the global logout action when its eventual response is 401, even if the active session changed during that request.
- Reproduction: Issue `/channels` under token A and hold its response. Log out and authenticate with token B. Resolve A's request with 401. Probe confirms B becomes unauthenticated and its newly persisted token disappears.
- Impact: On slow/broken networks or a fan-out of outstanding guide requests, users can be repeatedly kicked out immediately after successful login. This is not an authorization bypass.
- Fix: Associate requests with an auth-generation/session identity and clear auth only if that identity still owns the active session. Abort old requests on logout while retaining generation checks for completion races.
- Acceptance: Old-account 401 responses never mutate a new account; a 401 for the current session still logs out; same-token reuse should be handled via generation if supported.

<a id="fe-05"></a>

### FE-05 — Live Channel 0 stops following backend channel changes when ErsatzTV is absent

- Severity: **Medium**. Category: core playback/state synchronization. Confidence: high. Evidence: **probe-confirmed store behavior plus complete routed-view trace**.
- Locations: `frontend/src/components/tv/TVView.tsx:166–171`; `frontend/src/stores/tvStore.ts:166–177`; `frontend/src/components/tv/DualModeVideoPlayer.tsx:69–88`.
- Root cause: Selected live channel is a copied `UnifiedChannel` snapshot. The channel-store subscription reloads only EPG when the backend current channel changes. The actual selected stream snapshot is rebuilt only by `initializeTVStore`, which `TVView` calls only when at least one ErsatzTV channel exists.
- Reproduction: Use an empty/unavailable ErsatzTV catalogue (supported optional service), select Channel 0 playing A, then change/clear the live channel from another admin session. The probe establishes `getUnifiedChannels()[0].name === 'B'` but `selectedChannel.name === 'A'`; routed UI never invokes the initializer to repair it in this configuration. Clear-to-null similarly leaves the old stream selected.
- Impact: Live-only installations keep watching stale broadcasts after an administrator changes or clears the shared channel. The desktop sidebar also replaces its live entry with the ErsatzTV error screen when initial catalogue loading fails.
- Fix: Reconcile the selected live snapshot directly in the channel-store subscription or derive it reactively from currentChannel; make live initialization independent of ErsatzTV availability. Keep live controls usable while the optional service fails.
- Acceptance: Routed `TVView` test with zero ErsatzTV channels selects A, switches to B via WebSocket/store update, then clears; player URL and empty-state update each time. Include upstream 503 as well as a successful empty catalogue.

<a id="fe-06"></a>

### FE-06 — Highlight trimming/WebM export downloads a different capture from the preview

- Severity: **Medium**. Category: data correctness/cross-layer contract. Confidence: high. Evidence: source-confirmed by frontend and media reviewer independently.
- Locations: `frontend/src/components/HighlightModal.tsx:73–78,157–172`; `backend/app/services/highlight.py:283–319,337–345`.
- Root cause: Preview creates and caches an MP4 blob. Only an untrimmed MP4 export uses it. Trimming or choosing WebM makes another `POST /highlight/{channelId}` and passes offsets from the old preview. Backend re-reads the current rolling recorder files and applies those offsets to the newly captured buffer; it has no immutable capture identifier.
- Reproduction: Preview a clip containing event X near the beginning; spend 20 seconds adjusting trim, then download the trimmed MP4 or WebM. The rolling buffer has advanced by about 20 seconds, so those offsets refer to another event or X has fallen out of the buffer entirely.
- Impact: Exported footage differs from what the user reviewed and trimmed. The very event they intended to save may be missing despite a successful download.
- Fix: Capture once, return an immutable capture ID with bounded retention, and perform preview/format conversion/trimming against that same artifact; alternatively transform the held preview blob without recapturing.
- Acceptance: A fake clock/numbered source frames test advances the live buffer between preview and export and proves identical source frames across untrimmed, trimmed and alternate-format exports.

<a id="fe-07"></a>

### FE-07 — Cast controls forget a connected, playing receiver after player remount

- Severity: **Medium**. Category: device lifecycle/UI correctness. Confidence: high. Evidence: **probe-confirmed with a Cast SDK test double**; real hardware not exercised.
- Locations: `frontend/src/hooks/useChromecast.ts:91–98,224–235`; `frontend/src/components/CastButton.tsx:63–78`; `frontend/src/components/tv/DualModeVideoPlayer.tsx:80,99`.
- Root cause: Hook state initializes disconnected/not casting. SDK initialization reads only availability, ignoring `getCurrentSession`, `RemotePlayer.isConnected`, `isMediaLoaded` and `playerState`. It depends on future change events to populate a state that is already true. Player remounts occur on channel changes and HLS retries.
- Reproduction: Start casting, change local channel or refresh player while receiver continues to play, and mount a new hook against the unchanged connected SDK singleton. Probe supplies connected/loaded/PLAYING initial SDK state; hook reports available=true, connected=false, casting=false and no device name.
- Impact: The button loses its stop affordance and opens a device request instead of controlling existing playback until another SDK state event happens. A stable existing session is not required to emit a change after listener registration.
- Fix: Hydrate complete state from the SDK snapshot on attachment; preferably own the singleton Cast session in a stable service/store above remounting players and subscribe UI instances to it.
- Acceptance: Mount/remount against an already connected playing/paused receiver and show the correct device and stop action without synthetic change events; test channel switches and HLS retries on real hardware.

<a id="fe-08"></a>

### FE-08 — Cast backend sessions lose ownership on replacement and disconnect races

- Severity: **Medium**. Category: resource lifecycle/concurrency. Confidence: high. Evidence: **two probe-confirmed paths with SDK/API doubles**.
- Locations: `frontend/src/hooks/useChromecast.ts:294–306,480–481,511–513,570–574`.
- Root cause: A single module variable is overwritten by each completed create request; no prior session cleanup or attempt-generation check exists. Session-ended cleanup only knows IDs that already resolved. Async creation and load continuations remain active after disconnect/stop or replacement.
- Reproduction A: Cast MPEG-TS A, start B, stop casting. Probe observes no deletion before B replaces A and only DELETE B at the end; A is abandoned until server cleanup.
- Reproduction B: Defer createCastSession, end receiver session, then resolve creation. Probe observes no cleanup of the late ID, a media load on the old session, and isCasting=true after the disconnection. Real `loadMedia` may reject, which helps this path but is not an ownership strategy; overlapping starts can also cause one failure's catch to delete the other request's current session.
- Impact: Unnecessary transcoding processes/session slots survive replacement, bounded by whatever server idle cleanup exists; stale requests can alter the latest receiver playback or state.
- Fix: Use an explicit cast-operation generation and operation-owned backend ID; clean the previous session when replaced and immediately delete any created ID whose operation is no longer current. Catch handlers must only delete their own ID, not a mutable global current ID.
- Acceptance: A→B replacement deletes A once; stop/disconnect during creation deletes late result and never loads it; out-of-order create/load success/failure cannot delete or replace the winning session.

<a id="fe-09"></a>

### FE-09 — Player keyboard shortcuts hijack native focused controls

- Severity: **Medium**. Category: accessibility/input correctness. Confidence: high. Evidence: **probe-confirmed** for shared live hook; duplicate routed HLS logic source-confirmed.
- Locations: `frontend/src/hooks/useVideoKeyboardShortcuts.ts:32–50,68–75`; `frontend/src/components/tv/DualModeVideoPlayer.tsx:574–593,615–622`.
- Root cause: Global key listener skips input/textarea/select but handles events from any other descendant, including buttons, Radix sliders and editable/widget elements. It neither respects defaultPrevented nor preserves native control key handling.
- Reproduction: Tab to Mute/Fullscreen/Cast/Filter inside the live player and press Space. Probe confirms defaultPrevented=true and onPlayPause invoked; the focused control's normal Space click is suppressed. HLS uses the same pattern; arrow handlers can fight slider/menu key bindings.
- Impact: Keyboard and assistive-technology users activate playback instead of the focused action. This directly breaks native button operation rather than being a stylistic accessibility concern.
- Fix: Scope player-wide shortcuts to an unhandled player surface, ignore interactive/editable targets and defaultPrevented events, and consolidate duplicate shortcut logic. Preserve keyboard navigation and widget semantics.
- Acceptance: Space activates every focused native/Radix control exactly once without toggling playback; body/player-background Space still toggles playback; focused sliders/menu items keep their arrow behavior.

<a id="fe-10"></a>

### FE-10 — Sustained WebSocket outage permanently disconnects the UI without a recovery control

- Severity: **Medium**. Category: availability/recovery. Confidence: high. Evidence: source-confirmed.
- Locations: `frontend/src/hooks/useWebSocket.ts:249–265,287–290`; `frontend/src/components/tv/TVView.tsx:41–42`; `frontend/src/components/ConnectionStatus.tsx:38–40`.
- Root cause: After five failed retries (backoffs total about 25 seconds plus connection-failure time), no further reconnect is scheduled. The hook exports manual reconnect, but TVView discards it. The only status button toggles its own visibility. There is no online/visibility recovery handler.
- Reproduction: Stop the backend/reject WebSocket upgrades long enough to exhaust all retries, then restore it without reloading the page. HTTP/media may recover, but socket status stays disconnected indefinitely, shared channel/settings updates and presence/chat never resume. The header's Refresh video action only remounts the player and does not reconnect the view's socket.
- Fix: Expose a genuine reconnect control and resume attempts on online/visibility recovery, or continue capped/jittered backoff with appropriate rate limits. Keep auth-expired terminal handling distinct.
- Acceptance: Exhaust retries, restore service, then recover through a visible action or automatic online transition without a page reload; no retry occurs after logout/token-expiry close.

<a id="fe-11"></a>

### FE-11 — Chat silently discards the draft when the socket cannot send

- Severity: **Medium**. Category: user data loss/delivery feedback. Confidence: high. Evidence: source-confirmed.
- Locations: `frontend/src/components/ChatPanel.tsx:60–65`; `frontend/src/hooks/useWebSocket.ts:309–323`; `frontend/src/components/tv/TVView.tsx:463–466`.
- Root cause: ChatPanel treats a void callback invocation as successful delivery and immediately empties the input. `sendChatMessage` silently returns if chat is disabled or socket is not OPEN; connection state is not supplied to the panel. Even an initial connecting window can trigger this.
- Reproduction: Type a message while the socket is reconnecting, press Send/Enter. The UI clears the text, no frame is sent and no error/pending indicator appears. A GIF selection similarly closes despite no send.
- Fix: Return an explicit send result or use an acknowledged/pending delivery model; preserve unsent drafts and present connection status. Disable send while disconnected only if the draft remains editable/preserved.
- Acceptance: Send while CONNECTING/CLOSING/CLOSED leaves draft intact and explains failure; successful acknowledged send clears exactly once; loss immediately after send is distinguished from acknowledgement.

<a id="media-04"></a>

### MEDIA-04 — FFmpeg stderr pipes are never drained, eventually freezing recording/transcoding

- **Severity:** Medium
- **Category:** Process lifecycle / availability. **Confidence:** High; pipe mechanism reproduced locally, source tracing confirmed.
- **Locations:** `backend/app/services/highlight.py:164-176`; `backend/app/services/cast.py:125-138`.
- **Trigger:** A running FFmpeg emits enough warnings/errors to fill its stderr pipe. Both services set `stderr=PIPE` but only read it after process exit. There is no background reader. Network reconnection and damaged transport streams can generate persistent warnings.
- **Evidence:** A harmless local child writing 1MB to stderr blocked with `poll() is None` and never wrote a completion marker. Draining the pipe using `communicate()` let it exit and create the marker. No real FFmpeg stream was used for this probe.
- **Impact:** FFmpeg blocks in write while `is_running` remains true. Segment production/highlight capture silently stops; status polls keep the stalled process alive.
- **Fix:** Drain stderr continuously into a bounded log/ring buffer, or redirect to an appropriate bounded logging sink/DEVNULL. Use `start_new_session=True` instead of `preexec_fn=os.setsid` when touching subprocess launch.
- **Regression acceptance:** Fake child writes beyond pipe capacity while producing media progress; service continues draining, reports failure/progress accurately, and terminates/reaps it on stop.

<a id="media-05"></a>

### MEDIA-05 — Concurrent highlight exports share mutable input/output files and can delete each other's results

- **Severity:** Medium
- **Category:** Concurrency / media corruption. **Confidence:** High; deterministic two-export race reproduced.
- **Locations:** `backend/app/services/highlight.py:280-316`, `328-330`, `346`, `377`, `418-439`; recorder lock is used for start/stop, not export.
- **Trigger:** Two users, or preview/download requests, export the same channel simultaneously. Both use `concat.txt` and `highlight.mp4`/`highlight.webm`. Each FFmpeg runs with `-y`; the first completion deletes files needed by the other. Meanwhile live ring segments can wrap and stop/idle cleanup can remove the same directory while an export is running.
- **Evidence:** Two real async service calls with synchronized mocked subprocess completions targeted identical outputs; one returned MP4 and the other returned `Highlight file not created`. They could also return another request's trim or corrupt output when encoders overlap.
- **Impact:** Missing/corrupt/wrong clips during normal concurrent use. Export duration can reach 120 seconds while default buffer is only 60 seconds, so referencing live ring filenames is not an immutable capture.
- **Fix:** Create a per-export temporary workspace and copy/reflink completed input segments into an immutable snapshot; use unique concat/output names; coordinate snapshot creation with recorder lifecycle; finally-cleanup on success, failure and cancellation.
- **Regression acceptance:** Simultaneous exports with different trim ranges/formats each return their own bytes. Buffer wrap and recorder stop during export cannot change/remove snapshot inputs. Timeout/cancel leaves no export debris.
- **Boundary:** FE-06 covers the separate preview-then-later-download issue caused by recapturing the rolling buffer on the second request.

<a id="media-06"></a>

### MEDIA-06 — ErsatzTV lookup failure disables independent Dispatcharr highlights and cast

- **Severity:** Medium
- **Category:** Integration isolation / availability. **Confidence:** High; exception path reproduced.
- **Locations:** `backend/app/services/highlight.py:60-77`, `590-595`; `backend/app/routers/highlight.py:72`; `backend/app/routers/cast.py:85-98`.
- **Trigger:** ErsatzTV has no successful cached M3U (or otherwise throws during lookup), but the requested channel belongs to Dispatcharr. `get_stream_url` calls ErsatzTV first without handling that provider's failure, so it never reaches Dispatcharr URL construction.
- **Evidence:** Injecting `RuntimeError('M3U offline')` into ErsatzTV lookup made `get_stream_url('valid-dispatcharr-uuid')` raise directly. Highlight status propagates a 500; cast catches the exception and misreports channel-not-found 404. Channel-switch recording uses the same resolver.
- **Impact:** An unrelated optional provider outage breaks Dispatcharr media features even while Dispatcharr is healthy.
- **Fix:** Use explicit channel source/type and resolve against the correct provider. As an interim measure catch provider-specific availability errors and fall back only for validated Dispatcharr IDs; do not restore arbitrary-ID acceptance.
- **Regression acceptance:** Dispatcharr cast/highlights work when ErsatzTV cold fetch fails; genuine unknown IDs return404, and provider outages receive accurate503 responses.

<a id="media-07"></a>

### MEDIA-07 — HLS rewriting misses URI-bearing tags and playlists with query strings

- **Severity:** Medium
- **Category:** Streaming protocol correctness. **Confidence:** High; parser output reproduced.
- **Locations:** `backend/app/services/ersatztv/hls_rewriter.py:147-170`.
- **Trigger:** Playlist contains `#EXT-X-MAP:URI="init.mp4"`, `#EXT-X-KEY:...URI="key.bin"`, or audio/subtitle `#EXT-X-MEDIA` URIs. Every `#` line is preserved untouched, leaving those requests outside the authenticated proxy. `variant.m3u8?session=123` also fails `endswith('.m3u8')`, so it goes through the raw segment endpoint; its own relative segment URLs are never rewritten.
- **Evidence:** A synthetic manifest retained both MAP/KEY URLs exactly and rewrote the query-bearing variant to `/api/ersatztv/segments/...`, rather than `/stream/...`.
- **Impact:** Encrypted HLS, fMP4 initialization, alternate audio/subtitles and tokenized variants fail for remote clients or access unproxied internal URLs.
- **Fix:** Parse HLS tags/attributes and classify playlist paths with a URL parser. Rewrite all supported URI-bearing attributes and nested playlists while preserving query parameters and authentication.
- **Regression acceptance:** Round-trip tests for KEY, MAP, MEDIA, I-FRAME-STREAM-INF and query-bearing nested variants; browser/player integration consumes all required resources through the intended proxy.

<a id="media-08"></a>

### MEDIA-08 — Manifest and logo fetches remain unbounded despite the segment-size cap

- **Severity:** Medium
- **Category:** Resource exhaustion / upstream response limits. **Confidence:** High from reachable request/body handling; no oversized load generated.
- **Locations:** `backend/app/routers/ersatztv.py:143-169`, `191-198`, `345-352`; `backend/app/services/ersatztv/hls_rewriter.py:89-99`; `backend/app/services/ersatztv/m3u_parser.py:60-63`; `backend/app/services/ersatztv/xmltv_parser.py:105-108`.
- **Trigger:** The manifest endpoint accepts arbitrary encoded URLs on the allowed ErsatzTV origin and fetches with `stream=False`, without validating content type, manifest header, or response size. A large media/file response from that origin is buffered in full and then split/rewritten. Logo bodies and feed bodies are also fully buffered; logo is public.
- **Impact:** A large or continuous allowed-origin response can consume process memory; inactivity timeout does not impose a total-body budget. The documented 64MiB segment limit does not protect these paths, and string parsing/copies amplify memory usage.
- **Fix:** Stream and enforce distinct byte/time budgets for manifests, images and feeds; validate MIME/manifest structure; restrict proxy requests to intended resource paths/types. Parse bounded feeds off-loop.
- **Regression acceptance:** Chunked bodies with absent/false Content-Length abort at the appropriate cap and close upstream resources; a video body supplied to the manifest route is rejected without fully buffering it.

<a id="media-09"></a>

### MEDIA-09 — Public logo proxy trusts feed-supplied targets and serves arbitrary active content on the application origin

- **Severity:** Medium
- **Category:** Conditional SSRF / same-origin content injection. **Confidence:** High on behavior; exploit requires control/malformation of configured M3U logo metadata or its target response.
- **Locations:** `backend/app/services/ersatztv/m3u_parser.py:99`, `135-140`; `backend/app/services/ersatztv/epg_service.py:38-44`; `backend/app/routers/ersatztv.py:328-354`.
- **Trigger:** A channel's `tvg-logo` points to an unexpected host/private endpoint, or returns HTML/SVG with script. The public route makes `client.get(logo_url)` without the stream allowlist and forwards the content type/body unchanged. Prefix-based logo rewriting is not an origin validator.
- **Evidence:** Mocked logo metadata `http://other-host.invalid/secret` was fetched and returned with `text/html; charset=utf-8` and unchanged `<script>…</script>` content. No network call or browser exploit was performed. Navigating to the resulting logo endpoint can execute active HTML in the app origin absent an external CSP; merely embedding HTML in `<img>` does not execute it.
- **Impact:** Configured-feed metadata crosses both a server network trust boundary and a browser origin boundary. This is **not** an arbitrary unauthenticated URL parameter vulnerability: callers select existing channel IDs; an upstream-control precondition is required.
- **Fix:** Explicitly allow trusted image origins and validate every redirect; bound body size; accept/decode safe raster formats or sanitize SVG; never forward HTML/JS as app-origin content. Add restrictive response CSP and nosniff as defense in depth.
- **Regression acceptance:** Off-allowlist feed logo URL makes no request; HTML/script SVG are rejected or safely transformed; legitimate logos still render.

<a id="media-10"></a>

### MEDIA-10 — Mid-segment upstream failures are silently finalized as successful truncated responses

- **Severity:** Medium
- **Category:** Streaming integrity / error handling. **Confidence:** High; async iterator probe reproduced.
- **Locations:** `backend/app/routers/ersatztv.py:292-318`, particularly `304-308`.
- **Trigger:** Upstream sends some segment bytes then raises `httpx.ReadError`/timeout. Generator catches the error and returns normally. Downstream receives200 and a normally completed body; upstream Content-Length is not forwarded, so transport framing does not expose truncation.
- **Evidence:** Mock upstream yielded `b'partial-media'` then raised ReadError; actual response had status200 and its iterator completed normally with only those bytes.
- **Impact:** Clients/cache layers can treat corrupt media as a complete successful segment, producing decoding errors instead of a retryable transport failure. This contradicts nearby size-cap logic, which deliberately aborts on truncation.
- **Fix:** After headers are sent, propagate/abort the stream on upstream I/O error while retaining `finally` resource closure. Avoid presenting a clean end-of-body for a failed segment.
- **Regression acceptance:** Inject mid-body upstream read failure; client observes an incomplete/failed stream, not a normally completed200, and both response/client resources close.

<a id="media-11"></a>

### MEDIA-11 — Failed EPG refreshes serialize one new timeout per waiting caller instead of sharing the failure

- **Severity:** Medium
- **Category:** Cache concurrency / outage amplification. **Confidence:** High; concurrent failed-refresh probe reproduced.
- **Locations:** `backend/app/services/epg_service.py:181-196`; analogous retry-on-every-call behavior in `backend/app/services/ersatztv/m3u_parser.py:73-78` and `xmltv_parser.py:117-122`.
- **Trigger:** An expired populated EPG cache has many concurrent readers while upstream fails. Refresh lock is held for a fetch; failure never updates retry state/expiry. Each queued reader then acquires the lock and performs another failed fetch before receiving stale data.
- **Evidence:** Five concurrent `_ensure_cache` calls with a 30ms failed-refresh stub resulted in five calls and ~155ms total, rather than one shared30ms failure. At the actual30s timeout the fifth caller can wait roughly150s despite stale data being available.
- **Impact:** Outages cause long response queues and repeated upstream load; stale-cache fallback is operationally ineffective under concurrency.
- **Fix:** Separate successful-cache expiry from next retry time; single-flight callers share the current refresh outcome, and stale results are returned immediately during a bounded backoff interval.
- **Regression acceptance:** N concurrent expired-cache callers share one failed attempt; subsequent requests within backoff get stale data without network waits; recovery refresh occurs after backoff and updates cache.

<a id="ops-01"></a>

### OPS-01 — Concurrent releases can deploy older code after newer code

- **Severity:** Medium
- **Category:** Deployment / concurrency
- **Confidence:** High
- **Evidence level:** Source-traced; no production deployment attempted.
- **Locations:** `.gitea/workflows/build.yml:35-38`, `.gitea/workflows/build.yml:148-175`, `.gitea/workflows/build.yml:226-256`
- **Trigger:** Push commit A, then B while A's tests or image build are slower. Both release jobs act on the same image `latest` tag, remote compose pathname and service; no concurrency group, host-side lock or latest-commit check orders them. B can deploy and pass its health poll, then A can overwrite the compose file and downgrade production. SCP and compose calls from overlapping jobs can also cross.
- **Impact:** A successful newer release can silently be replaced by older application/security code. Per-job version health polling does not prevent a later job from replacing it.
- **Remediation:** Serialize deployment to this target and enforce an explicit ordering policy; ensure stale commits cannot publish `latest` or overwrite the remote deployment after newer commits. The critical section must include tag promotion, compose installation and verification, with a host-side lock if independent runners can deploy.
- **Acceptance criteria:** Interleave A and B with A delayed before deployment. Once B is deployed, A must be refused as stale. Independent deployment clients must not overwrite the same compose file concurrently. Validate supported Gitea runner concurrency semantics before selecting syntax.

<a id="ops-02"></a>

### OPS-02 — Rebuilding a release reuses a tag that Compose may never pull

- **Severity:** Medium
- **Category:** Deployment / artifact identity
- **Confidence:** High
- **Evidence level:** Source-traced; local Docker cache behavior not exercised against the host.
- **Locations:** `.gitea/workflows/build.yml:177-182`, `.gitea/workflows/build.yml:206-230`, `.gitea/workflows/build.yml:254-264`, `stack/docker-compose.yaml:26-32`
- **Trigger:** Rerun the same commit on the same UTC day. Version is only date plus seven-character SHA, so the rerun overwrites the existing version tag. A `--pull` build with mutable base images/tool downloads can produce a different image for that same version. Deployment runs only `docker compose up -d`; no pull command or `pull_policy: always` is supplied. A host that already has the version tag can retain the earlier local image.
- **Impact:** A pipeline can build, scan and push one image while the host continues running another. Both report the same APP_VERSION, so health verification can falsely confirm the newly built artifact. This defeats the documented immutable-release contract.
- **Remediation:** Deploy an image digest, or give every build a unique immutable identifier and enforce registry immutability. Ensure deployment resolves/pulls the desired artifact. Include the unique build identifier/digest in verification; merely adding a pull does not make overwritten historical tags immutable.
- **Acceptance criteria:** Build two different images from one commit on one day. Deploying the second must change the running image ID, and verification must distinguish it from the first. A rollback must resolve exactly the previously recorded artifact.

<a id="sec-04"></a>

### SEC-04 — Channel control bypasses the existing stale-administrator check

- **Severity:** Medium. **Confidence:** Confirmed by executable ASGI probe. **Category:** Authorization inconsistency. **Prerequisite:** Previously issued administrator JWT remains valid after its admin grant is removed; user channel selection is disabled.
- **Location:** `backend/app/routers/auth_deps.py:175-176`; entry point `backend/app/routers/channels.py:107-110`.
- **Cause:** `require_admin` re-evaluates current configuration, while `require_channel_control` accepts every `role='admin'` claim without using that check.
- **Trigger / reproduction:** Mint a synthetic admin token for `former-admin`; current local admin is `admin`, Plex auth disabled, current Plex admin list empty. With that token, `PUT /api/settings` returns **403**, but `PUT /api/channels/current` with a complete valid channel body returns **200** and updates global channel state.
- **Impact:** Demoted administrators retain control over everyone's live channel until token expiry, despite losing other administration rights. Existing admin revalidation does not enforce a consistent boundary.
- **Fix:** Share a current-admin authorization predicate between both dependencies. If no current administrator grant exists, treat the user under ordinary channel-selection policy instead of trusting the stale role.
- **Regression acceptance:** The same demoted token is denied both admin operations and channel selection when viewer selection is off; channel selection follows viewer policy when enabled; legitimate local/Plex owner/list/default admins remain supported.

<a id="sec-05"></a>

### SEC-05 — A viewer can poison presence data and disable the administrator user list

- **Severity:** Medium. **Confidence:** Confirmed by executable ASGI and message-handler probe. **Category:** Untrusted input validation / authenticated denial of service.
- **Location:** `backend/app/routers/websocket.py:165-169`; sink `backend/app/services/presence.py:112-115`; failure point `backend/app/routers/admin.py:37-55`.
- **Cause:** Raw JSON `channel` and `programme` values are stored in a dataclass without type validation. The admin endpoint later constructs Pydantic `ActiveUser` models requiring strings, which raises for object/list values.
- **Trigger / reproduction:** An authenticated viewer sends `{"type":"channel_update","channel":{"invalid":"object"},"programme":[]}` and continues pinging. `GET /api/admin/active-users` returns **500** for an administrator. Removing that connection restores **200**, as reproduced locally.
- **Impact:** Any viewer can keep the active-user dashboard broken for every administrator while remaining connected. Large strings also lack application-level bounds, although resource exhaustion was not load-tested.
- **Fix:** Validate each WebSocket message with a discriminated schema before mutating shared state; constrain channel/programme to bounded strings or null and validate the top-level object. Reject malformed messages locally with a documented response or close code.
- **Regression acceptance:** Object/list/numeric channel and programme values cannot enter presence; invalid messages do not make the admin endpoint fail; valid null and string values still work. Include malformed top-level JSON types and nonstring nicknames/content because those currently raise as well.

<a id="sec-06"></a>

### SEC-06 — An established WebSocket remains authorized after its JWT expires

- **Severity:** Medium. **Confidence:** Confirmed by synthetic expiring-token probe. **Category:** Authentication lifetime enforcement.
- **Location:** `backend/app/routers/websocket.py:52-58`, `86`, and `125-131`.
- **Cause:** Token validity is checked only during connection establishment, and the helper discards the expiry value. The receive loop has no expiry timer or subsequent authorization check; broadcasts also continue indefinitely.
- **Trigger / reproduction:** Establish a fake transport using a correctly signed synthetic token with an expiry one second ahead; wait two seconds. A direct `verify_token` now rejects it, but the existing endpoint accepts and broadcasts `chat_message`, which appears in chat history. The probe exercises the actual endpoint loop with a mocked transport.
- **Impact:** An expired session can continue receiving live channel/settings/chat updates and sending chat for as long as its socket survives, beyond the documented seven-day JWT lifetime. This is distinct from the project's acknowledged stateless revocation tradeoff.
- **Fix:** Retain the authenticated expiry and close the socket at expiration with the client's recognized authentication close code; ensure an idle connection expires as well as an active sender. Reauthentication must use a newly valid credential.
- **Regression acceptance:** Short-lived valid token connects successfully; at expiry the socket closes with 4001, no later message is accepted, no further broadcasts are received, and presence/connection/nickname state is cleaned up.

<a id="sec-07"></a>

### SEC-07 — A broadcast timeout silently strands an otherwise live client

- **Severity:** Medium. **Confidence:** Confirmed by mocked transport probe. **Category:** Reliability / connection lifecycle.
- **Location:** `backend/app/services/channel_state.py:161-184`; ping path `backend/app/routers/websocket.py:161-164`.
- **Cause:** A failed/timed-out send removes the socket from `_active_connections` but does not close it or terminate its receive loop. The socket may recover from transient backpressure and continue receiving pings/replying with pongs, while it can never receive later broadcasts.
- **Trigger / reproduction:** Mock the first `send_text` to time out and subsequent sends to succeed. After two broadcasts there is only **one send attempt**, **zero close attempts**, yet `handle_client_message(..., {'type':'ping'}, ...)` still sends `{'type':'pong'}`.
- **Impact:** A client appears connected but permanently misses global channel changes, settings changes and chat until some unrelated reconnect. Presence may continue reporting it active. The earlier bounded-send fix prevents a global hang but leaves this recovery gap.
- **Fix:** Explicitly close/drop the failed connection using a bounded cleanup path, coordinating with endpoint cleanup so the frontend reconnects and resynchronizes. Do not leave an accepted socket outside the broadcast set indefinitely.
- **Regression acceptance:** A transient send timeout produces an observable close/reconnect; other clients keep receiving broadcasts; the reconnect receives current state; connection/presence/nickname records are cleaned exactly once.

<a id="sec-08"></a>

### SEC-08 — Unexpected upstream status payloads crash the whole combined status endpoint

- **Severity:** Medium. **Confidence:** Confirmed by mocked upstream payload probe. **Category:** External API robustness / fault isolation. **Prerequisite:** One configured external service returns malformed JSON, an unexpected JSON shape or invalid field types.
- **Location:** `backend/app/services/status_service.py:58-69`, `95-100`, `290-295`, and `364-368`.
- **Cause:** Status code 200 is treated as valid JSON/schema; parsing and model construction errors are outside the `httpx.HTTPError` handling. The combined `asyncio.gather` propagates either service's exception, losing even a healthy service's status.
- **Trigger / reproduction:** Mock ErsatzTV sessions data as `{'error':'maintenance'}` with empty channel/profile lists. `get_ersatztv_status()` raises **AttributeError** rather than returning a typed failure. An HTML 200 response similarly makes `.json()` raise. The admin router forwards these exceptions as 500.
- **Impact:** The diagnostic dashboard stops reporting both services exactly when an upstream deployment, proxy or schema problem needs investigation. No claim that an ordinary viewer controls the upstream response.
- **Fix:** Validate upstream response shape and expected fields, convert decoding/schema failures to a per-service error result, and isolate failures when combining statuses. Preserve known healthy service information.
- **Regression acceptance:** HTML 200, object-instead-of-list, malformed session entry and invalid Dispatcharr field tests all return a valid combined status with one clear service error; the other service's health remains visible.

<a id="fe-12"></a>

### FE-12 — Now-playing and presence metadata do not advance at programme boundaries

- Severity: **Low**. Category: time/state correctness. Confidence: high. Evidence: source-confirmed.
- Locations: `frontend/src/components/tv/TVView.tsx:32–33,94–122,180–192`.
- Root cause: ErsatzTV current title is calculated from wall time only when TVView happens to render, with no clock subscription. Descendant sidebar/grid timers re-render those descendants, not TVView. Live currentProgram is fetched on channel changes and then at a two-hour interval only while live is selected and ErsatzTV channels exist.
- Reproduction: Select an ErsatzTV programme just before it ends, leave the page idle without chat/settings/channel changes, then inspect the header and admin presence after the next programme begins. Both retain the prior title until another parent state change or the two-hour data refresh. Live guide metadata remains stale until its two-hour fetch; with no ErsatzTV catalogue it never periodically refreshes at all.
- Impact: Incorrect programme identification and presence information; the guide may lose the live programme box when its stale interval ends.
- Fix: Derive current programmes from a shared minute/boundary clock; independently schedule live EPG refresh at programme end with a bounded polling fallback, unaffected by the optional ErsatzTV catalogue.
- Acceptance: Fake-clock test crosses programme boundaries without unrelated UI/network events and updates header, presence and live EPG at a defined bounded delay.

<a id="media-12"></a>

### MEDIA-12 — Trending GIF cache ignores the requested limit

- **Severity:** Low
- **Category:** API contract / cache key correctness. **Confidence:** High; reproduced.
- **Locations:** `backend/app/services/gif.py:59-64`, `74`, `92-94`; `backend/app/routers/gif.py:67-81`.
- **Trigger/evidence:** Prime trending cache with25 GIFs then request limit1: service returns25. Prime it with1 then request50: it continues returning1 for five minutes. Cached pagination is likewise unchanged.
- **Impact:** Client grid/result counts violate request parameters; one caller's choice controls later callers' results.
- **Fix:** Cache a fixed maximum batch and slice per request with correct pagination, or key by limit.
- **Regression acceptance:** Both small→large and large→small requests respect limits and pagination without cross-request contamination.

<a id="media-13"></a>

### MEDIA-13 — Malformed/duplicate M3U entries can silently select the wrong channel

- **Severity:** Low
- **Category:** Parser robustness / identity correctness. **Confidence:** High; both cases reproduced.
- **Locations:** `backend/app/services/ersatztv/m3u_parser.py:108-123`.
- **Trigger/evidence:** `#EXTINF` for channel one missing its URL followed by another EXTINF and channel-two URL yields just channel one pointing at channel two's stream; the inner loop skips the next metadata record. Input IDs `a`, `a_3`, `a` produce IDs `a`, `a_3`, `a_3`: generated collision suffix is not checked against `seen_ids`.
- **Impact:** Wrong stream under a channel name, lost channels, ambiguous ID lookup, unstable React identity and incorrect EPG association when provider data is malformed/colliding.
- **Fix:** Stop/skip a malformed entry at a new EXTINF boundary; ensure generated IDs are actually unique and retain a separate XMLTV identity when deduplicating.
- **Regression acceptance:** Missing-URL records cannot consume the following channel; adversarial preexisting suffixes yield unique stable IDs and unambiguous lookup.

<a id="media-14"></a>

### MEDIA-14 — Highlight segment metadata grows without bound even though media files wrap

- **Severity:** Low
- **Category:** Resource lifecycle / long-running performance. **Confidence:** High; actual local FFmpeg synthetic-input probe reproduced.
- **Locations:** `backend/app/services/highlight.py:143-150`, `287-305`.
- **Trigger:** A channel remains watched/recorded continuously. `-segment_wrap` limits filenames, but no segment-list limit is configured. Every exported highlight reads/splits the entire historical flat list and performs filesystem checks before deduplicating.
- **Evidence:** Local FFmpeg lavfi probe used wrap3 and created10 completed segments: only3 media files were reused but `segments.txt` had10 lines. Source comment at299 acknowledges indefinite list growth. At default10s segments this adds8,640 entries/day/channel and increases synchronous export preparation with uptime.
- **Impact:** Metadata storage and export startup work scale with uptime rather than the configured60-second buffer.
- **Fix:** Configure an actually bounded segment manifest/list or maintain bounded completed-segment metadata; deduplicate before repeated stat calls and keep snapshot work off-loop.
- **Regression acceptance:** Record many wrap cycles; manifest entry count and export preparation remain bounded by buffer capacity, while playback order is correct.

<a id="qa-01"></a>

### QA-01 — Backend tests inherit local integration settings and can call the network

- **Severity:** Low
- **Category:** Test reliability / isolation
- **Confidence:** High
- **Evidence level:** Reproduced under isolated configuration and a nonlocal socket guard.
- **Locations:** `backend/app/config.py:98-101`, `backend/tests/routers/test_ersatztv.py:34-45`, `backend/tests/routers/test_auth.py:346-373`, `backend/app/routers/auth.py:112-113`
- **Trigger:** Run tests with an ERSATZTV_BASE_URL other than the hardcoded mocked host: ten router tests fail because origin validation rejects fixtures. Separately, Plex success tests mock validate_plex_token and check_server_access, but leave determine_role's owner lookup live. Config loaded from a local .env can therefore drive external requests. A guard blocking nonlocal socket connections caught four such auth tests; emptying the unused Plex settings restored them.
- **Impact:** The suite is not hermetic: results depend on developer environment and can incur network calls with test tokens and locally configured owner credentials. Green CI on default settings does not establish isolation.
- **Remediation:** Install a shared fixture/config override before application import, disable dotenv for tests, provide explicit synthetic settings and fail unexpected external transport calls. Mock the complete Plex role determination boundary where it is outside the test's subject; derive fixture hosts from explicit test config.
- **Acceptance criteria:** All 603 tests pass with arbitrary hostile parent environment values and with all external networking denied. Assert the mock transport receives every expected external call. Test origin rejection separately from happy-path fixtures.

## Coverage gaps and decisions for the next agents

These are follow-up items, **not additional confirmed findings** and not included in the severity totals.

| Area | Remaining question or coverage gap | Useful next validation |
| --- | --- | --- |
| Exposure and abuse budgets | External gateway throttling, intended audience and connection limits were not inspected. Login/chat/WebSocket limits are not evident in the reviewed application. | Document intended exposure and enforce/test budgets at the actual trusted ingress and process boundary. Avoid assuming a private URL is an authorization control. |
| Session identity and revocation | Presence/nicknames use client-supplied session IDs. The compatibility branch in `_admin_in_current_config` accepts existing admin claims when Plex auth plus owner token are configured; immutable Plex identity/grant provenance is not retained in `TokenPayload`. | Decide whether multi-tab presence and revoked owner/admin grants need stronger identity binding. A stateless seven-day revocation delay is distinct from SEC-06 extending a socket beyond actual expiry. |
| Core TV and Cast coverage | No dedicated tracked tests were found for the routed `TVView`, `DualModeVideoPlayer`, `TVEPGGrid`, `tvStore`, `useChromecast`, `useHLSRetry` or `CastButton`; parent tests often mock those layers. Backend Cast also lacks dedicated test files. | Add a small number of cross-component scenarios covering the concrete failures in this report, then a receiver/device smoke test. |
| PWA tests | Existing tests re-create regex/config constants and assert their own values; they do not execute the generated worker. | Keep the generated-worker account transition and live-playlist tests as build integration checks. |
| Async lifecycle coverage | Existing QR tests generally resolve requests before cancellation; shortcut tests omit focused native controls; mock suites do not exercise arbitrary completion order. | Use deferred promises, explicit generation changes and late success/failure schedules from FE-03/04/07/08. |
| Real media/browser behavior | Tests do not establish MPEG-TS codec support, native Safari HLS, autoplay, mobile fullscreen, TV remote behavior, receiver URL reachability/CORS or long-running decode stability. | Exercise representative supported devices and actual sample media in a controlled integration environment. |
| Long-session rendering | `TVEPGGrid` computes its 48-hour horizon at mount and renders large schedules without virtualization. Build size alone does not prove unacceptable latency. | Measure a realistic large guide and a multi-day session before choosing pagination, moving windows or virtualization. |
| Reduced motion and media controls | Chat no-CORS animated-image fallback cannot freeze its canvas and can keep animation running under the replay overlay. | Verify keyboard/pause/reduced-motion behavior in real browsers with cross-origin images. |
| Upstream auth errors | Plex transport/JSON/schema errors are not uniformly translated into a stable user-facing auth error contract. | Test HTML 200, timeout, DNS/connect failures and malformed user/resource objects without real credentials. |
| CI trust and freshness | Third-party actions, base images and installer scripts use mutable references; no current advisory or image scan was executed for this review. CI runs only for master pushes in the tracked workflow. Repository branch protections are unknown. | Preserve release scans, verify provenance/immutability requirements, and determine whether pre-merge checks are needed. Do not interpret this review as a dependency-vulnerability audit. |
| Deployment readiness | `/api/health` reports process status/version, not upstream readiness. Failed post-deploy verification has no automatic rollback in the tracked workflow. | Define whether upstream outage should block a release and what recovery/rollback contract the operator expects. Avoid making optional media services a mandatory liveness dependency accidentally. |
| Legacy media helpers | Exported `hls_rewriter.py` helpers still follow redirects after initial validation and lack newer route limits; current routes do not call them. Cast's internal filename helper lacks containment, but the HTTP route accepts a single segment. | Consolidate helpers or enforce invariants at the lowest shared layer; do not call these confirmed reachable SSRF/file-read exploits today. |
| Feed parser edge cases | DefusedXML blocks entity expansion, but not all security exceptions enter stale-cache fallback. Some XMLTV date/episode forms and Dispatcharr UUID URL forms are handled narrowly. | Use actual supported provider fixtures for malformed XML, timezone offsets, query/trailing-slash URLs and episode formats. No successful XXE is claimed. |
| Media clocks and network topology | Highlight duration relies on file mtime and assumes GOP/keyframe behavior; direct HLS Cast URLs and serialized source/logo URLs can expose internal endpoints and require receiver reachability. | Validate packet timestamp/clock-jump and codec fixtures, then document LAN versus remote Cast support. |
| Cast ownership policy | Sessions do not retain authenticated owner identity; a caller with a known UUID can stop it. Playback UUIDs are intentionally bearer capabilities. | Decide whether stop permission should require creator identity; test that contract without labelling possession of an intended capability an unexplained authorization bypass. |
| Documentation | Backend README is empty, frontend README is template material, and source environment examples retain weak local account values and obsolete Dispatcharr credential comments. | Provide tested setup and feature/permission/storage guidance as part of DEV-01 and authentication fixes. |

## Existing protections checked

The review verified the presence of SPA static-path containment, published-JWT-placeholder rejection, missing Plex machine-ID startup rejection, server-side role guards on admin routes, constrained ErsatzTV proxy-origin checks and bounded media response reads. These protections are meaningful even though nearby boundaries still have findings.

The client already protects several asynchronous paths: WebSocket callbacks reject superseded socket instances; live EPG fetching uses request identity and guide matching; GIF search rejects stale requests; highlight preview cleanup guards late results and revokes object URLs. React text rendering and the current media URL detection do not establish a straightforward chat HTML/script injection path. A localStorage role flag is not itself server authorization. These were considered and are not reported as defects.

## Evidence examples retained with the report

### Service-worker account and live-stream reproduction

A fresh headless Chrome profile loaded `/sw.js` from the production build on a temporary localhost server. The test page registered the worker and waited for control, primed the two API URLs with synthetic data, then made the server drop API connections. The account distinction was the Authorization header, matching the application contract.

```text
registration: ready
controlled: True
prime admin: {"users":[{"username":"synthetic-admin-only-record"}]}
stored entries: ['/api/admin/active-users', '/api/ersatztv/stream/test']
viewer offline admin:
  status: 200
  body: {"users":[{"username":"synthetic-admin-only-record"}]}
offline HLS:
  status: 200
  body: #EXTM3U\n#EXT-X-MEDIA-SEQUENCE:42\n#EXTINF:4,\nsegment42.ts\n
```

This confirms worker routing/cache behavior with the actual generated worker, not access to production admin data. The backend source trace establishes that the real admin routes do not partition these cached responses with `Vary: Authorization`. An online server 403 is not itself converted into a cached 200 by NetworkFirst; the reproduced trigger is transport failure, with the separately configured ten-second timeout providing another fallback path.

### Authentication, presence and WebSocket observations

The probes created synthetic settings/tokens and used ASGI or WebSocket transport doubles.

```text
blank_jwt_admin_status                  200
blank_password_login_status            200
stale_admin_settings_status            403
stale_admin_channel_status             200
poisoned_presence_admin_status         500
after_disconnect_admin_status          200
full_dummy_bearer_logged               True
malformed_upstream_exception           AttributeError
broadcast_send_attempts                1
dropped_socket_close_attempts          0
dropped_socket_pong                    {'type': 'pong'}
token_expired_before_chat              True
post_expiry_chat_added                 sent after token expiry
```

### Safe filesystem reproduction constraints

Use a temporary directory whose only contents belong to the test. Override the highlight storage root into that directory, mock `subprocess.Popen`, `os.killpg` and `shutil.rmtree`, and force the fake process to survive the initial startup check. Send the encoded `..` channel ID through the real route and inspect the chosen path and the mocked deletion argument after stop. Assert it escapes the configured highlight root. Never use an actual recursive deletion against application storage to demonstrate this finding.

The independent second review confirmed an important precondition: if FFmpeg exits during its first 0.5-second startup check, that recorder is not retained, so later service cleanup cannot delete through it. A retained recorder can still be deleted on shutdown even if its process later exits. Idle cleanup selects running idle recorders. These conditions affect exploit reliability and are part of the finding, not a containment defense.

## Handoff contract

- Baseline commit and source line ranges are recorded above. Re-check current code before modifying it if HEAD has moved.
- All indexed IDs are **open**. No application fixes, source-test additions, commits, deployment or external messages were made as part of this review.
- Keep each ID in the implementing commit/PR and record the failing regression, fix, verification result and any changed assumptions. An HTML “reviewed” checkbox records that the human read it; it does not mark a defect fixed.
- Use feature-flag and authorization matrices: anonymous/viewer/current admin/former admin; optional source down/empty/working; highlight/cast disabled/enabled; strong/blank configuration; normal/slow/cancelled/reordered completion; fresh/existing service worker.
- For High fixes, check bypasses across all entry points rather than patching only the demonstrated payload. For filesystem work, validate both the identifier at ingress and the final resolved path at creation/deletion. For credentials, test every log path and remove legacy caches as well as changing new writes.
- Re-run the existing suites after the focused tests. Separate environment/tool limitations from product defects, and preserve explicit limits where a real browser/device or deployed registry remains untested.

The companion HTML contains this report's full finding evidence and follow-up material, inline styles/scripts, printable views and an embedded downloadable Markdown copy. It needs no network assets or external libraries to read or filter the review.
