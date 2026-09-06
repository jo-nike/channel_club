/** Real generated-worker regression, synthetic localhost API and isolated Chrome profile.
 * Run npm run build && node scripts/check-service-worker.mjs [--media].
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, extname } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
const root = resolve('dist')
let mode = 'online'
const server = createServer(async (req, res) => {
  if (req.url.startsWith('/api/')) {
    if(process.env.DEBUG_SW) console.log('request', mode, req.url)
    if (mode === 'offline') return req.socket.destroy()
    if (mode === 'slow') {
      req.socket.setTimeout(0)
      await delay(11000)
    }
    if (res.destroyed) return
    res.setHeader('Content-Type', 'application/json')
    if(process.env.DEBUG_SW) console.log('respond', mode, req.url)
    res.end(JSON.stringify({ account: req.headers.authorization || 'anonymous', fresh: true }))
    return
  }
  if (req.url === '/probe.html') {
    res.setHeader('Content-Type', 'text/html')
    res.end('<!doctype html><title>Generated SW regression</title>')
    return
  }
  try {
    const path = resolve(root, '.' + new URL(req.url, 'http://local').pathname)
    assert.ok(path.startsWith(root + '/'))
    res.setHeader('Content-Type', extname(path) === '.js' ? 'text/javascript' : 'text/html')
    res.end(await readFile(path))
  } catch { res.writeHead(404).end() }
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const origin = `http://127.0.0.1:${server.address().port}`
const profile = await mkdtemp(join(tmpdir(), 'iptv-sw-test-'))
const chrome = spawn(process.env.CHROME_BIN || 'google-chrome', [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0',
  `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' })
let socket
try {
  let port
  for (let i = 0; i < 100; i++) {
    try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break } catch { await delay(100) }
  }
  assert.ok(port, 'Chrome remote debugging started')
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?${origin}/probe.html`, { method: 'PUT' })).json()
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((r) => socket.addEventListener('open', r, { once: true }))
  let id = 0
  const pending = new Map()
  socket.addEventListener('message', ({ data }) => {
    const m = JSON.parse(data)
    if(process.env.DEBUG_SW && ["Network.loadingFailed", "Log.entryAdded"].includes(m.method)) console.log(m.params)
    if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id) }
  })
  const call = (method, params) => new Promise((r) => {
    const n = ++id; pending.set(n, r); socket.send(JSON.stringify({ id: n, method, params }))
  })
  await call("Network.enable", {})
  await call("Log.enable", {})
  const evaluate = async (expression) => {
    const answer = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    assert.equal(answer.result.exceptionDetails, undefined, JSON.stringify(answer.result.exceptionDetails))
    return answer.result.result.value
  }
  for (let n = 0; n < 100; n++) {
    if (await evaluate("location.href.endsWith('/probe.html') && document.readyState === 'complete'")) break
    await delay(50)
  }
  await evaluate(`(async () => {
    const old = await caches.open('api-cache');
    await old.put('/api/admin/active-users', new Response('legacy-admin-secret'));
    await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise(r => navigator.serviceWorker.addEventListener('controllerchange', r, {once:true}));
    return true;
  })()`)
  assert.equal(await evaluate("caches.has('api-cache')"), false, 'legacy cache deleted on activation')
  const request = (path, account) => evaluate(`fetch(${JSON.stringify(path)}, {headers:{Authorization:${JSON.stringify(account)}}}).then(async r => ({status:r.status, body:await r.text()})).catch(e => ({failed:true,error:String(e)}))`)
  const paths = process.argv.includes('--media')
    ? ['/api/ersatztv/stream/test', '/api/ersatztv/segments/test.ts', '/api/cast/hls/test/index.m3u8']
    : ['/api/admin/active-users', '/api/admin/status', '/api/auth/config', '/api/private.png']
  for (const path of paths) assert.match((await request(path, 'synthetic-admin')).body, /synthetic-admin/)
  mode = 'offline'
  for (const account of ['synthetic-viewer', '']) {
    for (const path of paths) assert.equal((await request(path, account)).failed, true, `${account} offline ${path}`)
  }
  mode = 'slow'
  for (const account of ['synthetic-viewer', '']) {
    await Promise.all(paths.map(async path => {
      const response = await request(path, account)
      // A transport timeout may fail; it must never substitute cached credentials.
      if (!response.failed) assert.equal(JSON.parse(response.body).account, account || 'anonymous', `${path}: stale fallback after ten seconds`)
    }))
  }
  const cached = await evaluate(`(async () => { const out=[]; for(const name of await caches.keys()) for(const req of await (await caches.open(name)).keys()) out.push(req.url); return out; })()`)
  assert.ok(cached.every(url => !new URL(url).pathname.startsWith('/api/')), JSON.stringify(cached))
  console.log(`PASS: real generated SW ${process.argv.includes('--media') ? 'media bypass' : 'account transitions'}, legacy deletion, offline and >10s delay; no API cache entries`)
} finally {
  socket?.close()
  chrome.kill('SIGTERM')
  await new Promise(r => chrome.once('exit', r))
  server.closeAllConnections(); server.close()
  await rm(profile, { recursive: true, force: true })
}
