/** Real Chrome/Hls.js playback through actual FastAPI proxy, synthetic local FFmpeg fixtures.
 * Run from frontend: node scripts/check-hls-proxy.mjs
 * Requires uv, FFmpeg, Chrome. Fetches an integrity-pinned player bundle only;
 * media/auth/upstream traffic is localhost-only. HLS_BUNDLE can supply offline bundle.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const workspace = await mkdtemp(join(tmpdir(), 'iptv-hls-browser-'))
const bundle = join(workspace, 'hls.min.js')
const digest = '5ff2d714de30be428fc77b13e01db9a4b4cf015e9b4d6b3e8864b65d3d7d3ed7'
const bytes = process.env.HLS_BUNDLE
  ? await readFile(process.env.HLS_BUNDLE)
  : Buffer.from(await (await fetch('https://cdn.jsdelivr.net/npm/hls.js@1.5.18/dist/hls.min.js')).arrayBuffer())
assert.equal(createHash('sha256').update(bytes).digest('hex'), digest, 'Pinned Hls.js bundle integrity')
await writeFile(bundle, bytes)
let api, chrome, socket
try {
  api = spawn('uv', ['run', 'python', 'scripts/hls_browser_fixture.py', workspace, bundle], {
    cwd: resolve('../backend'), stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' },
  })
  let origin, apiError = ''
  api.stderr.on('data', chunk => { apiError += chunk })
  api.stdout.on('data', chunk => {
    for (const line of String(chunk).split('\n')) {
      if (line.startsWith('{')) origin = JSON.parse(line).origin
    }
  })
  for (let n=0;n<200 && !origin;n++) {
    assert.equal(api.exitCode, null, apiError)
    await delay(100)
  }
  assert.ok(origin, 'Fixture API started: '+apiError)
  const config = await (await fetch(origin+'/fixture.json')).json()
  const unsigned = await fetch(origin+'/api/ersatztv/session', {
    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({channelId:'synthetic'}),
  })
  assert.equal(unsigned.status, 401, 'Opening a stream session requires the Authorization header')
  const profile = join(workspace,'chrome')
  chrome = spawn(process.env.CHROME_BIN || 'google-chrome', [
    '--headless=new','--no-sandbox','--disable-gpu','--autoplay-policy=no-user-gesture-required',
    '--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank',
  ], {stdio:'ignore'})
  let port
  for(let n=0;n<100;n++) {
    try { port=(await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break }
    catch { await delay(100) }
  }
  assert.ok(port,'Chrome debugger started')
  const target=await(await fetch(`http://127.0.0.1:${port}/json/new?${origin}/probe.html`,{method:'PUT'})).json()
  socket=new WebSocket(target.webSocketDebuggerUrl)
  await new Promise(resolve=>socket.addEventListener('open',resolve,{once:true}))
  let id=0
  const pending=new Map(),requests=[]
  socket.addEventListener('message',({data})=>{
    const message=JSON.parse(data)
    if(message.id){pending.get(message.id)?.(message);pending.delete(message.id)}
    if(message.method==='Network.requestWillBeSent')requests.push(message.params.request.url)
  })
  const call=(method,params)=>new Promise(resolve=>{
    const n=++id;pending.set(n,resolve);socket.send(JSON.stringify({id:n,method,params}))
  })
  const evaluate=async expression=>{
    const answer=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true})
    assert.equal(answer.result.exceptionDetails,undefined,JSON.stringify(answer.result.exceptionDetails))
    return answer.result.result.value
  }
  await call('Network.enable',{})
  for(let n=0;n<100;n++){
    if(await evaluate("typeof window.playFixture === 'function'"))break
    await delay(50)
  }
  for(const channel of ['synthetic','encrypted']){
    await evaluate(`window.playFixture(${JSON.stringify(channel)},${JSON.stringify(config.token)})`)
    let state
    for(let n=0;n<200;n++){
      state=await evaluate("({ready:window.fixtureReady,tracks:window.player.subtitleTracks.length,selected:window.player.subtitleTrack,time:document.getElementById('video').currentTime,frames:document.getElementById('video').getVideoPlaybackQuality().totalVideoFrames,errors:window.errors})")
      assert.deepEqual(state.errors,[],JSON.stringify(state))
      if(state.ready && state.time>2 && state.frames>20)break
      await delay(100)
    }
    assert.ok(state.ready && state.time>2 && state.frames>20,`${channel} decoded playing frames: ${JSON.stringify(state)}`)
    console.log(`PASS: actual Chrome Hls.js ${channel} playback; decoded ${state.frames} frames, subtitle tracks ${state.tracks}, selected ${state.selected}`)
  }
  const media=requests.filter(url=>new URL(url).pathname.startsWith('/api/ersatztv/'))
  assert.ok(media.length>=8,'Player fetched nested playlists and media')
  assert.ok(requests.every(url=>!url.startsWith(config.upstream+'/')),'Browser never bypasses proxy')
  assert.ok(media.every(url=>!url.includes(config.token) && !new URL(url).searchParams.has('token')),'No credential in any player request')
  const played=media.filter(url=>new URL(url).pathname!=='/api/ersatztv/session')
  assert.ok(played.every(url=>/^\/api\/ersatztv\/s\/[A-Za-z0-9_-]{32}\//.test(new URL(url).pathname)),'Every playlist and segment goes through a stream session')
  const upstream=(await(await fetch(origin+'/fixture.json')).json()).requests
  for(const resource of ['video.m3u8?fixture=nested','audio.m3u8?fixture=audio','subtitles.m3u8?fixture=subtitles','init.mp4','caption.vtt','secret.key']){
    assert.ok(upstream.some(url=>url.endsWith('/'+resource)),`Fetched proxied ${resource}: ${JSON.stringify(upstream)}`)
  }
  assert.ok(upstream.some(url=>url.includes('video_')&&url.endsWith('.m4s')))
  assert.ok(upstream.some(url=>url.includes('audio_')&&url.endsWith('.ts')))
  assert.ok(upstream.some(url=>url.includes('encrypted_')&&url.endsWith('.ts')))
  assert.ok(upstream.every(url=>!url.includes('token=')),'Application token never forwarded upstream')
  console.log('PASS: nested query playlists, MAP, KEY, audio, subtitles and segments all proxied through stream sessions; no direct upstream browser requests')
} finally {
  socket?.close()
  for(const child of [chrome,api])if(child && child.exitCode===null){child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve))}
  await rm(workspace,{recursive:true,force:true})
}
