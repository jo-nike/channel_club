/** DEV-01 real Chrome + Vite proxy, no frontend dotenv, synthetic auth only. */
import assert from 'node:assert/strict'
import { createServer as httpServer } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { networkInterfaces, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'
const scratch = await mkdtemp(join(tmpdir(), 'iptv-dev-proxy-'))
const received = []
const upstream = httpServer(async (request, response) => {
  let body = ''
  for await (const chunk of request) body += chunk
  received.push({ url: request.url, body })
  response.setHeader('Content-Type', 'application/json')
  if (request.url === '/api/auth/config') response.end(JSON.stringify({ localAuthEnabled: true, plexAuthEnabled: false }))
  else if (request.url === '/api/auth/token') {
    assert.deepEqual(JSON.parse(body), { username: 'synthetic-user', password: 'synthetic-password' })
    response.end(JSON.stringify({ accessToken: 'synthetic-token', role: 'viewer', tokenType: 'bearer' }))
  } else if (request.url === '/api/ersatztv/channels') response.end('{"channels":[]}')
  else response.writeHead(404).end()
})
let vite, chrome, socket
try {
  await new Promise((resolve, reject) => { upstream.once('error', reject); upstream.listen(8001, '127.0.0.1', resolve) })
  // Preserve the actual repository Vite proxy configuration, disable all dotenv loading.
  vite = await createServer({ root: resolve('.'), envDir: scratch, server: { port: 0 } })
  vite.middlewares.use((request, response, next) => {
    if (request.url === '/__dev-probe') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Development proxy test</title>') }
    else next()
  })
  await vite.listen()
  const vitePort = vite.httpServer.address().port
  chrome = spawn(process.env.CHROME_BIN || 'google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-proxy-server', '--remote-debugging-port=0', `--user-data-dir=${join(scratch, 'chrome')}`, 'about:blank'], { stdio: 'ignore' })
  let debugPort
  for (let count = 0; count < 100; count++) {
    try { debugPort = (await readFile(join(scratch, 'chrome', 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break } catch { await delay(100) }
  }
  assert.ok(debugPort, 'Chrome started')
  const target = await (await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: 'PUT' })).json()
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }))
  let id = 0
  const pending = new Map()
  socket.addEventListener('message', ({ data }) => { const message = JSON.parse(data); if (message.id) { pending.get(message.id)?.(message); pending.delete(message.id) } })
  const call = (method, params) => new Promise((resolve) => { const next = ++id; pending.set(next, resolve); socket.send(JSON.stringify({ id: next, method, params })) })
  const evaluate = async (expression) => {
    const answer = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    assert.equal(answer.result.exceptionDetails, undefined, JSON.stringify(answer.result.exceptionDetails))
    return answer.result.result.value
  }
  const lan = Object.values(networkInterfaces()).flat().find((address) => address && address.family === 'IPv4' && !address.internal)?.address
  assert.ok(lan, 'machine has a LAN IPv4 address for the second browser-origin probe')
  for (const hostname of ['127.0.0.1', lan]) {
    const origin = `http://${hostname}:${vitePort}`
    await call('Page.navigate', { url: `${origin}/__dev-probe` })
    for (let count = 0; count < 100; count++) { if (await evaluate(`location.origin === ${JSON.stringify(origin)} && document.readyState === 'complete'`)) break; await delay(50) }
    const result = await evaluate(`(async () => {
      const api = await import('/src/services/api.ts');
      const guide = await import('/src/services/ersatztvApi.ts');
      const config = await api.getAuthConfig();
      const login = await api.login({username:'synthetic-user',password:'synthetic-password'});
      const channels = await guide.fetchErsatzTVChannels();
      return {config,login,channels};
    })()`)
    assert.equal(result.config.localAuthEnabled, true)
    assert.equal(result.login.accessToken, 'synthetic-token')
    assert.deepEqual(result.channels, [])
    console.log(`PASS browser origin ${origin}: auth config, login and guide API through real Vite proxy`)
  }
  assert.equal(received.filter((request) => request.url === '/api/auth/token').length, 2)
} finally {
  socket?.close()
  if (chrome) { const ended = new Promise((resolve) => chrome.once('exit', resolve)); chrome.kill(); await ended }
  await vite?.close()
  upstream.closeAllConnections()
  await new Promise((resolve) => upstream.close(resolve))
  await rm(scratch, { recursive: true, force: true })
}
