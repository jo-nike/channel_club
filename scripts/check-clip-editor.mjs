/** Synthetic Chrome check for both player integrations; no configured providers are contacted. */
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { spawn, execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from '../frontend/node_modules/vite/dist/node/index.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const frontend = join(root, 'frontend')
const workspace = await mkdtemp(join(tmpdir(), 'iptv-clip-check-'))
const harness = await mkdtemp(join(frontend, '.clip-check-'))
let server, chrome, socket
const requests = { captures: 0, exports: 0, uploads: 0, deletes: 0 }
const CAPTURE = 'synthetic-capture-0001'
try {
  const source = join(workspace, 'preview.mp4')
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=25:duration=12', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=12', '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '100', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', source])
  const preview = await readFile(source)
  const modulePath = join(harness, 'main.tsx')
  await writeFile(modulePath, `
import React, { useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { MediaPlayer, MediaProvider } from '@vidstack/react'
import { VideoControls } from '../src/components/VideoControls'
import { ErsatzTVVideoControls } from '../src/components/ersatztv/ErsatzTVVideoControls'
import { TooltipProvider } from '../src/components/ui/tooltip'
import '../src/index.css'
localStorage.setItem('token', 'synthetic-token')
function App() {
  const containerRef = useRef(null), videoRef = useRef(null)
  const common = { containerRef, isTheaterMode: false, isVisible: true, channelId: 'synthetic', onTheaterModeToggle: () => {} }
  return <TooltipProvider><div ref={containerRef} className="relative mx-auto mt-8 aspect-video max-w-5xl bg-black">
    {location.search.includes('hls') ? <MediaPlayer src="/fixture.mp4"><MediaProvider /><ErsatzTVVideoControls {...common} /></MediaPlayer>
      : <><video ref={videoRef} src="/fixture.mp4" className="w-full" /><VideoControls {...common} videoRef={videoRef} isPlaying={false} volume={1} isMuted={false} isFullscreen={false} onPlayPause={() => {}} onVolumeChange={() => {}} onMuteToggle={() => {}} onFullscreenToggle={() => {}} /></>}
  </div></TooltipProvider>
}
createRoot(document.getElementById('root')).render(<App />)
`)
  let prepared
  server = await createServer({ root: frontend, server: { host: '127.0.0.1', port: 0 }, plugins: [{
    name: 'clip-check-fixtures', configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url, 'http://localhost')
        const send = (status, body, type = 'application/json') => { res.writeHead(status, { 'Content-Type': type }); res.end(body) }
        if (url.pathname === '/__clip-check') {
          const html = await vite.transformIndexHtml(req.url, `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${harness.split('/').at(-1)}/main.tsx"></script></body></html>`)
          return send(200, html, 'text/html')
        }
        if (url.pathname === '/fixture.mp4') return send(200, preview, 'video/mp4')
        if (!url.pathname.startsWith('/api/')) return next()
        if (url.pathname === '/api/highlight/feature') return send(200, JSON.stringify({ enabled: true, ziplineEnabled: true }))
        if (url.pathname.startsWith('/api/highlight/status/')) return send(200, JSON.stringify({ enabled: true, recording: true, bufferSeconds: 12, maxBufferSeconds: 60 }))
        if (url.pathname === '/api/highlight/synthetic/capture') {
          requests.captures++
          return send(200, JSON.stringify({ id: CAPTURE, duration: 12, bytes: preview.length, expiresAt: 0 }))
        }
        if (url.pathname === `/api/highlight/capture/${CAPTURE}`) {
          if (req.method === 'DELETE') { requests.deletes++; res.writeHead(204); return res.end() }
          if (url.searchParams.get('token') !== 'synthetic-token' && !req.headers.authorization) throw new Error('Capture request carried no token')
          // The editor must work from byte ranges the way the real backend serves them.
          const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '')
          if (!range) { res.writeHead(200, { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Length': preview.length }); return res.end(preview) }
          const start = range[1] ? Number(range[1]) : preview.length - Number(range[2])
          const end = range[1] && range[2] ? Math.min(Number(range[2]), preview.length - 1) : preview.length - 1
          res.writeHead(206, { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${preview.length}`, 'Content-Length': end - start + 1 })
          return res.end(preview.subarray(start, end + 1))
        }
        if (url.pathname === '/api/highlight/export') {
          if (url.searchParams.get('capture') !== CAPTURE) throw new Error('Export did not reference the capture')
          const target = join(workspace, 'trim.mp4')
          execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', source, '-ss', url.searchParams.get('start_time'), '-t', String(Number(url.searchParams.get('end_time')) - Number(url.searchParams.get('start_time'))), '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', target])
          prepared = await readFile(target); requests.exports++
          return send(200, prepared, 'video/mp4')
        }
        if (url.pathname === '/api/highlight/upload') {
          const chunks = []; for await (const chunk of req) chunks.push(chunk)
          if (!Buffer.concat(chunks).equals(prepared)) throw new Error('Upload bytes differ from download')
          requests.uploads++
          return send(200, JSON.stringify({ url: 'https://clips.example/synthetic.mp4', name: 'synthetic.mp4' }))
        }
        return send(200, JSON.stringify({ enabled: false }))
      })
    },
  }] })
  await server.listen()
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`
  const profile = join(workspace, 'chrome')
  chrome = spawn(process.env.CHROME_BIN || '/usr/bin/google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-background-networking', '--no-first-run', '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required', `--user-data-dir=${profile}`, '--remote-debugging-port=0', 'about:blank'], { stdio: 'ignore' })
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
  let port, path
  for (let i = 0; i < 100; i++) {
    try { [port, path] = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).trim().split('\n'); break } catch { await sleep(100) }
  }
  socket = new WebSocket(`ws://127.0.0.1:${port}${path}`)
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  let sequence = 0
  const pending = new Map()
  socket.onmessage = event => {
    const message = JSON.parse(event.data)
    if (pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id) }
  }
  async function command(method, params = {}, sessionId) {
    const id = ++sequence
    const response = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 15000)
      pending.set(id, message => { clearTimeout(timer); resolve(message) })
    })
    socket.send(JSON.stringify({ id, method, params, sessionId }))
    const result = await response
    if (result.error) throw new Error(JSON.stringify(result.error))
    return result.result
  }
  const target = await command('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await command('Target.attachToTarget', { targetId: target.targetId, flatten: true })
  const cdp = (method, params) => command(method, params, sessionId)
  async function evaluate(expression) {
    const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
    return result.result.value
  }
  async function until(expression) {
    for (let i = 0; i < 300; i++) { if (await evaluate(expression)) return; await sleep(100) }
    console.log('DOM at timeout:', await evaluate('document.body.innerText'))
    console.log('Media at timeout:', await evaluate(`Array.from(document.querySelectorAll('video')).map(v=>({src:v.src,duration:v.duration,ready:v.readyState,error:v.error?.message}))`))
    console.log('Controls at timeout:', await evaluate(`({sliders:document.querySelectorAll('[role="slider"]').length,images:document.querySelectorAll('[role="dialog"] img').length})`))
    throw new Error(`Timed out: ${expression}`)
  }
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false })
  await cdp('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: workspace })
  for (const mode of ['mpeg', 'hls']) {
    await cdp('Page.navigate', { url: `${origin}/__clip-check?${mode}` })
    await until(`!!document.querySelector('button[aria-label="Capture clip · 12s available"]')`)
    await evaluate(`document.querySelector('button[aria-label="Capture clip · 12s available"]').click()`)
    await until(`document.querySelectorAll('[role="slider"]').length === 2 && document.querySelectorAll('[role="dialog"] img').length === 10`)
    if (!await evaluate(`document.querySelector('video:not([aria-label])').muted`)) throw new Error(`${mode}: live audio not muted`)
    await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Last 10s').click()`)
    await until(`document.querySelector('[aria-label="Highlight preview"]').currentTime >= 2`)
    await evaluate(`document.querySelector('[aria-label="Start boundary"]').focus()`)
    await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 })
    await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 })
    await until(`document.querySelector('[aria-label="Highlight preview"]').currentTime >= 2.09`)
    // Real pointer drag of the end boundary.
    const rect = await evaluate(`(()=>{const r=document.querySelector('[aria-label="End boundary"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)
    await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', ...rect, button: 'left', clickCount: 1 })
    await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x - 200, y: rect.y, button: 'left', buttons: 1 })
    await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x - 200, y: rect.y, button: 'left', clickCount: 1 })
    await until(`Number(document.querySelector('[aria-label="End boundary"]').getAttribute('aria-valuenow')) < 11`)
    await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Download clip').click()`)
    await until(`!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Download clip').disabled`)
    await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Upload to Zipline').click()`)
    await until(`!!document.querySelector('[aria-label="Uploaded clip link"]')`)
    const screenshot = await cdp('Page.captureScreenshot', { format: 'png' })
    await writeFile(`/tmp/iptv-clip-${mode}.png`, Buffer.from(screenshot.data, 'base64'))
    await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
    await sleep(100)
    if (!await evaluate(`(()=>{const d=document.querySelector('[role="dialog"]');return d.scrollWidth<=d.clientWidth})()`)) throw new Error('Editor overflows at mobile width')
    await evaluate(`document.querySelector('[aria-label="Uploaded clip link"]').scrollIntoView({block:'nearest'})`)
    const mobile = await cdp('Page.captureScreenshot', { format: 'png' })
    await writeFile(`/tmp/iptv-clip-${mode}-mobile.png`, Buffer.from(mobile.data, 'base64'))
    await evaluate(`document.querySelector('[aria-label="Close editor"]').click()`)
    await until(`!document.querySelector('[role="dialog"]')`)
    await until(`!document.querySelector('video').muted`)
    for (let i = 0; i < 50 && requests.deletes < requests.captures; i++) await sleep(100)
    if (requests.deletes !== requests.captures) throw new Error(`${mode}: closing the editor did not free the capture`)
    await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false })
    console.log(`${mode}: thumbnails, keyboard, pointer drag, prepared export/upload bytes, responsive editor, audio restore passed`)
  }
  if (requests.captures !== 2 || requests.exports !== 2 || requests.uploads !== 2) throw new Error(`Unexpected request counts: ${JSON.stringify(requests)}`)
  console.log('PASS', requests)
} finally {
  socket?.close()
  if (chrome) { chrome.kill(); await new Promise(resolve => { if (chrome.exitCode !== null) resolve(); else chrome.once('exit', resolve) }) }
  await server?.close()
  await rm(harness, { recursive: true, force: true })
  await rm(workspace, { recursive: true, force: true })
}
