#!/usr/bin/env python3
"""Render the tracker and matching self-contained summary from the evidence ledger."""

import base64
import html
import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
record = json.loads((HERE / 'remediation-record.json').read_text())
findings = record['findings']
assert len(findings) == len({item['id'] for item in findings}) == 39
assert all(item['status'] == 'Fixed' for item in findings)


def table(headers, rows):
    def cell(value):
        return str(value).replace('|', '\\|').replace('\n', ' ')
    return '\n'.join(['| ' + ' | '.join(headers) + ' |',
                      '| ' + ' | '.join(['---'] * len(headers)) + ' |',
                      *['| ' + ' | '.join(cell(c) for c in row) + ' |' for row in rows]])


validation = '''## Verification

- Backend: **736 passed**, with inherited blank JWT, invalid PORT, hostile upstream URL and synthetic parent credentials; external DNS/socket guard active. Ruff check, Ruff format (115 files) and basedpyright (0 errors/warnings/notes) passed.
- Frontend: **1008 passed across 80 files**; ESLint, TypeScript and production Vite/PWA build passed. Existing main-chunk (1171.91 kB minified) and stale Browserslist warnings remain; neither proves a performance defect. No frontend formatter is configured; whitespace check is included.
- Real isolated Chrome executes the **generated production worker**, including old-cache migration, synthetic account headers, offline and 11-second upstream-delay paths, and all live media route families. Transport failures are acceptable; cached privileged/stale data never substitutes for the network.
- Real Chrome+hls.js decoded **56 fMP4 frames and 55 encrypted-TS frames** from generated fixtures through the real authenticated FastAPI proxy; initialization maps, keys, nested query playlists, audio and subtitle requests stayed proxied.
- Real Chrome/Vite dev-proxy checks passed for synthetic auth config/login/guide calls on loopback and the machine LAN address. This used a browser on the same machine, not a second physical LAN device.
- Actual harmless subprocess tests verify output-flood progress, stop and cancellation/reaping. Actual FFmpeg tests verify bounded ring manifests and unchanged preview source through trim/conversion.
- Actual local Docker built two different synthetic images for one source marker, switched first→second→first, verified image IDs and cleaned only fixture resources. Host deployment concurrency/order checks use independent processes with mocked Docker/health operations; the remote registry and deployed application were not exercised.

The baseline passed 603 backend and 960 frontend tests. New regression scenarios establish the reviewed contracts; aggregate counts alone do not. Synthetic credentials, temporary storage, process doubles and controlled upstreams were used. An existing multi-portal WebSocket test hang was corrected by sharing one ASGI lifespan/loop rather than weakening tests.

## Reproduce

Run from the indicated directory. Browser checks require installed Chrome; media checks require FFmpeg. The HLS harness downloads a version-and-SHA256-pinned test library unless HLS_BUNDLE supplies it. No live provider credentials are needed.

```bash
# backend
uv run ruff check .
uv run ruff format --check .
uv run basedpyright
JWT_SECRET= PORT=hostile ERSATZTV_BASE_URL=https://hostile.invalid uv run pytest -q

# frontend
npm run lint
npm test
npm run build
node scripts/check-service-worker.mjs
node scripts/check-service-worker.mjs --media
node scripts/check-hls-proxy.mjs
node scripts/check-dev-proxy.mjs

# repository root; optional actual Docker fixture check (preexisting Alpine image)
python3 -m scripts.check_release_images
```

## Operating limits and remaining limitations

- Run **one backend media worker** with the current process-local budgets. Defaults are 8 shared media processes/2 per authenticated user, 2 encoding jobs/1 per user and256MiB maximum export size. Horizontal scaling needs shared admission before increasing worker count.
- Manifests are capped at 2 MiB, logos 4 MiB and Ersatz feeds 32 MiB. Async body reads have a 15-second deadline; synchronous feed reads check that deadline between chunks with a 2-second inactivity timeout. Feed failures back off 5 seconds and preserve stale data.
- Logo origins default to the configured ErsatzTV origin. Additional trusted origins use ERSATZTV_LOGO_ORIGINS as a JSON array, e.g. `["https://images.example.com"]`. PNG/JPEG/GIF/WebP are supported; active HTML/SVG is refused.
- Snapshot creation briefly pauses its Linux FFmpeg recorder while copying completed files. MP4 exports retain fast stream-copy semantics; packet clocks and exact keyframe trim precision need representative real-media validation.
- Chat acknowledgement confirms acceptance into server memory and completion of broadcast, not durable delivery or a read receipt. A lost acknowledgement preserves the draft and asks users to check chat before manually retrying; no automatic duplicate resend occurs.
- Cast SDK lifecycle verification is mocked. No physical Chromecast, native Safari/mobile/TV remote, live provider, long-running soak, production rollout, or current registry vulnerability scan is claimed.
- Reverse-proxy credential-log redaction, public-ingress budgets and immediate token/grant revocation remain operator/product follow-ups. Existing stateless revocation and known-UUID Cast capability policies were preserved. See all 16 coverage decisions below and `scripts/README.md` for explicit locked rollback.
'''
coverage = '## Coverage gaps and design decisions\n\nAll 16 follow-up areas from the original report are assessed. These are not additional confirmed findings; none was silently counted as fixed. Remaining work below does not prevent verification of the 39 reviewed fixes.\n\n' + table(
    ['Area', 'Assessment / rationale', 'Concrete follow-up'],
    [[gap['area'], gap['assessment'], gap['followup']] for gap in record['coverage']])

tracker = [
    '# Adversarial review remediation tracker',
    f"Baseline: `{record['baseline']}`. Initial HEAD matched it exactly. Both supplied review files are preserved byte-for-byte; the HTML embedded Markdown equals the primary report. Primary report SHA256: `{record['review_sha256']}`.",
    '**39 fixed: 8 High, 26 Medium, 5 Low.** No inaccurate/already-fixed findings and no externally blocked confirmed findings. Each finding has exactly one implementation/regression commit on master; documentation commits are separate.',
    'Root coordinated the shared repository and final evidence. Security, media and frontend agents owned explicit modules, staged owned files and preserved each other’s work. Final consolidation folded targeted follow-ups and relocated the FE-12 shared-file hunk; exact Git tree equality with the pre-consolidation backup was verified.',
    table(['ID', 'Severity', 'Status', 'Dependencies', 'Responsible agent', 'Implementation notes', 'Verification evidence', 'Commit'],
          [[f['id'], f['severity'], f['status'], ', '.join(f['dependencies']) or '—', f['owner'], f['implementation'], f['verification'], f"`{f['commit'][:7]}`"] for f in findings]),
    '## Committed regression sources',
]
tracker += [f"- **{f['id']}**: " + ', '.join(f'`{p}`' for p in f['tests']) for f in findings]
tracker += [validation, coverage]
(HERE / 'remediation-tracker.md').write_text('\n\n'.join(tracker) + '\n')

summary = [
    '# IPTV Viewer — remediation summary',
    f"Completed {record['date']} against review baseline `{record['baseline']}`.",
    '**All 39 confirmed findings are fixed and verified: 8 High, 26 Medium, 5 Low.** Each has one atomic implementation/regression commit. No confirmed finding remains blocked. The original Markdown/HTML review remains the historical baseline.',
    'The tracker contains dependencies, agent ownership and per-finding regression source paths. This summary and its self-contained HTML are rendered from the same committed evidence record.',
    '## Findings resolved',
    table(['ID', 'Severity', 'Status', 'Implementation', 'Verification evidence', 'Commit'],
          [[f['id'], f['severity'], f['status'], f['implementation'], f['verification'], f"`{f['commit'][:7]}`"] for f in findings]),
    validation,
    coverage,
    '## Record integrity',
    f"The supplied review files are unchanged. Markdown SHA256: `{record['review_sha256']}`; its embedded HTML download matches exactly. All 39 IDs map to unique commits. Consolidated source tree equals the fully tested pre-consolidation tree; only final evidence documents were subsequently added/updated. A local `remediation-before-consolidation` branch preserves the original work history."
]
markdown = '\n\n'.join(summary) + '\n'
(HERE / 'remediation-summary.md').write_text(markdown)


def inline(text):
    text = html.escape(text)
    text = re.sub(r'`([^`]+)`', r'<code>\1</code>', text)
    return re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', text)


def render(text):
    lines = text.splitlines()
    out = []
    i = 0
    while i < len(lines):
        line = lines[i]
        if line.startswith('```'):
            block = []
            i += 1
            while i < len(lines) and not lines[i].startswith('```'):
                block.append(lines[i]); i += 1
            out.append('<pre><code>' + html.escape('\n'.join(block)) + '</code></pre>')
        elif line.startswith('| '):
            rows = []
            while i < len(lines) and lines[i].startswith('| '):
                rows.append([c.strip() for c in lines[i].strip('|').split('|')]); i += 1
            out.append('<div class="table-wrap"><table><thead><tr>' + ''.join('<th>'+inline(c)+'</th>' for c in rows[0]) + '</tr></thead><tbody>')
            for row in rows[2:]:
                marker = f' id="{row[0].lower()}" data-finding="{row[0]}"' if re.fullmatch(r'(?:FE|MEDIA|SEC|OPS|DEV|QA)-\d+', row[0]) else ''
                out.append('<tr' + marker + '>' + ''.join('<td>'+inline(c)+'</td>' for c in row) + '</tr>')
            out.append('</tbody></table></div>'); continue
        elif line.startswith('#'):
            heading, title = line.split(' ', 1)
            level = len(heading)
            out.append(f'<h{level}>' + inline(title) + f'</h{level}>')
        elif line.startswith('- '):
            out.append('<ul>')
            while i < len(lines) and lines[i].startswith('- '):
                out.append('<li>' + inline(lines[i][2:]) + '</li>'); i += 1
            out.append('</ul>'); continue
        elif line:
            out.append('<p>' + inline(line) + '</p>')
        i += 1
    return '\n'.join(out)

css = '''
:root{color-scheme:light;--ink:#193044;--muted:#526678;--line:#d5dfe7;--accent:#145a78}
*{box-sizing:border-box}body{margin:0;background:#f4f7f9;color:var(--ink);font:16px/1.65 system-ui,sans-serif}
main{max-width:1500px;margin:auto;padding:40px clamp(18px,4vw,65px) 80px}h1{font:44px/1.12 Georgia,serif;max-width:900px;letter-spacing:-1px}h2{margin-top:40px;font:29px/1.3 Georgia,serif}p,li{max-width:1100px}strong{color:#143e59}code{background:#e8eef2;padding:2px 4px;border-radius:3px;font:12px/1.5 ui-monospace,monospace;overflow-wrap:anywhere}pre{background:#142a3b;color:#e4edf4;padding:20px;border-radius:8px;overflow:auto}pre code{background:none;color:inherit}li{margin:9px 0}.table-wrap{overflow:auto;margin:20px 0;background:white;border:1px solid var(--line);border-radius:7px}table{border-collapse:collapse;width:100%;min-width:900px;font-size:13px;line-height:1.6}th,td{text-align:left;vertical-align:top;padding:12px;border-bottom:1px solid var(--line)}th{background:#e5edf2;color:#24465b;position:sticky;top:0}td:first-child{font-weight:700;white-space:nowrap;color:var(--accent)}td:last-child{white-space:nowrap}tr:target{background:#eef9f4}button{font:inherit;border:1px solid #a7bbc9;background:#fff;color:#145a78;border-radius:5px;padding:8px 13px;cursor:pointer}button:focus-visible{outline:3px solid #2e8aae}.tools{display:flex;gap:10px;flex-wrap:wrap;margin:22px 0}.label{font-size:12px;text-transform:uppercase;letter-spacing:2px;color:var(--accent)}footer{margin-top:45px;color:var(--muted);font-size:13px}@media(max-width:700px){h1{font-size:35px}main{padding:25px 16px}table{font-size:12px}}@media print{body{background:white}main{padding:0;max-width:none}.tools{display:none}table{min-width:0;font-size:8pt}th,td{padding:6px}.table-wrap{overflow:visible}h2{break-after:avoid}tr{break-inside:avoid}pre{white-space:pre-wrap}}
'''
encoded = base64.b64encode(markdown.encode()).decode()
page = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>IPTV Viewer — remediation summary</title><style>'+css+'</style></head><body><main><div class="label">39 verified fixes · 6 September 2026</div><div class="tools"><button id="download">Download matching Markdown</button><button onclick="window.print()">Print / save PDF</button></div>'+render(markdown)+'<footer>Self-contained report: no remote scripts, styles, fonts or data. Physical-device and deployment limitations are recorded above.</footer></main><script id="markdown-data" type="application/octet-stream">'+encoded+'</script><script>document.getElementById("download").addEventListener("click",()=>{const bytes=Uint8Array.from(atob(document.getElementById("markdown-data").textContent),c=>c.charCodeAt(0));const url=URL.createObjectURL(new Blob([bytes],{type:"text/markdown;charset=utf-8"}));const a=document.createElement("a");a.href=url;a.download="remediation-summary.md";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)});</script></body></html>'
(HERE / 'remediation-summary.html').write_text(page + '\n')
print('Rendered 39 fixed findings and 16 assessed coverage areas into tracker and matching summaries.')
