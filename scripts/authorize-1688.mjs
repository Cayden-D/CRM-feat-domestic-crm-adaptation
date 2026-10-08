import fs from 'node:fs/promises'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createInterface } from 'node:readline/promises'
import dotenv from 'dotenv'

const pendingFile = '.1688-oauth.local'
const tokenFile = '.1688-token.local'
const env = dotenv.parse(await fs.readFile('.env.local'))

function configuration() {
  const appKey = env.ALI1688_APP_KEY?.trim()
  const appSecret = env.ALI1688_APP_SECRET?.trim()
  const redirectUri = env.ALI1688_REDIRECT_URI?.trim()
  if (!appKey || !appSecret || !redirectUri) throw new Error('Missing 1688 configuration')
  const redirect = new URL(redirectUri)
  if (redirect.protocol !== 'https:') throw new Error('Callback must use HTTPS')
  return { appKey, appSecret, redirectUri }
}

async function savePrivate(path, data) {
  const temp = `${path}.${randomBytes(8).toString('hex')}.local`
  await fs.writeFile(temp, JSON.stringify(data, null, 2), { mode: 0o600, flag: 'wx' })
  await fs.rename(temp, path)
}

async function readInput() {
  if (process.stdin.isTTY) {
    const terminal = createInterface({ input: process.stdin, output: process.stdout })
    try { return (await terminal.question('Paste the full callback URL and press Enter: ')).trim() }
    finally { terminal.close() }
  }
  let input = ''
  for await (const chunk of process.stdin) {
    input += chunk
    if (input.length > 8192) throw new Error('Callback input is too large')
  }
  return input.trim()
}

async function main() {
  const config = configuration()
  const command = process.argv[2]
  if (command === 'begin') {
    const state = randomBytes(32).toString('hex')
    await savePrivate(pendingFile, {
      state, appKey: config.appKey, redirectUri: config.redirectUri,
      expiresAt: Date.now() + 10 * 60_000, consumed: false,
    })
    const url = new URL('https://auth.1688.com/oauth/authorize')
    url.search = new URLSearchParams({ client_id: config.appKey, site: '1688', redirect_uri: config.redirectUri, state }).toString()
    console.log(JSON.stringify({ authorizationUrl: url.href, callback: config.redirectUri }))
    return
  }
  if (command === 'exchange') {
    const callback = new URL(await readInput())
    const pending = JSON.parse(await fs.readFile(pendingFile, 'utf8'))
    const expected = new URL(config.redirectUri)
    if (pending.appKey !== config.appKey || pending.redirectUri !== config.redirectUri) throw new Error('Configuration changed; start authorization again')
    if (callback.origin !== expected.origin || callback.pathname !== expected.pathname) throw new Error('Callback address mismatch')
    if (pending.consumed || Date.now() > pending.expiresAt) throw new Error('Authorization state expired or already consumed')
    const returned = callback.searchParams.getAll('state')
    const actual = Buffer.from(returned[0] || '')
    const saved = Buffer.from(pending.state)
    if (returned.length !== 1 || actual.length !== saved.length || !timingSafeEqual(actual, saved)) throw new Error('Authorization state mismatch')
    const codes = callback.searchParams.getAll('code')
    if (codes.length !== 1 || !codes[0] || callback.searchParams.has('error')) throw new Error('Callback does not contain a successful authorization code')
    await savePrivate(pendingFile, { ...pending, consumed: true })
    const body = new URLSearchParams({
      grant_type: 'authorization_code', need_refresh_token: 'true',
      client_id: config.appKey, client_secret: config.appSecret,
      redirect_uri: config.redirectUri, code: codes[0],
    })
    const response = await fetch(`https://gw.open.1688.com/openapi/http/1/system.oauth2/getToken/${encodeURIComponent(config.appKey)}`, {
      method: 'POST', body, redirect: 'error', signal: AbortSignal.timeout(20_000),
    })
    let result
    try { result = await response.json() } catch { throw new Error(`Token response is not JSON (HTTP ${response.status})`) }
    if (!response.ok || typeof result.access_token !== 'string' || !result.access_token) {
      const code = String(result.error_code || result.errorCode || 'UNKNOWN').replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 100)
      throw new Error(`Token exchange failed (HTTP ${response.status}, code ${code}); start authorization again`)
    }
    const lifetime = Number(result.expires_in)
    if (!Number.isFinite(lifetime) || lifetime <= 0) throw new Error('Token response has an invalid lifetime')
    const data = {
      appKey: config.appKey, obtainedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + lifetime * 1000).toISOString(),
      ...Object.fromEntries(['access_token', 'refresh_token', 'refresh_token_timeout', 'expires_in', 'aliId', 'resource_owner', 'memberId'].filter(key => key in result).map(key => [key, result[key]])),
    }
    await savePrivate(tokenFile, data)
    console.log(JSON.stringify({ saved: tokenFile, accessTokenPresent: true, refreshTokenPresent: Boolean(data.refresh_token), expiresAt: data.expiresAt }))
    return
  }
  if (command === 'status') {
    const data = JSON.parse(await fs.readFile(tokenFile, 'utf8'))
    const stat = await fs.stat(tokenFile)
    console.log(JSON.stringify({ accessTokenPresent: Boolean(data.access_token), refreshTokenPresent: Boolean(data.refresh_token), expiresAt: data.expiresAt, expired: Date.now() >= Date.parse(data.expiresAt), privatePermissions: (stat.mode & 0o777) === 0o600 }))
    return
  }
  throw new Error('Usage: node scripts/authorize-1688.mjs begin|exchange|status; exchange reads the full callback URL from stdin')
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Authorization failed')
  process.exitCode = 1
})
