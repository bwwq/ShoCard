import { createServer } from 'node:http'
import { createHash, pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.dirname(fileURLToPath(import.meta.url))

loadEnvFile(path.join(rootDir, '.env'))

const PORT = Number(process.env.PORT || 4173)
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(rootDir, 'data')
const DIST_DIR = path.join(rootDir, 'dist')
const STATE_FILE = path.join(DATA_DIR, 'state.json')
const AUTH_FILE = path.join(DATA_DIR, 'auth.json')
const DEFAULT_SITE_TITLE = 'DC 酒馆卡展示'
const DEFAULT_CATEGORY = ''
const LEGACY_DEFAULT_CATEGORY = '默认'
const ALL_CATEGORY = '全部'
const DEFAULT_IMAGE_HEIGHT = 220
const DEFAULT_CROP = 0
const DEFAULT_CROP_SIZE = 100
const DEFAULT_IMAGE_ASPECT_RATIO = 1.45
const JSON_LIMIT_BYTES = 50 * 1024 * 1024
const COOKIE_NAME = 'dc_tavern_session'
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000
const PASSWORD_ITERATIONS = 310000

const sessions = new Map()

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return
  }

  const content = readFileSync(filePath, 'utf8')

  for (const line of content.split(/\r?\n/)) {
    const trimmedLine = line.trim()

    if (!trimmedLine || trimmedLine.startsWith('#')) {
      continue
    }

    const match = trimmedLine.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!match || process.env[match[1]] !== undefined) {
      continue
    }

    let value = match[2].trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    process.env[match[1]] = value
  }
}

function cleanCategory(value) {
  const parts =
    typeof value === 'string'
      ? value
          .split(/[/>\\]+/)
          .map((part) => part.trim())
          .filter(Boolean)
      : []
  const category = parts.length ? parts.join('/') : DEFAULT_CATEGORY

  if (category === LEGACY_DEFAULT_CATEGORY || category === ALL_CATEGORY) {
    return DEFAULT_CATEGORY
  }

  return category
}

function uniqueCategories(values) {
  return Array.from(
    new Set(values.map((value) => cleanCategory(value)).filter(Boolean)),
  )
}

function clampNumber(value, min, max, fallback) {
  const parsedValue = typeof value === 'number' ? value : Number(value)

  if (!Number.isFinite(parsedValue)) {
    return fallback
  }

  return Math.min(max, Math.max(min, parsedValue))
}

function sanitizeCropRect(value) {
  const width = clampNumber(value?.width, 5, 100, DEFAULT_CROP_SIZE)
  const height = clampNumber(value?.height, 5, 100, DEFAULT_CROP_SIZE)

  return {
    x: clampNumber(value?.x, 0, 100 - width, DEFAULT_CROP),
    y: clampNumber(value?.y, 0, 100 - height, DEFAULT_CROP),
    width,
    height,
  }
}

function normalizeUrl(value) {
  if (typeof value !== 'string') {
    return ''
  }

  const trimmedValue = value.trim()

  if (/^(?:canary\.|ptb\.)?discord\.com\/channels\//i.test(trimmedValue)) {
    return `https://${trimmedValue}`.replace(/\/+$/, '')
  }

  return trimmedValue.replace(/\/+$/, '')
}

function cleanImageUrl(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function limitString(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function sanitizeCard(value) {
  if (!value || typeof value !== 'object') {
    return null
  }

  const card = value
  const title = limitString(card.title, 200)
  const url = normalizeUrl(card.url).slice(0, 2000)
  const cropRect = sanitizeCropRect({
    height: card.cropHeight,
    width: card.cropWidth,
    x: card.cropX,
    y: card.cropY,
  })

  if (!title || !url) {
    return null
  }

  return {
    id: limitString(card.id, 120) || randomBytes(16).toString('hex'),
    title,
    url,
    category: cleanCategory(card.category),
    imageUrl: cleanImageUrl(card.imageUrl),
    imageHeight: clampNumber(card.imageHeight, 140, 420, DEFAULT_IMAGE_HEIGHT),
    cropX: cropRect.x,
    cropY: cropRect.y,
    cropWidth: cropRect.width,
    cropHeight: cropRect.height,
    imageAspectRatio: clampNumber(
      card.imageAspectRatio,
      0.2,
      8,
      DEFAULT_IMAGE_ASPECT_RATIO,
    ),
    recommended: Boolean(card.recommended),
    createdAt: limitString(card.createdAt, 80) || new Date().toISOString(),
  }
}

function sanitizeState(value) {
  const rawCards = Array.isArray(value?.cards) ? value.cards : []
  const cards = rawCards.map((card) => sanitizeCard(card)).filter(Boolean)
  const rawCategories = Array.isArray(value?.categories) ? value.categories : []
  const categories = uniqueCategories([
    ...rawCategories.filter((category) => typeof category === 'string'),
    ...cards.map((card) => card.category),
  ])
  const siteTitle = limitString(value?.siteTitle, 120) || DEFAULT_SITE_TITLE

  return {
    cards,
    categories,
    siteTitle,
  }
}

async function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'))
  } catch {
    return fallback
  }
}

async function writeJsonFile(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true })
  const tempFile = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tempFile, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(tempFile, filePath)
}

async function readState() {
  return sanitizeState(await readJsonFile(STATE_FILE, {}))
}

async function writeState(state) {
  const nextState = sanitizeState(state)
  await writeJsonFile(STATE_FILE, nextState)
  return nextState
}

async function readAuthFile() {
  const auth = await readJsonFile(AUTH_FILE, null)

  if (
    auth &&
    typeof auth.account === 'string' &&
    typeof auth.passwordHash === 'string' &&
    typeof auth.salt === 'string' &&
    typeof auth.iterations === 'number'
  ) {
    return auth
  }

  return null
}

function getEnvCredential() {
  const account = process.env.ADMIN_ACCOUNT?.trim()
  const password = process.env.ADMIN_PASSWORD

  if (!account || !password) {
    return null
  }

  return { account, password, source: 'env' }
}

async function getAdminCredential() {
  return getEnvCredential() || (await readAuthFile())
}

function firstSetupAllowed() {
  return process.env.ALLOW_FIRST_ADMIN_SETUP === 'true'
}

function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const passwordHash = pbkdf2Sync(
    password,
    salt,
    PASSWORD_ITERATIONS,
    32,
    'sha256',
  ).toString('hex')

  return {
    passwordHash,
    salt,
    iterations: PASSWORD_ITERATIONS,
    digest: 'sha256',
  }
}

function safeEqual(left, right) {
  const leftHash = createHash('sha256').update(left).digest()
  const rightHash = createHash('sha256').update(right).digest()

  return timingSafeEqual(leftHash, rightHash)
}

function verifyStoredPassword(password, credential) {
  const passwordHash = pbkdf2Sync(
    password,
    credential.salt,
    credential.iterations,
    32,
    credential.digest || 'sha256',
  ).toString('hex')

  return safeEqual(passwordHash, credential.passwordHash)
}

function verifyCredential(account, password, credential) {
  if (!credential || account !== credential.account) {
    return false
  }

  if (credential.source === 'env') {
    return safeEqual(password, credential.password)
  }

  return verifyStoredPassword(password, credential)
}

async function createStoredAdmin(account, password) {
  const auth = {
    account,
    ...hashPassword(password),
    createdAt: new Date().toISOString(),
  }

  await writeJsonFile(AUTH_FILE, auth)
  return auth
}

function parseCookies(req) {
  const header = req.headers.cookie || ''
  const cookies = new Map()

  for (const part of header.split(';')) {
    const [rawName, ...rawValue] = part.trim().split('=')

    if (!rawName) {
      continue
    }

    cookies.set(rawName, decodeURIComponent(rawValue.join('=')))
  }

  return cookies
}

function cleanupSessions() {
  const now = Date.now()

  for (const [token, session] of sessions) {
    if (session.expiresAt <= now) {
      sessions.delete(token)
    }
  }
}

function getSession(req) {
  cleanupSessions()
  const token = parseCookies(req).get(COOKIE_NAME)

  if (!token) {
    return null
  }

  const session = sessions.get(token)

  if (!session || session.expiresAt <= Date.now()) {
    sessions.delete(token)
    return null
  }

  return session
}

function createSession(account) {
  const token = randomBytes(32).toString('base64url')
  sessions.set(token, {
    account,
    expiresAt: Date.now() + SESSION_TTL_MS,
  })

  return token
}

function cookieSecurity(req) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim()

  return forwardedProto === 'https' || req.socket.encrypted ? '; Secure' : ''
}

function setSessionCookie(req, res, token) {
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${
      SESSION_TTL_MS / 1000
    }${cookieSecurity(req)}`,
  )
}

function clearSessionCookie(req, res) {
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${cookieSecurity(
      req,
    )}`,
  )
}

function sendJson(res, statusCode, payload, headers = {}) {
  res.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    ...headers,
  })
  res.end(JSON.stringify(payload))
}

function sendError(res, statusCode, message) {
  sendJson(res, statusCode, { message })
}

function authStatusPayload(req, configured) {
  return {
    configured,
    isAdmin: Boolean(configured && getSession(req)),
    setupAllowed: !configured && firstSetupAllowed(),
  }
}

function assertSameOrigin(req) {
  const origin = req.headers.origin

  if (!origin) {
    return true
  }

  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let done = false

    req.on('data', (chunk) => {
      if (done) {
        return
      }

      size += chunk.length

      if (size > JSON_LIMIT_BYTES) {
        done = true
        reject(new HttpError(413, '请求内容太大'))
        req.destroy()
        return
      }

      chunks.push(chunk)
    })

    req.on('end', () => {
      if (done) {
        return
      }

      try {
        const text = Buffer.concat(chunks).toString('utf8').trim()
        resolve(text ? JSON.parse(text) : {})
      } catch {
        reject(new HttpError(400, 'JSON 格式不正确'))
      }
    })

    req.on('error', () => {
      if (!done) {
        reject(new HttpError(400, '无法读取请求'))
      }
    })
  })
}

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message)
    this.statusCode = statusCode
  }
}

async function handleApi(req, res, pathname) {
  const credential = await getAdminCredential()
  const configured = Boolean(credential)

  if (req.method !== 'GET' && !assertSameOrigin(req)) {
    sendError(res, 403, '请求来源不正确')
    return
  }

  if (pathname === '/api/state' && req.method === 'GET') {
    sendJson(res, 200, await readState())
    return
  }

  if (pathname === '/api/state' && req.method === 'PUT') {
    if (!configured || !getSession(req)) {
      sendError(res, 401, '请先登录 admin')
      return
    }

    sendJson(res, 200, await writeState(await readJsonBody(req)))
    return
  }

  if (pathname === '/api/auth/status' && req.method === 'GET') {
    sendJson(res, 200, authStatusPayload(req, configured))
    return
  }

  if (pathname === '/api/auth/login' && req.method === 'POST') {
    const body = await readJsonBody(req)
    const account = typeof body.account === 'string' ? body.account.trim() : ''
    const password = typeof body.password === 'string' ? body.password : ''

    if (!account || !password) {
      sendError(res, 400, '请填写账号和密码')
      return
    }

    let activeCredential = credential
    let created = false

    if (!activeCredential) {
      if (!firstSetupAllowed()) {
        sendError(res, 503, '服务端还没有配置 admin')
        return
      }

      activeCredential = await createStoredAdmin(account, password)
      created = true
    } else if (!verifyCredential(account, password, activeCredential)) {
      sendError(res, 401, '账号或密码不正确')
      return
    }

    setSessionCookie(req, res, createSession(account))
    sendJson(res, 200, {
      ...authStatusPayload(req, true),
      configured: true,
      isAdmin: true,
      setupAllowed: false,
      created,
    })
    return
  }

  if (pathname === '/api/auth/logout' && req.method === 'POST') {
    const token = parseCookies(req).get(COOKIE_NAME)

    if (token) {
      sessions.delete(token)
    }

    clearSessionCookie(req, res)
    sendJson(res, 200, authStatusPayload(req, configured))
    return
  }

  sendError(res, 404, '接口不存在')
}

function getMimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase()

  return (
    {
      '.css': 'text/css; charset=utf-8',
      '.gif': 'image/gif',
      '.html': 'text/html; charset=utf-8',
      '.ico': 'image/x-icon',
      '.js': 'text/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.png': 'image/png',
      '.svg': 'image/svg+xml',
      '.webp': 'image/webp',
      '.woff': 'font/woff',
      '.woff2': 'font/woff2',
    }[extension] || 'application/octet-stream'
  )
}

async function serveFile(req, res, filePath) {
  const file = await readFile(filePath)

  res.writeHead(200, {
    'Cache-Control': filePath.endsWith('index.html')
      ? 'no-cache'
      : 'public, max-age=31536000, immutable',
    'Content-Type': getMimeType(filePath),
  })

  if (req.method === 'HEAD') {
    res.end()
    return
  }

  res.end(file)
}

async function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendError(res, 405, '方法不允许')
    return
  }

  let decodedPath = ''

  try {
    decodedPath = decodeURIComponent(pathname)
  } catch {
    sendError(res, 400, '路径不正确')
    return
  }

  const requestedPath =
    decodedPath === '/' ? 'index.html' : decodedPath.replace(/^\/+/, '')
  const staticPath = path.resolve(DIST_DIR, requestedPath)
  const isInsideDist =
    staticPath === DIST_DIR || staticPath.startsWith(`${DIST_DIR}${path.sep}`)

  if (!isInsideDist) {
    sendError(res, 403, '路径不允许')
    return
  }

  try {
    const fileStat = await stat(staticPath)

    if (fileStat.isFile()) {
      await serveFile(req, res, staticPath)
      return
    }
  } catch {
    // Fall through to the SPA entry.
  }

  await serveFile(req, res, path.join(DIST_DIR, 'index.html'))
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://localhost')

    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url.pathname)
      return
    }

    await serveStatic(req, res, url.pathname)
  } catch (error) {
    const statusCode = error instanceof HttpError ? error.statusCode : 500
    const message = error instanceof Error ? error.message : '服务器错误'
    sendError(res, statusCode, message)
  }
}).listen(PORT, '0.0.0.0', () => {
  console.log(`DC Tavern server listening on http://0.0.0.0:${PORT}`)
})
