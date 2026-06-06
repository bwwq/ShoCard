import {
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  type PointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  Check,
  ClipboardPaste,
  Copy,
  Crop as CropIcon,
  Eye,
  Folder,
  GripVertical,
  Image as ImageIcon,
  Import,
  Link as LinkIcon,
  Lock,
  LogOut,
  Moon,
  PanelLeft,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Star,
  Sun,
  Trash2,
  Upload,
} from 'lucide-react'

import { Button } from './components/ui/button'
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from './components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './components/ui/dialog'
import { Input } from './components/ui/input'
import { Textarea } from './components/ui/textarea'

type TavernCard = {
  id: string
  title: string
  url: string
  category: string
  imageUrl: string
  imageHeight: number
  cropX: number
  cropY: number
  cropWidth: number
  cropHeight: number
  imageAspectRatio: number
  recommended: boolean
  createdAt: string
}

type ParsedCard = Pick<TavernCard, 'title' | 'url'> &
  Partial<
    Pick<
      TavernCard,
      | 'category'
      | 'cropHeight'
      | 'cropWidth'
      | 'cropX'
      | 'cropY'
      | 'imageAspectRatio'
      | 'imageHeight'
      | 'imageUrl'
      | 'recommended'
    >
  >

type ThemeMode = 'light' | 'dark'

type CategoryTarget = 'card' | 'edit' | 'import' | 'manage' | 'none'

type CategorySummary = {
  category: string
  count: number
}

type CategoryNode = {
  children: CategoryNode[]
  count: number
  name: string
  path: string
}

type CategoryDropPosition = 'before' | 'after'

type AddCardsResult = {
  count: number
  message: string
}

type CropRect = {
  height: number
  width: number
  x: number
  y: number
}

type CropTarget = 'card' | 'edit'

type AppState = {
  cards: TavernCard[]
  categories: string[]
  siteTitle: string
}

type AuthStatus = {
  configured: boolean
  isAdmin: boolean
  setupAllowed: boolean
}

type ApiRequestError = Error & {
  status?: number
}

const STORAGE_KEY = 'dc-tavern-cards:v1'
const CATEGORY_STORAGE_KEY = 'dc-tavern-categories:v1'
const THEME_KEY = 'dc-tavern-theme:v1'
const SITE_TITLE_KEY = 'dc-tavern-site-title:v1'
const LEGACY_ADMIN_SESSION_KEY = 'dc-tavern-admin-session:v1'
const LEGACY_ADMIN_CREDENTIAL_KEY = 'dc-tavern-admin-credential:v1'
const DEFAULT_SITE_TITLE = 'DC 酒馆卡展示'
const ALL_CATEGORY = '全部'
const DEFAULT_CATEGORY = ''
const LEGACY_DEFAULT_CATEGORY = '默认'
const DEFAULT_IMAGE_HEIGHT = 220
const DEFAULT_CROP = 0
const DEFAULT_CROP_SIZE = 100
const DEFAULT_IMAGE_ASPECT_RATIO = 1.45
const UPLOAD_IMAGE_MAX_SIZE = 1280
const UPLOAD_IMAGE_QUALITY = 0.82
const RECOMMENDED_CATEGORY = '__recommended'
const RECOMMENDED_SECTION_ID = 'recommended-section'
const DISCORD_LINK_PATTERN =
  /https?:\/\/(?:(?:canary|ptb)\.)?discord\.com\/channels\/\S+/i

function makeId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function cleanCategory(value: string | undefined) {
  const parts = value
    ?.split(/[/>\\]+/)
    .map((part) => part.trim())
    .filter(Boolean)

  const category = parts?.length ? parts.join('/') : DEFAULT_CATEGORY

  if (category === LEGACY_DEFAULT_CATEGORY || category === ALL_CATEGORY) {
    return DEFAULT_CATEGORY
  }

  return category
}

function getCategoryParts(category: string) {
  const cleanedCategory = cleanCategory(category)

  return cleanedCategory ? cleanedCategory.split('/') : []
}

function getCategoryParent(category: string) {
  const parts = getCategoryParts(category)
  parts.pop()

  return parts.join('/')
}

function isCategoryWithin(category: string, parentCategory: string) {
  const nextCategory = cleanCategory(category)
  const nextParentCategory = cleanCategory(parentCategory)

  if (!nextParentCategory) {
    return !nextCategory
  }

  return (
    nextCategory === nextParentCategory ||
    nextCategory.startsWith(`${nextParentCategory}/`)
  )
}

function replaceCategoryPath(
  category: string,
  sourceCategory: string,
  targetCategory: string,
) {
  const nextCategory = cleanCategory(category)
  const nextSourceCategory = cleanCategory(sourceCategory)
  const nextTargetCategory = cleanCategory(targetCategory)

  if (!nextSourceCategory || !isCategoryWithin(nextCategory, nextSourceCategory)) {
    return nextCategory
  }

  if (nextCategory === nextSourceCategory) {
    return nextTargetCategory
  }

  return `${nextTargetCategory}${nextCategory.slice(nextSourceCategory.length)}`
}

function formatCategoryLabel(category: string) {
  return cleanCategory(category) || ALL_CATEGORY
}

function cleanImageUrl(value: string | undefined) {
  return value?.trim() || ''
}

function clampNumber(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
) {
  const parsedValue = typeof value === 'number' ? value : Number(value)

  if (!Number.isFinite(parsedValue)) {
    return fallback
  }

  return Math.min(max, Math.max(min, parsedValue))
}

function sanitizeCropRect(value: Partial<CropRect> | undefined): CropRect {
  const width = clampNumber(value?.width, 5, 100, DEFAULT_CROP_SIZE)
  const height = clampNumber(value?.height, 5, 100, DEFAULT_CROP_SIZE)

  return {
    x: clampNumber(value?.x, 0, 100 - width, DEFAULT_CROP),
    y: clampNumber(value?.y, 0, 100 - height, DEFAULT_CROP),
    width,
    height,
  }
}

function getCropAspectRatio(
  imageAspectRatio: number | undefined,
  cropWidth: number,
  cropHeight: number,
) {
  const safeImageAspectRatio = clampNumber(
    imageAspectRatio,
    0.2,
    8,
    DEFAULT_IMAGE_ASPECT_RATIO,
  )

  return clampNumber(
    (cropWidth * safeImageAspectRatio) / cropHeight,
    0.3,
    4,
    DEFAULT_IMAGE_ASPECT_RATIO,
  )
}

function isLocalImageDataUrl(imageUrl: string) {
  return imageUrl.startsWith('data:image/')
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()

    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
        return
      }

      reject(new Error('Invalid file result'))
    })
    reader.addEventListener('error', () => reject(reader.error))
    reader.readAsDataURL(file)
  })
}

function loadImage(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()

    image.addEventListener('load', () => resolve(image))
    image.addEventListener('error', reject)
    image.src = dataUrl
  })
}

async function compressImageFile(file: File) {
  if (!file.type.startsWith('image/')) {
    throw new Error('Not an image')
  }

  const dataUrl = await readFileAsDataUrl(file)

  try {
    const image = await loadImage(dataUrl)
    const aspectRatio =
      image.naturalWidth && image.naturalHeight
        ? image.naturalWidth / image.naturalHeight
        : DEFAULT_IMAGE_ASPECT_RATIO
    const scale = Math.min(
      1,
      UPLOAD_IMAGE_MAX_SIZE / image.naturalWidth,
      UPLOAD_IMAGE_MAX_SIZE / image.naturalHeight,
    )
    const width = Math.max(1, Math.round(image.naturalWidth * scale))
    const height = Math.max(1, Math.round(image.naturalHeight * scale))
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')

    if (!context) {
      return { aspectRatio, dataUrl }
    }

    canvas.width = width
    canvas.height = height
    context.drawImage(image, 0, 0, width, height)

    return {
      aspectRatio,
      dataUrl: canvas.toDataURL('image/webp', UPLOAD_IMAGE_QUALITY),
    }
  } catch {
    return { aspectRatio: DEFAULT_IMAGE_ASPECT_RATIO, dataUrl }
  }
}

async function cropLocalImageDataUrl(imageUrl: string, crop: CropRect) {
  const image = await loadImage(imageUrl)
  const sourceX = Math.round((crop.x / 100) * image.naturalWidth)
  const sourceY = Math.round((crop.y / 100) * image.naturalHeight)
  const sourceWidth = Math.max(
    1,
    Math.round((crop.width / 100) * image.naturalWidth),
  )
  const sourceHeight = Math.max(
    1,
    Math.round((crop.height / 100) * image.naturalHeight),
  )
  const scale = Math.min(
    1,
    UPLOAD_IMAGE_MAX_SIZE / sourceWidth,
    UPLOAD_IMAGE_MAX_SIZE / sourceHeight,
  )
  const targetWidth = Math.max(1, Math.round(sourceWidth * scale))
  const targetHeight = Math.max(1, Math.round(sourceHeight * scale))
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')

  if (!context) {
    return {
      aspectRatio: sourceWidth / sourceHeight,
      dataUrl: imageUrl,
    }
  }

  canvas.width = targetWidth
  canvas.height = targetHeight
  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    targetWidth,
    targetHeight,
  )

  return {
    aspectRatio: sourceWidth / sourceHeight,
    dataUrl: canvas.toDataURL('image/webp', UPLOAD_IMAGE_QUALITY),
  }
}

function normalizeUrl(value: string) {
  const trimmedValue = value.trim()

  if (/^(?:canary\.|ptb\.)?discord\.com\/channels\//i.test(trimmedValue)) {
    return `https://${trimmedValue}`.replace(/\/+$/, '')
  }

  return trimmedValue.replace(/\/+$/, '')
}

function isDiscordChannelUrl(value: string) {
  try {
    const parsed = new URL(value)
    const host = parsed.hostname.toLowerCase()
    return (
      ['discord.com', 'canary.discord.com', 'ptb.discord.com'].includes(host) &&
      parsed.pathname.startsWith('/channels/')
    )
  } catch {
    return false
  }
}

function parseCategoryLine(line: string) {
  const match = line.match(/^(?:分类|category)\s*[:：]\s*(.+)$/i)
  return match ? cleanCategory(match[1]) : null
}

function toCard(card: ParsedCard, fallbackCategory = DEFAULT_CATEGORY): TavernCard {
  const cropRect = sanitizeCropRect({
    height: card.cropHeight,
    width: card.cropWidth,
    x: card.cropX,
    y: card.cropY,
  })

  return {
    id: makeId(),
    title: card.title.trim(),
    url: normalizeUrl(card.url),
    category: cleanCategory(card.category || fallbackCategory),
    imageUrl: cleanImageUrl(card.imageUrl),
    imageHeight: clampNumber(
      card.imageHeight,
      140,
      420,
      DEFAULT_IMAGE_HEIGHT,
    ),
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
    createdAt: new Date().toISOString(),
  }
}

function parseImportText(
  text: string,
  fallbackCategory = DEFAULT_CATEGORY,
): ParsedCard[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const parsedCards: ParsedCard[] = []
  let pendingTitle: string[] = []
  let currentCategory = cleanCategory(fallbackCategory)

  for (const line of lines) {
    const categoryFromLine = parseCategoryLine(line)

    if (categoryFromLine) {
      currentCategory = categoryFromLine
      pendingTitle = []
      continue
    }

    const linkMatch = line.match(DISCORD_LINK_PATTERN)

    if (!linkMatch) {
      pendingTitle.push(line)
      continue
    }

    const titleInSameLine = line.replace(linkMatch[0], '').trim()
    const title = [...pendingTitle, titleInSameLine]
      .filter(Boolean)
      .join(' ')
      .trim()

    parsedCards.push({
      title: title || 'Untitled card',
      url: normalizeUrl(linkMatch[0]),
      category: currentCategory,
    })
    pendingTitle = []
  }

  return parsedCards
}

function migrateStoredCard(value: unknown): TavernCard | null {
  const card = value as Partial<TavernCard>
  const hasCropRect =
    typeof card.cropWidth === 'number' && typeof card.cropHeight === 'number'
  const cropRect = sanitizeCropRect(
    hasCropRect
      ? {
          height: card.cropHeight,
          width: card.cropWidth,
          x: card.cropX,
          y: card.cropY,
        }
      : undefined,
  )

  if (
    typeof card.id !== 'string' ||
    typeof card.title !== 'string' ||
    typeof card.url !== 'string'
  ) {
    return null
  }

  return {
    id: card.id,
    title: card.title,
    url: normalizeUrl(card.url),
    category: cleanCategory(card.category),
    imageUrl: cleanImageUrl(card.imageUrl),
    imageHeight: clampNumber(
      card.imageHeight,
      140,
      420,
      DEFAULT_IMAGE_HEIGHT,
    ),
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
    createdAt:
      typeof card.createdAt === 'string' ? card.createdAt : new Date().toISOString(),
  }
}

function getLegacyCards() {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (!stored) {
      return []
    }

    const parsed = JSON.parse(stored) as unknown[]
    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed
      .map((card) => migrateStoredCard(card))
      .filter((card): card is TavernCard => Boolean(card))
  } catch {
    return []
  }
}

function uniqueCategories(values: string[]) {
  return Array.from(
    new Set(
      values
        .map((value) => cleanCategory(value))
        .filter((value) => Boolean(value)),
    ),
  )
}

function getLegacyCategories(cards: TavernCard[]) {
  try {
    const stored = window.localStorage.getItem(CATEGORY_STORAGE_KEY)
    const parsed = stored ? (JSON.parse(stored) as unknown[]) : []
    const storedCategories = Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === 'string')
      : []

    return uniqueCategories([
      ...storedCategories,
      ...cards.map((card) => card.category),
    ])
  } catch {
    return uniqueCategories(cards.map((card) => card.category))
  }
}

function getInitialTheme(): ThemeMode {
  try {
    const stored = window.localStorage.getItem(THEME_KEY)
    if (stored === 'light' || stored === 'dark') {
      return stored
    }
  } catch {
    return 'light'
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function getLegacySiteTitle() {
  try {
    const stored = window.localStorage.getItem(SITE_TITLE_KEY)?.trim()

    return stored || ''
  } catch {
    return ''
  }
}

function getLegacyState(): AppState | null {
  const cards = getLegacyCards()
  const categories = getLegacyCategories(cards)
  const siteTitle = getLegacySiteTitle()

  if (!cards.length && !categories.length && !siteTitle) {
    return null
  }

  return {
    cards,
    categories,
    siteTitle: siteTitle || DEFAULT_SITE_TITLE,
  }
}

function clearLegacyState() {
  try {
    window.localStorage.removeItem(STORAGE_KEY)
    window.localStorage.removeItem(CATEGORY_STORAGE_KEY)
    window.localStorage.removeItem(SITE_TITLE_KEY)
    window.localStorage.removeItem(LEGACY_ADMIN_SESSION_KEY)
    window.localStorage.removeItem(LEGACY_ADMIN_CREDENTIAL_KEY)
  } catch {
    return
  }
}

function clearLegacyAdminAuth() {
  try {
    window.localStorage.removeItem(LEGACY_ADMIN_SESSION_KEY)
    window.localStorage.removeItem(LEGACY_ADMIN_CREDENTIAL_KEY)
  } catch {
    return
  }
}

function getStatePayload(cards: TavernCard[], categories: string[], siteTitle: string) {
  return {
    cards,
    categories: uniqueCategories([
      ...categories,
      ...cards.map((card) => card.category),
    ]),
    siteTitle: siteTitle.trim() || DEFAULT_SITE_TITLE,
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  })
  const payload = (await response.json().catch(() => null)) as
    | { message?: string }
    | T
    | null

  if (!response.ok) {
    const error = new Error(
      payload &&
        typeof payload === 'object' &&
        'message' in payload &&
        payload.message
        ? payload.message
        : '请求失败',
    ) as ApiRequestError
    error.status = response.status
    throw error
  }

  return payload as T
}

function loadServerState() {
  return requestJson<AppState>('/api/state')
}

function saveServerState(state: AppState) {
  return requestJson<AppState>('/api/state', {
    body: JSON.stringify(state),
    method: 'PUT',
  })
}

function loadAuthStatus() {
  return requestJson<AuthStatus>('/api/auth/status')
}

function loginAdmin(account: string, password: string) {
  return requestJson<AuthStatus>('/api/auth/login', {
    body: JSON.stringify({ account, password }),
    method: 'POST',
  })
}

function logoutAdmin() {
  return requestJson<AuthStatus>('/api/auth/logout', {
    body: JSON.stringify({}),
    method: 'POST',
  })
}

function shouldMigrateLegacyState(serverState: AppState, legacyState: AppState | null) {
  return (
    Boolean(legacyState) &&
    !serverState.cards.length &&
    !serverState.categories.length &&
    serverState.siteTitle === DEFAULT_SITE_TITLE
  )
}

async function publishLegacyState(serverState: AppState) {
  const legacyState = getLegacyState()

  if (!shouldMigrateLegacyState(serverState, legacyState)) {
    return null
  }

  return saveServerState(legacyState!)
}

function categoryElementId(category: string) {
  let hash = 0

  for (let index = 0; index < category.length; index += 1) {
    hash = (hash * 31 + category.charCodeAt(index)) | 0
  }

  return `category-${Math.abs(hash)}`
}

type MutableCategoryNode = {
  children: Map<string, MutableCategoryNode>
  count: number
  name: string
  path: string
}

function buildCategoryTree(categories: string[], cards: TavernCard[]): CategoryNode[] {
  const roots = new Map<string, MutableCategoryNode>()

  function ensurePath(category: string, increment: number) {
    let siblings = roots
    let currentPath = ''

    for (const part of getCategoryParts(category)) {
      currentPath = currentPath ? `${currentPath}/${part}` : part

      if (!siblings.has(part)) {
        siblings.set(part, {
          children: new Map<string, MutableCategoryNode>(),
          count: 0,
          name: part,
          path: currentPath,
        })
      }

      const node = siblings.get(part)!
      node.count += increment
      siblings = node.children
    }
  }

  for (const category of categories) {
    ensurePath(category, 0)
  }

  for (const card of cards) {
    ensurePath(card.category, 1)
  }

  function toCategoryNodes(
    nodes: Map<string, MutableCategoryNode>,
  ): CategoryNode[] {
    return Array.from(nodes.values()).map((node) => ({
      children: toCategoryNodes(node.children),
      count: node.count,
      name: node.name,
      path: node.path,
    }))
  }

  return toCategoryNodes(roots)
}

type CategoryTreeProps = {
  activeCategory: string
  draggedCategory: string
  depth?: number
  dropCategory: string
  dropPosition: CategoryDropPosition | null
  isEditMode: boolean
  nodes: CategoryNode[]
  onCreateChild: (parentCategory: string) => void
  onDragEnd: () => void
  onDragLeave: () => void
  onDragOver: (
    event: DragEvent<HTMLDivElement>,
    targetCategory: string,
    position: CategoryDropPosition,
  ) => void
  onDragStart: (category: string) => void
  onDrop: (
    event: DragEvent<HTMLDivElement>,
    targetCategory: string,
    position: CategoryDropPosition,
  ) => void
  onJump: (category: string) => void
  onRename: (category: string) => void
}

function CategoryTree({
  activeCategory,
  draggedCategory,
  depth = 0,
  dropCategory,
  dropPosition,
  isEditMode,
  nodes,
  onCreateChild,
  onDragEnd,
  onDragLeave,
  onDragOver,
  onDragStart,
  onDrop,
  onJump,
  onRename,
}: CategoryTreeProps) {
  return (
    <div className="space-y-1">
      {nodes.map((node) => (
        <div
          key={node.path}
          className={`space-y-1 rounded-md ${
            draggedCategory === node.path ? 'opacity-50' : ''
          }`}
        >
          <div
            className={`flex items-center gap-1 rounded-md ${
              dropCategory === node.path && dropPosition
                ? 'ring-2 ring-ring'
                : ''
            }`}
            onDragLeave={isEditMode ? onDragLeave : undefined}
            onDragOver={
              isEditMode
                ? (event) => {
                    const bounds = event.currentTarget.getBoundingClientRect()
                    const position =
                      event.clientY < bounds.top + bounds.height / 2
                        ? 'before'
                        : 'after'
                    onDragOver(event, node.path, position)
                  }
                : undefined
            }
            onDrop={
              isEditMode
                ? (event) => {
                    const bounds = event.currentTarget.getBoundingClientRect()
                    const position =
                      event.clientY < bounds.top + bounds.height / 2
                        ? 'before'
                        : 'after'
                    onDrop(event, node.path, position)
                  }
                : undefined
            }
          >
            {isEditMode ? (
              <button
                aria-label={`拖动 ${node.path}`}
                className="flex size-10 shrink-0 cursor-grab items-center justify-center rounded-md text-muted-foreground transition-colors active:cursor-grabbing hover:bg-accent hover:text-accent-foreground"
                draggable
                title="拖动排序"
                type="button"
                style={{ marginLeft: depth * 14 }}
                onDragEnd={onDragEnd}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'move'
                  event.dataTransfer.setData('text/plain', node.path)
                  onDragStart(node.path)
                }}
              >
                <GripVertical className="size-4" />
              </button>
            ) : null}
            <button
              className={`flex h-10 min-w-0 flex-1 items-center justify-between gap-3 rounded-md pr-3 text-left text-sm transition-colors ${
                activeCategory === node.path
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              }`}
              style={{ paddingLeft: isEditMode ? 12 : 12 + depth * 14 }}
              type="button"
              onClick={() => onJump(node.path)}
            >
              <span className="flex min-w-0 items-center gap-2">
                <Folder className="size-4 shrink-0" />
                <span className="truncate">{node.name}</span>
              </span>
              <span className="shrink-0">{node.count}</span>
            </button>
            {isEditMode ? (
              <>
                <button
                  aria-label={`重命名 ${node.path}`}
                  className="flex size-10 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                  title="重命名分类"
                  type="button"
                  onClick={() => onRename(node.path)}
                >
                  <Pencil className="size-4" />
                </button>
                <button
                  aria-label={`创建 ${node.path} 的子分类`}
                  className="flex size-10 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                  title="创建子分类"
                  type="button"
                  onClick={() => onCreateChild(node.path)}
                >
                  <Plus className="size-4" />
                </button>
              </>
            ) : null}
          </div>
          {node.children.length ? (
            <CategoryTree
              activeCategory={activeCategory}
              draggedCategory={draggedCategory}
              depth={depth + 1}
              dropCategory={dropCategory}
              dropPosition={dropPosition}
              isEditMode={isEditMode}
              nodes={node.children}
              onCreateChild={onCreateChild}
              onDragEnd={onDragEnd}
              onDragLeave={onDragLeave}
              onDragOver={onDragOver}
              onDragStart={onDragStart}
              onDrop={onDrop}
              onJump={onJump}
              onRename={onRename}
            />
          ) : null}
        </div>
      ))}
    </div>
  )
}

type CategorySelectControlProps = {
  categories: string[]
  label: string
  onChange: (value: string) => void
  onCreate: () => void
  value: string
}

function CategorySelectControl({
  categories,
  label,
  onChange,
  onCreate,
  value,
}: CategorySelectControlProps) {
  return (
    <label className="block space-y-2 text-sm font-medium">
      <span>{label}</span>
      <div className="grid grid-cols-[minmax(0,1fr)_40px] gap-2">
        <select
          className="flex h-11 w-full rounded-md border border-input bg-card/80 px-3 py-2 text-sm text-foreground shadow-hairline transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={cleanCategory(value)}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value={DEFAULT_CATEGORY}>{ALL_CATEGORY}</option>
          {categories.map((category) => (
            <option key={category} value={category}>
              {formatCategoryLabel(category)}
            </option>
          ))}
        </select>
        <Button
          aria-label="创建同级分类"
          size="icon"
          title="创建同级分类"
          type="button"
          variant="outline"
          onClick={onCreate}
        >
          <Plus />
        </Button>
      </div>
    </label>
  )
}

type CroppedImageProps = {
  className?: string
  cropHeight: number
  cropWidth: number
  cropX: number
  cropY: number
  imageAspectRatio: number
  imageUrl: string
  loading?: 'eager' | 'lazy'
}

function CroppedImage({
  className,
  cropHeight,
  cropWidth,
  cropX,
  cropY,
  imageAspectRatio,
  imageUrl,
  loading = 'lazy',
}: CroppedImageProps) {
  const cropRect = sanitizeCropRect({
    height: cropHeight,
    width: cropWidth,
    x: cropX,
    y: cropY,
  })
  const aspectRatio = getCropAspectRatio(
    imageAspectRatio,
    cropRect.width,
    cropRect.height,
  )

  return (
    <div
      className={`relative overflow-hidden bg-muted ${imageUrl ? '' : 'border border-dashed border-border'} ${className || ''}`}
      style={{ aspectRatio }}
    >
      {imageUrl ? (
        <img
          alt=""
          className="absolute max-w-none select-none"
          draggable={false}
          loading={loading}
          src={imageUrl}
          style={{
            left: `${-(cropRect.x / cropRect.width) * 100}%`,
            top: `${-(cropRect.y / cropRect.height) * 100}%`,
            width: `${(100 / cropRect.width) * 100}%`,
          }}
        />
      ) : (
        <div className="flex h-full min-h-32 items-center justify-center text-sm text-muted-foreground">
          未设置预览图
        </div>
      )}
    </div>
  )
}

type ImageCropDialogProps = {
  imageUrl: string
  initialCrop: CropRect
  open: boolean
  title: string
  onOpenChange: (open: boolean) => void
  onSave: (result: CropRect & { imageAspectRatio: number; imageUrl: string }) => void
}

function ImageCropDialog({
  imageUrl,
  initialCrop,
  open,
  title,
  onOpenChange,
  onSave,
}: ImageCropDialogProps) {
  const [draftCrop, setDraftCrop] = useState<CropRect>(
    sanitizeCropRect(initialCrop),
  )
  const [imageAspectRatio, setImageAspectRatio] = useState(
    DEFAULT_IMAGE_ASPECT_RATIO,
  )
  const [isSaving, setIsSaving] = useState(false)
  const dragStartRef = useRef<{ x: number; y: number } | null>(null)

  function getCropPoint(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect()

    return {
      x: clampNumber(((event.clientX - rect.left) / rect.width) * 100, 0, 100, 0),
      y: clampNumber(((event.clientY - rect.top) / rect.height) * 100, 0, 100, 0),
    }
  }

  function buildCropFromPoints(
    start: { x: number; y: number },
    end: { x: number; y: number },
  ) {
    const minSize = 4
    let x = Math.min(start.x, end.x)
    let y = Math.min(start.y, end.y)
    const width = Math.max(minSize, Math.abs(end.x - start.x))
    const height = Math.max(minSize, Math.abs(end.y - start.y))

    if (x + width > 100) {
      x = 100 - width
    }

    if (y + height > 100) {
      y = 100 - height
    }

    return sanitizeCropRect({ height, width, x, y })
  }

  async function saveCrop() {
    const nextCrop = sanitizeCropRect(draftCrop)
    let nextImageUrl = imageUrl
    let nextImageAspectRatio = imageAspectRatio
    let nextCropRect = nextCrop

    setIsSaving(true)

    try {
      if (isLocalImageDataUrl(imageUrl)) {
        const croppedImage = await cropLocalImageDataUrl(imageUrl, nextCrop)
        nextImageUrl = croppedImage.dataUrl
        nextImageAspectRatio = croppedImage.aspectRatio
        nextCropRect = sanitizeCropRect({
          height: DEFAULT_CROP_SIZE,
          width: DEFAULT_CROP_SIZE,
          x: DEFAULT_CROP,
          y: DEFAULT_CROP,
        })
      }
    } catch {
      nextImageAspectRatio = getCropAspectRatio(
        imageAspectRatio,
        nextCrop.width,
        nextCrop.height,
      )
    } finally {
      setIsSaving(false)
    }

    onSave({
      ...nextCropRect,
      imageAspectRatio: nextImageAspectRatio,
      imageUrl: nextImageUrl,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-6xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">
            图片裁剪与预览
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section className="min-w-0 rounded-lg border border-border bg-muted/50 p-3">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium">
              <ImageIcon className="size-4" />
              完整图片
            </div>
            <div className="flex max-h-[68vh] min-h-72 items-center justify-center overflow-auto rounded-md border border-border bg-card p-3">
              {imageUrl ? (
                <div
                  className="relative inline-block max-w-full touch-none select-none"
                  onPointerDown={(event) => {
                    const start = getCropPoint(event)
                    dragStartRef.current = start
                    event.currentTarget.setPointerCapture(event.pointerId)
                    setDraftCrop(
                      sanitizeCropRect({
                        height: 4,
                        width: 4,
                        x: start.x,
                        y: start.y,
                      }),
                    )
                  }}
                  onPointerMove={(event) => {
                    if (!dragStartRef.current || event.buttons !== 1) {
                      return
                    }

                    setDraftCrop(
                      buildCropFromPoints(
                        dragStartRef.current,
                        getCropPoint(event),
                      ),
                    )
                  }}
                  onPointerUp={() => {
                    dragStartRef.current = null
                  }}
                >
                  <img
                    alt=""
                    className="block max-h-[60vh] max-w-full select-none rounded-sm object-contain"
                    draggable={false}
                    src={imageUrl}
                    onLoad={(event) => {
                      const { naturalHeight, naturalWidth } = event.currentTarget
                      setImageAspectRatio(
                        naturalWidth && naturalHeight
                          ? naturalWidth / naturalHeight
                          : DEFAULT_IMAGE_ASPECT_RATIO,
                      )
                    }}
                  />
                  <div
                    className="pointer-events-none absolute border-2 border-primary bg-background/20 shadow-soft"
                    style={{
                      height: `${draftCrop.height}%`,
                      left: `${draftCrop.x}%`,
                      top: `${draftCrop.y}%`,
                      width: `${draftCrop.width}%`,
                    }}
                  />
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">未设置预览图</div>
              )}
            </div>
          </section>

          <aside className="space-y-4 rounded-lg border border-border bg-card p-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <CropIcon className="size-4" />
                预览图
              </div>
              <CroppedImage
                className="rounded-md border border-border"
                cropHeight={draftCrop.height}
                cropWidth={draftCrop.width}
                cropX={draftCrop.x}
                cropY={draftCrop.y}
                imageAspectRatio={imageAspectRatio}
                imageUrl={imageUrl}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  setDraftCrop(
                    sanitizeCropRect({
                      height: DEFAULT_CROP_SIZE,
                      width: DEFAULT_CROP_SIZE,
                      x: DEFAULT_CROP,
                      y: DEFAULT_CROP,
                    }),
                  )
                }
              >
                <RotateCcw />
                重置
              </Button>
              <Button
                disabled={!imageUrl || isSaving}
                type="button"
                onClick={saveCrop}
              >
                <Check />
                保存
              </Button>
            </div>
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  )
}

type TavernCardItemProps = {
  card: TavernCard
  isEditMode: boolean
  onCopyLink: (cardUrl: string) => void
  onDeleteCard: (cardId: string) => void
  onOpenEditor: (card: TavernCard) => void
}

function TavernCardItem({
  card,
  isEditMode,
  onCopyLink,
  onDeleteCard,
  onOpenEditor,
}: TavernCardItemProps) {
  return (
    <Card className="flex h-full min-w-0 flex-col overflow-hidden bg-card/90 transition-transform duration-200 hover:-translate-y-0.5">
      {card.imageUrl ? (
        <CroppedImage
          className="border-b border-border"
          cropHeight={card.cropHeight}
          cropWidth={card.cropWidth}
          cropX={card.cropX}
          cropY={card.cropY}
          imageAspectRatio={card.imageAspectRatio}
          imageUrl={card.imageUrl}
        />
      ) : null}
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {card.recommended ? (
            <span className="inline-flex w-fit items-center gap-1 rounded-md border border-border bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground">
              <Star className="size-3" />
              推荐
            </span>
          ) : null}
          <span className="w-fit rounded-md border border-border bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
            {formatCategoryLabel(card.category)}
          </span>
        </div>
        <CardTitle className="break-words text-lg leading-6">
          {card.title}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1">
        <div className="flex items-stretch gap-2">
          <a
            aria-label={`打开 ${card.title}`}
            className="flex min-w-0 flex-1 items-start gap-2 rounded-md border border-border bg-muted/80 p-3 text-xs leading-5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            href={card.url}
            rel="noreferrer"
            target="_blank"
          >
            <LinkIcon className="mt-0.5 size-4 shrink-0" />
            <span className="min-w-0 break-all">{card.url}</span>
          </a>
          <Button
            className="h-auto self-stretch"
            size="icon"
            title="复制"
            type="button"
            variant="outline"
            onClick={() => onCopyLink(card.url)}
          >
            <Copy />
            <span className="sr-only">复制</span>
          </Button>
        </div>
      </CardContent>
      {isEditMode ? (
        <CardFooter className="justify-end">
          <Button
            size="icon"
            title="编辑"
            type="button"
            variant="outline"
            onClick={() => onOpenEditor(card)}
          >
            <Pencil />
            <span className="sr-only">编辑</span>
          </Button>
          <Button
            size="icon"
            title="删除"
            type="button"
            variant="outline"
            onClick={() => onDeleteCard(card.id)}
          >
            <Trash2 />
            <span className="sr-only">删除</span>
          </Button>
        </CardFooter>
      ) : null}
    </Card>
  )
}

function App() {
  const [cards, setCards] = useState<TavernCard[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme)
  const [siteTitle, setSiteTitle] = useState(DEFAULT_SITE_TITLE)
  const [siteTitleDialogOpen, setSiteTitleDialogOpen] = useState(false)
  const [siteTitleDraft, setSiteTitleDraft] = useState('')
  const [siteTitleError, setSiteTitleError] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)
  const [isEditMode, setIsEditMode] = useState(false)
  const [adminDialogOpen, setAdminDialogOpen] = useState(false)
  const [adminConfigured, setAdminConfigured] = useState(true)
  const [adminSetupAllowed, setAdminSetupAllowed] = useState(false)
  const [adminAccount, setAdminAccount] = useState('')
  const [adminPassword, setAdminPassword] = useState('')
  const [adminError, setAdminError] = useState('')
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false)
  const [categoryDraft, setCategoryDraft] = useState('')
  const [categoryParent, setCategoryParent] = useState('')
  const [categoryTarget, setCategoryTarget] =
    useState<CategoryTarget>('none')
  const [renameCategoryDialogOpen, setRenameCategoryDialogOpen] =
    useState(false)
  const [renamingCategory, setRenamingCategory] = useState('')
  const [renameCategoryDraft, setRenameCategoryDraft] = useState('')
  const [renameCategoryError, setRenameCategoryError] = useState('')
  const [draggedCategory, setDraggedCategory] = useState('')
  const [dropCategory, setDropCategory] = useState('')
  const [dropPosition, setDropPosition] =
    useState<CategoryDropPosition | null>(null)
  const [managedCategory, setManagedCategory] = useState(DEFAULT_CATEGORY)
  const [moveTargetCategory, setMoveTargetCategory] = useState(DEFAULT_CATEGORY)
  const [deleteCategoryDialogOpen, setDeleteCategoryDialogOpen] = useState(false)
  const [deleteMoveTargetCategory, setDeleteMoveTargetCategory] =
    useState(DEFAULT_CATEGORY)
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [cropTarget, setCropTarget] = useState<CropTarget | null>(null)
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [category, setCategory] = useState(DEFAULT_CATEGORY)
  const [imageUrl, setImageUrl] = useState('')
  const [imageHeight, setImageHeight] = useState(DEFAULT_IMAGE_HEIGHT)
  const [cropX, setCropX] = useState(DEFAULT_CROP)
  const [cropY, setCropY] = useState(DEFAULT_CROP)
  const [cropWidth, setCropWidth] = useState(DEFAULT_CROP_SIZE)
  const [cropHeight, setCropHeight] = useState(DEFAULT_CROP_SIZE)
  const [imageAspectRatio, setImageAspectRatio] = useState(
    DEFAULT_IMAGE_ASPECT_RATIO,
  )
  const [recommended, setRecommended] = useState(false)
  const [addFormError, setAddFormError] = useState('')
  const [query, setQuery] = useState('')
  const [importText, setImportText] = useState('')
  const [importCategory, setImportCategory] = useState(DEFAULT_CATEGORY)
  const [importRecommended, setImportRecommended] = useState(false)
  const [importError, setImportError] = useState('')
  const [notice, setNotice] = useState('')
  const [activeCategory, setActiveCategory] = useState(DEFAULT_CATEGORY)
  const [editingCard, setEditingCard] = useState<TavernCard | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editUrl, setEditUrl] = useState('')
  const [editCategory, setEditCategory] = useState(DEFAULT_CATEGORY)
  const [editImageUrl, setEditImageUrl] = useState('')
  const [editImageHeight, setEditImageHeight] = useState(DEFAULT_IMAGE_HEIGHT)
  const [editCropX, setEditCropX] = useState(DEFAULT_CROP)
  const [editCropY, setEditCropY] = useState(DEFAULT_CROP)
  const [editCropWidth, setEditCropWidth] = useState(DEFAULT_CROP_SIZE)
  const [editCropHeight, setEditCropHeight] = useState(DEFAULT_CROP_SIZE)
  const [editImageAspectRatio, setEditImageAspectRatio] = useState(
    DEFAULT_IMAGE_ASPECT_RATIO,
  )
  const [editRecommended, setEditRecommended] = useState(false)
  const [editFormError, setEditFormError] = useState('')
  const [stateLoaded, setStateLoaded] = useState(false)
  const [stateError, setStateError] = useState('')
  const [isSavingState, setIsSavingState] = useState(false)
  const [legacyStateAvailable, setLegacyStateAvailable] = useState(() =>
    Boolean(getLegacyState()),
  )
  const lastSavedStateRef = useRef('')
  const titleTapCountRef = useRef(0)
  const titleTapTimerRef = useRef<number | null>(null)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    document.documentElement.style.colorScheme = theme
    window.localStorage.setItem(THEME_KEY, theme)
  }, [theme])

  useEffect(() => {
    document.title = siteTitle
  }, [siteTitle])

  useEffect(() => {
    let cancelled = false
    clearLegacyAdminAuth()

    async function loadInitialData() {
      try {
        const [serverState, authStatus] = await Promise.all([
          loadServerState(),
          loadAuthStatus(),
        ])

        if (cancelled) {
          return
        }

        const nextState = getStatePayload(
          serverState.cards,
          serverState.categories,
          serverState.siteTitle,
        )
        setCards(nextState.cards)
        setCategories(nextState.categories)
        setSiteTitle(nextState.siteTitle)
        setIsAdmin(authStatus.isAdmin)
        setAdminConfigured(authStatus.configured)
        setAdminSetupAllowed(authStatus.setupAllowed)
        setStateError('')
        setStateLoaded(true)
        lastSavedStateRef.current = JSON.stringify(nextState)
      } catch (error) {
        if (cancelled) {
          return
        }

        setStateError(error instanceof Error ? error.message : '无法加载服务器存档')
        setStateLoaded(true)
      }
    }

    loadInitialData()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!stateLoaded || !isAdmin) {
      return
    }

    const nextState = getStatePayload(cards, categories, siteTitle)
    const serializedState = JSON.stringify(nextState)

    if (serializedState === lastSavedStateRef.current) {
      return
    }

    const timeoutId = window.setTimeout(async () => {
      try {
        setIsSavingState(true)
        await saveServerState(nextState)
        lastSavedStateRef.current = serializedState
        setStateError('')
      } catch (error) {
        const apiError = error as ApiRequestError

        if (apiError.status === 401) {
          setIsAdmin(false)
          setIsEditMode(false)
          setEditingCard(null)
          setNotice('Admin 会话已失效，请重新登录')
        }

        setStateError(error instanceof Error ? error.message : '保存服务器存档失败')
      } finally {
        setIsSavingState(false)
      }
    }, 300)

    return () => window.clearTimeout(timeoutId)
  }, [cards, categories, isAdmin, siteTitle, stateLoaded])

  useEffect(() => {
    return () => {
      if (titleTapTimerRef.current) {
        window.clearTimeout(titleTapTimerRef.current)
      }
    }
  }, [])

  const categoryPaths = useMemo<CategorySummary[]>(() => {
    const categoryMap = new Map<string, number>(
      categories.map((categoryName) => [categoryName, 0]),
    )

    for (const card of cards) {
      if (card.category) {
        categoryMap.set(card.category, (categoryMap.get(card.category) || 0) + 1)
      }
    }

    return Array.from(categoryMap, ([categoryName, count]) => ({
      category: categoryName,
      count,
    }))
  }, [cards, categories])

  const categoryTree = useMemo(
    () => buildCategoryTree(categories, cards),
    [cards, categories],
  )

  const filteredCards = useMemo(() => {
    const trimmedQuery = query.trim().toLowerCase()

    if (!trimmedQuery) {
      return cards
    }

    return cards.filter((card) => {
      return (
        card.title.toLowerCase().includes(trimmedQuery) ||
        formatCategoryLabel(card.category).toLowerCase().includes(trimmedQuery) ||
        card.url.toLowerCase().includes(trimmedQuery)
      )
    })
  }, [cards, query])

  const groupedCards = useMemo(() => {
    const categoryMap = new Map<string, TavernCard[]>()
    const categoryOrder = new Map(
      categories.map((categoryName, index) => [categoryName, index]),
    )

    for (const card of filteredCards) {
      const groupName = card.category || ALL_CATEGORY
      const group = categoryMap.get(groupName) || []
      group.push(card)
      categoryMap.set(groupName, group)
    }

    return Array.from(categoryMap.entries()).sort(([leftName], [rightName]) => {
      const leftCategory = leftName === ALL_CATEGORY ? DEFAULT_CATEGORY : leftName
      const rightCategory =
        rightName === ALL_CATEGORY ? DEFAULT_CATEGORY : rightName
      const leftOrder = leftCategory
        ? (categoryOrder.get(leftCategory) ?? Number.MAX_SAFE_INTEGER)
        : -1
      const rightOrder = rightCategory
        ? (categoryOrder.get(rightCategory) ?? Number.MAX_SAFE_INTEGER)
        : -1

      return leftOrder - rightOrder
    })
  }, [categories, filteredCards])

  const recommendedCards = useMemo(
    () => filteredCards.filter((card) => card.recommended),
    [filteredCards],
  )

  const categoryOptions = useMemo(
    () => categoryPaths.map((item) => item.category),
    [categoryPaths],
  )

  const currentManagedCategory =
    categoryOptions.includes(cleanCategory(managedCategory))
      ? cleanCategory(managedCategory)
      : DEFAULT_CATEGORY

  const moveTargetOptions = currentManagedCategory
    ? [
        DEFAULT_CATEGORY,
        ...categoryOptions.filter(
          (item) => !isCategoryWithin(item, currentManagedCategory),
        ),
      ]
    : []
  const safeMoveTargetCategory = moveTargetOptions.includes(
    cleanCategory(moveTargetCategory),
  )
    ? cleanCategory(moveTargetCategory)
    : moveTargetOptions[0] || DEFAULT_CATEGORY
  const deleteTargetOptions = currentManagedCategory
    ? [
        DEFAULT_CATEGORY,
        ...categoryOptions.filter(
          (item) => !isCategoryWithin(item, currentManagedCategory),
        ),
      ]
    : []
  const safeDeleteMoveTargetCategory = deleteTargetOptions.includes(
    cleanCategory(deleteMoveTargetCategory),
  )
    ? cleanCategory(deleteMoveTargetCategory)
    : deleteTargetOptions[0] || DEFAULT_CATEGORY

  function notify(message: string) {
    setNotice(message)
  }

  function resetAddForm() {
    setTitle('')
    setUrl('')
    setImageUrl('')
    setImageHeight(DEFAULT_IMAGE_HEIGHT)
    setCropX(DEFAULT_CROP)
    setCropY(DEFAULT_CROP)
    setCropWidth(DEFAULT_CROP_SIZE)
    setCropHeight(DEFAULT_CROP_SIZE)
    setImageAspectRatio(DEFAULT_IMAGE_ASPECT_RATIO)
    setRecommended(false)
    setAddFormError('')
  }

  function openCropEditor(target: CropTarget) {
    const targetImageUrl = target === 'card' ? imageUrl : editImageUrl

    if (!targetImageUrl.trim()) {
      notify('请先添加预览图')
      return
    }

    setCropTarget(target)
  }

  function saveCropResult(
    result: CropRect & { imageAspectRatio: number; imageUrl: string },
  ) {
    if (cropTarget === 'card') {
      setImageUrl(result.imageUrl)
      setCropX(result.x)
      setCropY(result.y)
      setCropWidth(result.width)
      setCropHeight(result.height)
      setImageAspectRatio(result.imageAspectRatio)
    }

    if (cropTarget === 'edit') {
      setEditImageUrl(result.imageUrl)
      setEditCropX(result.x)
      setEditCropY(result.y)
      setEditCropWidth(result.width)
      setEditCropHeight(result.height)
      setEditImageAspectRatio(result.imageAspectRatio)
    }

    setCropTarget(null)
    notify('裁剪已保存')
  }

  function addCategoryPath(categoryPath: string) {
    const nextCategory = cleanCategory(categoryPath)

    if (nextCategory) {
      setCategories((currentCategories) =>
        uniqueCategories([...currentCategories, nextCategory]),
      )
    }

    return nextCategory
  }

  function openCategoryCreator(
    parentCategory = '',
    target: CategoryTarget = 'none',
  ) {
    setCategoryParent(parentCategory ? cleanCategory(parentCategory) : '')
    setCategoryTarget(target)
    setCategoryDraft('')
    setCategoryDialogOpen(true)
  }

  function openSiblingCategoryCreator(
    siblingCategory: string,
    target: CategoryTarget = 'none',
  ) {
    openCategoryCreator(getCategoryParent(siblingCategory), target)
  }

  function openRenameCategoryDialog(categoryPath: string) {
    const nextCategory = cleanCategory(categoryPath)
    const categoryName = getCategoryParts(nextCategory).at(-1) || ''

    if (!nextCategory || !categoryName) {
      notify('全部不是可编辑目录')
      return
    }

    setRenamingCategory(nextCategory)
    setRenameCategoryDraft(categoryName)
    setRenameCategoryError('')
    setRenameCategoryDialogOpen(true)
  }

  function resetCategorySelection(removedCategory: string, fallbackCategory: string) {
    const nextFallbackCategory = cleanCategory(fallbackCategory)

    if (isCategoryWithin(category, removedCategory)) {
      setCategory(nextFallbackCategory)
    }

    if (isCategoryWithin(importCategory, removedCategory)) {
      setImportCategory(nextFallbackCategory)
    }

    if (isCategoryWithin(editCategory, removedCategory)) {
      setEditCategory(nextFallbackCategory)
    }

    if (isCategoryWithin(activeCategory, removedCategory)) {
      setActiveCategory(nextFallbackCategory)
    }

    if (isCategoryWithin(managedCategory, removedCategory)) {
      setManagedCategory(nextFallbackCategory)
    }

    if (isCategoryWithin(moveTargetCategory, removedCategory)) {
      setMoveTargetCategory(nextFallbackCategory)
    }

    if (isCategoryWithin(deleteMoveTargetCategory, removedCategory)) {
      setDeleteMoveTargetCategory(nextFallbackCategory)
    }
  }

  function remapCategorySelection(sourceCategory: string, targetCategory: string) {
    const remap = (value: string) =>
      isCategoryWithin(value, sourceCategory)
        ? replaceCategoryPath(value, sourceCategory, targetCategory)
        : value

    setCategory((currentCategory) => remap(currentCategory))
    setImportCategory((currentCategory) => remap(currentCategory))
    setEditCategory((currentCategory) => remap(currentCategory))
    setActiveCategory((currentCategory) => remap(currentCategory))
    setManagedCategory((currentCategory) => remap(currentCategory))
    setMoveTargetCategory((currentCategory) => remap(currentCategory))
    setDeleteMoveTargetCategory((currentCategory) => remap(currentCategory))
  }

  function saveCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!categoryDraft.trim()) {
      notify('请填写分类名称')
      return
    }

    const nextCategoryPath = categoryParent
      ? `${categoryParent}/${categoryDraft.trim()}`
      : categoryDraft.trim()
    const nextCategory = addCategoryPath(nextCategoryPath)

    if (!nextCategory) {
      notify('全部不是目录名称')
      return
    }

    if (categoryTarget === 'card') {
      setCategory(nextCategory)
    }

    if (categoryTarget === 'import') {
      setImportCategory(nextCategory)
    }

    if (categoryTarget === 'edit') {
      setEditCategory(nextCategory)
    }

    if (categoryTarget === 'manage') {
      setManagedCategory(nextCategory)
      setMoveTargetCategory(nextCategory)
      setActiveCategory(nextCategory)
    }

    setCategoryDialogOpen(false)
    setCategoryDraft('')
    setCategoryParent('')
    setCategoryTarget('none')
    notify('已创建分类')
  }

  function saveRenamedCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!isAdmin || !isEditMode) {
      notify('请先进入 admin 编辑模式')
      return
    }

    const sourceCategory = cleanCategory(renamingCategory)
    const nextName = renameCategoryDraft.trim()

    if (!sourceCategory) {
      setRenameCategoryError('请选择分类')
      return
    }

    if (!nextName) {
      setRenameCategoryError('请填写分类名称')
      return
    }

    if (/[/>\\]+/.test(nextName)) {
      setRenameCategoryError('分类名称不能包含 /、> 或 \\')
      return
    }

    const nextParts = getCategoryParts(sourceCategory)
    nextParts[nextParts.length - 1] = nextName
    const targetCategory = cleanCategory(nextParts.join('/'))

    if (!targetCategory) {
      setRenameCategoryError('全部不是目录名称')
      return
    }

    if (sourceCategory === targetCategory) {
      setRenameCategoryDialogOpen(false)
      setRenameCategoryDraft('')
      setRenamingCategory('')
      setRenameCategoryError('')
      notify('分类名称没有变化')
      return
    }

    const outsideCategories = categoryOptions.filter(
      (item) => !isCategoryWithin(item, sourceCategory),
    )
    const renamedCategories = uniqueCategories(
      categoryOptions
        .filter((item) => isCategoryWithin(item, sourceCategory))
        .map((item) => replaceCategoryPath(item, sourceCategory, targetCategory)),
    )

    if (
      renamedCategories.some((item) => outsideCategories.includes(item)) ||
      outsideCategories.includes(targetCategory)
    ) {
      setRenameCategoryError('这个分类已经存在')
      return
    }

    setCategories((currentCategories) =>
      uniqueCategories(
        currentCategories.map((item) =>
          replaceCategoryPath(item, sourceCategory, targetCategory),
        ),
      ),
    )
    setCards((currentCards) =>
      currentCards.map((card) =>
        isCategoryWithin(card.category, sourceCategory)
          ? {
              ...card,
              category: replaceCategoryPath(
                card.category,
                sourceCategory,
                targetCategory,
              ),
            }
          : card,
      ),
    )
    remapCategorySelection(sourceCategory, targetCategory)
    setRenamingCategory('')
    setRenameCategoryDraft('')
    setRenameCategoryError('')
    setRenameCategoryDialogOpen(false)
    notify('分类已重命名')
  }

  function resetCategoryDragState() {
    setDraggedCategory('')
    setDropCategory('')
    setDropPosition(null)
  }

  function dragCategory(categoryPath: string) {
    setDraggedCategory(cleanCategory(categoryPath))
  }

  function hoverCategoryDrop(
    event: DragEvent<HTMLDivElement>,
    targetCategory: string,
    position: CategoryDropPosition,
  ) {
    const sourceCategory = cleanCategory(draggedCategory)
    const nextTargetCategory = cleanCategory(targetCategory)

    if (
      !sourceCategory ||
      !nextTargetCategory ||
      sourceCategory === nextTargetCategory ||
      getCategoryParent(sourceCategory) !== getCategoryParent(nextTargetCategory)
    ) {
      return
    }

    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setDropCategory(nextTargetCategory)
    setDropPosition(position)
  }

  function dropCategoryOnCategory(
    event: DragEvent<HTMLDivElement>,
    targetCategory: string,
    position: CategoryDropPosition,
  ) {
    event.preventDefault()

    const sourceCategory = cleanCategory(
      draggedCategory || event.dataTransfer.getData('text/plain'),
    )
    const nextTargetCategory = cleanCategory(targetCategory)

    resetCategoryDragState()

    if (
      !sourceCategory ||
      !nextTargetCategory ||
      sourceCategory === nextTargetCategory
    ) {
      return
    }

    if (getCategoryParent(sourceCategory) !== getCategoryParent(nextTargetCategory)) {
      notify('只能在同级分类之间排序')
      return
    }

    setCategories((currentCategories) => {
      const nextCategories = uniqueCategories([
        ...currentCategories,
        ...cards.map((card) => card.category),
      ])
      const sourceBlock = nextCategories.filter((item) =>
        isCategoryWithin(item, sourceCategory),
      )
      const withoutSourceBlock = nextCategories.filter(
        (item) => !isCategoryWithin(item, sourceCategory),
      )
      const targetIndexes = withoutSourceBlock
        .map((item, index) =>
          isCategoryWithin(item, nextTargetCategory) ? index : -1,
        )
        .filter((index) => index >= 0)

      if (!sourceBlock.length || !targetIndexes.length) {
        return currentCategories
      }

      const insertIndex =
        position === 'before'
          ? targetIndexes[0]
          : targetIndexes[targetIndexes.length - 1] + 1

      return uniqueCategories([
        ...withoutSourceBlock.slice(0, insertIndex),
        ...sourceBlock,
        ...withoutSourceBlock.slice(insertIndex),
      ])
    })
    notify('分类顺序已更新')
  }

  function moveCardsFromManagedCategory() {
    if (!isAdmin || !isEditMode) {
      notify('请先进入 admin 编辑模式')
      return
    }

    const sourceCategory = currentManagedCategory
    const targetCategory = safeMoveTargetCategory

    if (!sourceCategory) {
      notify('全部不是可移动目录')
      return
    }

    if (
      sourceCategory === targetCategory ||
      isCategoryWithin(targetCategory, sourceCategory)
    ) {
      notify('请选择另一个接收目录')
      return
    }

    const movingCount = cards.filter((card) =>
      isCategoryWithin(card.category, sourceCategory),
    ).length

    if (!movingCount) {
      notify('这个目录没有可移动的卡')
      return
    }

    addCategoryPath(targetCategory)
    setCards((currentCards) =>
      currentCards.map((card) =>
        isCategoryWithin(card.category, sourceCategory)
          ? { ...card, category: targetCategory }
          : card,
      ),
    )
    setActiveCategory(targetCategory)
    setManagedCategory(targetCategory)
    notify(`已移动 ${movingCount} 张卡`)
  }

  function openDeleteCategoryDialog() {
    if (!currentManagedCategory) {
      notify('全部不是可删除目录')
      return
    }

    setDeleteMoveTargetCategory(safeDeleteMoveTargetCategory)
    setDeleteCategoryDialogOpen(true)
  }

  function deleteManagedCategory() {
    if (!isAdmin || !isEditMode) {
      notify('请先进入 admin 编辑模式')
      return
    }

    const sourceCategory = currentManagedCategory
    const targetCategory = safeDeleteMoveTargetCategory

    if (!sourceCategory) {
      notify('全部不是可删除目录')
      return
    }

    if (
      sourceCategory === targetCategory ||
      isCategoryWithin(targetCategory, sourceCategory)
    ) {
      notify('请选择另一个接收目录')
      return
    }

    const movingCount = cards.filter((card) =>
      isCategoryWithin(card.category, sourceCategory),
    ).length

    setCategories((currentCategories) =>
      uniqueCategories(
        currentCategories.filter(
          (item) => !isCategoryWithin(item, sourceCategory),
        ),
      ),
    )
    setCards((currentCards) =>
      currentCards.map((card) =>
        isCategoryWithin(card.category, sourceCategory)
          ? { ...card, category: targetCategory }
          : card,
      ),
    )
    resetCategorySelection(sourceCategory, targetCategory)
    setDeleteCategoryDialogOpen(false)
    notify(`已删除分类，移动 ${movingCount} 张卡`)
  }

  async function handlePreviewUpload(
    event: ChangeEvent<HTMLInputElement>,
    setNextImageUrl: (value: string) => void,
    setNextImageAspectRatio: (value: number) => void,
    target: CropTarget,
  ) {
    const input = event.currentTarget
    const file = input.files?.[0]
    input.value = ''

    if (!file) {
      return
    }

    try {
      const { aspectRatio, dataUrl } = await compressImageFile(file)
      setNextImageUrl(dataUrl)
      setNextImageAspectRatio(aspectRatio)
      setCropTarget(target)
      notify('已上传预览图')
    } catch {
      notify('请选择图片文件')
    }
  }

  async function enterAdmin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextAccount = adminAccount.trim()

    if (!nextAccount || !adminPassword) {
      setAdminError('请填写账号和密码')
      return
    }

    try {
      const authStatus = await loginAdmin(nextAccount, adminPassword)
      let nextState = getStatePayload(cards, categories, siteTitle)
      const migratedState = await publishLegacyState(nextState)

      if (migratedState) {
        nextState = getStatePayload(
          migratedState.cards,
          migratedState.categories,
          migratedState.siteTitle,
        )
        setCards(nextState.cards)
        setCategories(nextState.categories)
        setSiteTitle(nextState.siteTitle)
        lastSavedStateRef.current = JSON.stringify(nextState)
        clearLegacyState()
        setLegacyStateAvailable(false)
      }

      setIsAdmin(authStatus.isAdmin)
      setIsEditMode(false)
      setAdminConfigured(authStatus.configured)
      setAdminSetupAllowed(authStatus.setupAllowed)
      setAdminDialogOpen(false)
      setAdminAccount('')
      setAdminPassword('')
      setAdminError('')
      notify(migratedState ? '已恢复本地存档到服务器' : '已进入 admin 浏览模式')
    } catch (error) {
      setAdminError(error instanceof Error ? error.message : '登录失败')
      return
    }
  }

  async function leaveAdmin() {
    try {
      const authStatus = await logoutAdmin()
      setAdminConfigured(authStatus.configured)
      setAdminSetupAllowed(authStatus.setupAllowed)
    } catch {
      // Keep local logout responsive even if the network is unhappy.
    }

    setIsAdmin(false)
    setIsEditMode(false)
    setEditingCard(null)
    notify('已退出 admin')
  }

  async function restoreLegacyStateToServer() {
    if (!isAdmin) {
      notify('请先进入 admin')
      return
    }

    const legacyState = getLegacyState()

    if (!legacyState) {
      setLegacyStateAvailable(false)
      notify('没有可恢复的本地存档')
      return
    }

    try {
      setIsSavingState(true)
      const restoredState = await saveServerState(legacyState)
      const nextState = getStatePayload(
        restoredState.cards,
        restoredState.categories,
        restoredState.siteTitle,
      )
      setCards(nextState.cards)
      setCategories(nextState.categories)
      setSiteTitle(nextState.siteTitle)
      lastSavedStateRef.current = JSON.stringify(nextState)
      clearLegacyState()
      setLegacyStateAvailable(false)
      setStateError('')
      notify('已恢复本地存档到服务器')
    } catch (error) {
      const apiError = error as ApiRequestError

      if (apiError.status === 401) {
        setIsAdmin(false)
        setIsEditMode(false)
        setEditingCard(null)
      }

      setStateError(error instanceof Error ? error.message : '恢复本地存档失败')
      notify('恢复本地存档失败')
    } finally {
      setIsSavingState(false)
    }
  }

  function handleTitleTap() {
    if (isAdmin) {
      return
    }

    titleTapCountRef.current += 1

    if (titleTapTimerRef.current) {
      window.clearTimeout(titleTapTimerRef.current)
    }

    if (titleTapCountRef.current >= 3) {
      titleTapCountRef.current = 0
      setAdminDialogOpen(true)
      return
    }

    titleTapTimerRef.current = window.setTimeout(() => {
      titleTapCountRef.current = 0
    }, 800)
  }

  function openSiteTitleEditor() {
    if (!isAdmin) {
      return
    }

    titleTapCountRef.current = 0
    if (titleTapTimerRef.current) {
      window.clearTimeout(titleTapTimerRef.current)
    }

    setSiteTitleDraft(siteTitle)
    setSiteTitleError('')
    setSiteTitleDialogOpen(true)
  }

  function saveSiteTitle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const nextSiteTitle = siteTitleDraft.trim()

    if (!nextSiteTitle) {
      setSiteTitleError('请填写标题')
      return
    }

    setSiteTitle(nextSiteTitle)
    setSiteTitleDialogOpen(false)
    setSiteTitleError('')
    notify('标题已保存')
  }

  function jumpToCategory(nextCategory: string) {
    const jump = () => {
      const targetCategory =
        categoryPaths.find((item) => item.category === nextCategory)?.category ||
        categoryPaths.find((item) =>
          item.category.startsWith(`${nextCategory}/`),
        )?.category ||
        nextCategory
      const element = document.getElementById(categoryElementId(targetCategory))
      element?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }

    setActiveCategory(nextCategory)
    setManagedCategory(nextCategory)

    if (query.trim()) {
      setQuery('')
      window.setTimeout(jump, 50)
      return
    }

    jump()
  }

  function jumpToRecommended() {
    const jump = () => {
      document
        .getElementById(RECOMMENDED_SECTION_ID)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }

    setActiveCategory(RECOMMENDED_CATEGORY)

    if (query.trim()) {
      setQuery('')
      window.setTimeout(jump, 50)
      return
    }

    jump()
  }

  function jumpToTop() {
    setActiveCategory(DEFAULT_CATEGORY)
    setManagedCategory(DEFAULT_CATEGORY)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function addCards(
    nextCards: ParsedCard[],
    fallbackCategory = DEFAULT_CATEGORY,
  ): AddCardsResult {
    if (!isAdmin || !isEditMode) {
      const message = '请先进入 admin 编辑模式'
      notify(message)
      return { count: 0, message }
    }

    const validCards = nextCards.filter((card) => {
      return card.title.trim() && isDiscordChannelUrl(card.url)
    })

    if (!validCards.length) {
      const message = '没有找到可导入的 Discord 链接'
      notify(message)
      return { count: 0, message }
    }

    const knownUrls = new Set(cards.map((card) => normalizeUrl(card.url)))
    const freshCards = validCards
      .map((card) => toCard(card, fallbackCategory))
      .filter((card) => !knownUrls.has(normalizeUrl(card.url)))

    if (!freshCards.length) {
      const message = '没有新增内容'
      notify(message)
      return { count: 0, message }
    }

    const message = `已导入 ${freshCards.length} 张卡`
    setCategories((currentCategories) =>
      uniqueCategories([
        ...currentCategories,
        ...freshCards.map((card) => card.category),
      ]),
    )
    setCards((currentCards) => [...freshCards, ...currentCards])
    notify(message)
    setActiveCategory(freshCards[0].category)
    return { count: freshCards.length, message }
  }

  function handleAddCard(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const nextTitle = title.trim()
    const nextUrl = normalizeUrl(url)
    const nextCategory = cleanCategory(category)
    setAddFormError('')

    if (!nextTitle) {
      const message = '请填写标题'
      setAddFormError(message)
      notify(message)
      return
    }

    if (!isDiscordChannelUrl(nextUrl)) {
      const message = 'DC 链接必须是 https://discord.com/channels/...'
      setAddFormError(message)
      notify(message)
      return
    }

    const addResult = addCards(
      [
        {
          title: nextTitle,
          url: nextUrl,
          category: nextCategory,
          imageUrl,
          imageHeight,
          cropX,
          cropY,
          cropWidth,
          cropHeight,
          imageAspectRatio,
          recommended,
        },
      ],
      nextCategory,
    )

    if (addResult.count > 0) {
      resetAddForm()
      setAddDialogOpen(false)
      return
    }

    setAddFormError(addResult.message)
  }

  function handleImport() {
    const nextCategory = cleanCategory(importCategory)
    setImportError('')

    const importResult = addCards(
      parseImportText(importText, nextCategory).map((card) => ({
        ...card,
        recommended: importRecommended,
      })),
      nextCategory,
    )

    if (!importResult.count) {
      setImportError(importResult.message)
    }
  }

  async function handleClipboardImport() {
    try {
      const clipboardText = await navigator.clipboard.readText()
      const nextCategory = cleanCategory(importCategory)
      setImportText(clipboardText)
      setImportError('')

      const importResult = addCards(
        parseImportText(clipboardText, nextCategory).map((card) => ({
          ...card,
          recommended: importRecommended,
        })),
        nextCategory,
      )

      if (!importResult.count) {
        setImportError(importResult.message)
      }
    } catch {
      const message = '无法读取剪贴板'
      setImportError(message)
      notify(message)
    }
  }

  async function copyLink(cardUrl: string) {
    try {
      await navigator.clipboard.writeText(cardUrl)
      notify('链接已复制')
    } catch {
      notify('复制失败')
    }
  }

  function openEditor(card: TavernCard) {
    if (!isAdmin || !isEditMode) {
      notify('请先进入 admin 编辑模式')
      return
    }

    setEditingCard(card)
    setEditTitle(card.title)
    setEditUrl(card.url)
    setEditCategory(card.category)
    setEditImageUrl(card.imageUrl)
    setEditImageHeight(card.imageHeight)
    setEditCropX(card.cropX)
    setEditCropY(card.cropY)
    setEditCropWidth(card.cropWidth)
    setEditCropHeight(card.cropHeight)
    setEditImageAspectRatio(card.imageAspectRatio)
    setEditRecommended(card.recommended)
    setEditFormError('')
  }

  function saveEdit() {
    if (!isAdmin || !isEditMode) {
      notify('请先进入 admin 编辑模式')
      return
    }

    const nextTitle = editTitle.trim()
    const nextUrl = normalizeUrl(editUrl)
    const nextCategory = cleanCategory(editCategory)
    setEditFormError('')

    if (!editingCard) {
      return
    }

    if (!nextTitle) {
      const message = '请填写标题'
      setEditFormError(message)
      notify(message)
      return
    }

    if (!isDiscordChannelUrl(nextUrl)) {
      const message = 'DC 链接必须是 https://discord.com/channels/...'
      setEditFormError(message)
      notify(message)
      return
    }

    const editCropRect = sanitizeCropRect({
      height: editCropHeight,
      width: editCropWidth,
      x: editCropX,
      y: editCropY,
    })

    setCards((currentCards) =>
      currentCards.map((card) =>
        card.id === editingCard.id
          ? {
              ...card,
              title: nextTitle,
              url: nextUrl,
              category: nextCategory,
              imageUrl: cleanImageUrl(editImageUrl),
              imageHeight: clampNumber(
                editImageHeight,
                140,
                420,
                DEFAULT_IMAGE_HEIGHT,
              ),
              cropX: editCropRect.x,
              cropY: editCropRect.y,
              cropWidth: editCropRect.width,
              cropHeight: editCropRect.height,
              imageAspectRatio: clampNumber(
                editImageAspectRatio,
                0.2,
                8,
                DEFAULT_IMAGE_ASPECT_RATIO,
              ),
              recommended: editRecommended,
            }
          : card,
      ),
    )
    addCategoryPath(nextCategory)
    setActiveCategory(nextCategory)
    setEditingCard(null)
    notify('已保存')
  }

  function deleteCard(cardId: string) {
    if (!isAdmin || !isEditMode) {
      notify('请先进入 admin 编辑模式')
      return
    }

    setCards((currentCards) => currentCards.filter((card) => card.id !== cardId))
    notify('已删除')
  }

  const cropDialogImageUrl =
    cropTarget === 'card' ? imageUrl : cropTarget === 'edit' ? editImageUrl : ''
  const cropDialogInitialCrop = sanitizeCropRect(
    cropTarget === 'card'
      ? {
          height: cropHeight,
          width: cropWidth,
          x: cropX,
          y: cropY,
        }
      : {
          height: editCropHeight,
          width: editCropWidth,
          x: editCropX,
          y: editCropY,
        },
  )

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-[1500px] flex-col gap-5 px-4 py-4 sm:px-6 lg:px-8">
        <header className="sticky top-0 z-30 -mx-4 border-b border-border bg-background/90 px-4 py-4 backdrop-blur-xl sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
          <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h1 className="text-3xl font-semibold leading-tight sm:text-4xl">
                <button
                  className="rounded-md text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring"
                  title={isAdmin ? '双击编辑标题' : '三击登录 admin'}
                  type="button"
                  onClick={handleTitleTap}
                  onDoubleClick={openSiteTitleEditor}
                >
                  {siteTitle}
                </button>
              </h1>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center lg:w-[780px]">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  aria-label="搜索"
                  className="bg-card/80 pl-9"
                  placeholder="搜索标题、目录或链接"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
              <div className="grid h-11 grid-cols-2 rounded-lg border border-border bg-card/80 p-1 shadow-hairline backdrop-blur-xl">
                <Button
                  aria-label="日间模式"
                  className="h-9 px-3"
                  size="sm"
                  title="日间模式"
                  type="button"
                  variant={theme === 'light' ? 'default' : 'ghost'}
                  onClick={() => setTheme('light')}
                >
                  <Sun />
                </Button>
                <Button
                  aria-label="夜间模式"
                  className="h-9 px-3"
                  size="sm"
                  title="夜间模式"
                  type="button"
                  variant={theme === 'dark' ? 'default' : 'ghost'}
                  onClick={() => setTheme('dark')}
                >
                  <Moon />
                </Button>
              </div>
              {isAdmin ? (
                <div className="flex h-11 shrink-0 items-center gap-1 rounded-lg border border-border bg-card/80 p-1 shadow-hairline backdrop-blur-xl">
                  <span className="hidden px-2 text-xs font-medium text-muted-foreground sm:inline">
                    Admin
                  </span>
                  <Button
                    className="h-9 px-3"
                    size="sm"
                    title={isEditMode ? '浏览模式' : '编辑模式'}
                    type="button"
                    variant={isEditMode ? 'default' : 'ghost'}
                    onClick={() => {
                      setIsEditMode((current) => {
                        const nextMode = !current
                        notify(nextMode ? '已打开编辑模式' : '已回到浏览模式')
                        return nextMode
                      })
                      setEditingCard(null)
                    }}
                  >
                    {isEditMode ? <Eye /> : <Pencil />}
                    {isEditMode ? '浏览' : '编辑'}
                  </Button>
                  <Button
                    aria-label="退出 admin"
                    className="h-9 px-3"
                    size="sm"
                    title="退出 admin"
                    type="button"
                    variant="ghost"
                    onClick={leaveAdmin}
                  >
                    <LogOut />
                  </Button>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        {!stateLoaded || stateError || isSavingState ? (
          <div
            className="rounded-md border border-border bg-card/80 px-3 py-2 text-sm text-muted-foreground shadow-hairline"
            role={stateError ? 'alert' : 'status'}
          >
            {stateError || (isSavingState ? '正在保存服务器存档...' : '正在加载服务器存档...')}
          </div>
        ) : null}

        <section
          className={`grid gap-5 ${
            isEditMode
              ? 'lg:grid-cols-[260px_320px_minmax(0,1fr)]'
              : 'lg:grid-cols-[260px_minmax(0,1fr)]'
          }`}
        >
          <aside className="min-w-0">
            <Card className="sticky top-28 bg-card/80 backdrop-blur-xl">
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="flex items-center gap-2">
                    <PanelLeft className="size-4" />
                    分类目录
                  </CardTitle>
                  {isEditMode ? (
                    <Button
                      aria-label="创建根分类"
                      size="icon"
                      title="创建根分类"
                      type="button"
                      variant="outline"
                      onClick={() => openCategoryCreator('', 'card')}
                    >
                      <Plus />
                    </Button>
                  ) : null}
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                <button
                  className={`flex h-10 w-full items-center justify-between rounded-md px-3 text-left text-sm font-medium transition-colors ${
                    activeCategory === DEFAULT_CATEGORY
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                  }`}
                  type="button"
                  onClick={jumpToTop}
                >
                  <span>{ALL_CATEGORY}</span>
                  <span>{cards.length}</span>
                </button>
                {cards.some((card) => card.recommended) ? (
                  <button
                    className={`flex h-10 w-full items-center justify-between gap-3 rounded-md px-3 text-left text-sm transition-colors ${
                      activeCategory === RECOMMENDED_CATEGORY
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                    }`}
                    type="button"
                    onClick={jumpToRecommended}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <Star className="size-4 shrink-0" />
                      <span className="truncate">推荐</span>
                    </span>
                    <span className="shrink-0">
                      {cards.filter((card) => card.recommended).length}
                    </span>
                  </button>
                ) : null}
                <CategoryTree
                  activeCategory={activeCategory}
                  draggedCategory={draggedCategory}
                  dropCategory={dropCategory}
                  dropPosition={dropPosition}
                  isEditMode={isEditMode}
                  nodes={categoryTree}
                  onCreateChild={(parentCategory) =>
                    openCategoryCreator(parentCategory, 'card')
                  }
                  onDragEnd={resetCategoryDragState}
                  onDragLeave={() => {
                    setDropCategory('')
                    setDropPosition(null)
                  }}
                  onDragOver={hoverCategoryDrop}
                  onDragStart={dragCategory}
                  onDrop={dropCategoryOnCategory}
                  onJump={jumpToCategory}
                  onRename={openRenameCategoryDialog}
                />
              </CardContent>
            </Card>
          </aside>

          {isEditMode ? (
            <div className="flex min-w-0 flex-col gap-5">
              <Card className="bg-card/80 backdrop-blur-xl">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Pencil className="size-4" />
                    管理
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Button
                    className="h-11 w-full justify-start"
                    type="button"
                    onClick={() => setAddDialogOpen(true)}
                  >
                    <Plus />
                    新增链接卡片
                  </Button>
                  <Button
                    className="h-11 w-full justify-start"
                    type="button"
                    variant="outline"
                    onClick={() => openCategoryCreator('', 'card')}
                  >
                    <Folder />
                    创建根分类
                  </Button>
                  {legacyStateAvailable ? (
                    <Button
                      className="h-11 w-full justify-start"
                      type="button"
                      variant="secondary"
                      onClick={restoreLegacyStateToServer}
                    >
                      <RotateCcw />
                      恢复本地存档
                    </Button>
                  ) : null}
                  <div className="space-y-3 rounded-lg border border-border bg-muted/50 p-3">
                    <label className="block space-y-2 text-sm font-medium">
                      <span>当前目录</span>
                      <select
                        className="flex h-10 w-full rounded-md border border-input bg-card/80 px-3 py-2 text-sm text-foreground shadow-hairline transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        value={currentManagedCategory}
                        onChange={(event) => {
                          setManagedCategory(event.target.value)
                          setActiveCategory(event.target.value)
                        }}
                      >
                        <option value={DEFAULT_CATEGORY}>{ALL_CATEGORY}</option>
                        {categoryOptions.map((categoryName) => (
                          <option key={categoryName} value={categoryName}>
                            {formatCategoryLabel(categoryName)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() =>
                          openSiblingCategoryCreator(
                            currentManagedCategory,
                            'manage',
                          )
                        }
                      >
                        <Plus />
                        同级
                      </Button>
                      <Button
                        disabled={!currentManagedCategory}
                        type="button"
                        variant="outline"
                        onClick={() =>
                          openRenameCategoryDialog(currentManagedCategory)
                        }
                      >
                        <Pencil />
                        改名
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() =>
                          openCategoryCreator(currentManagedCategory, 'manage')
                        }
                      >
                        <Plus />
                        子级
                      </Button>
                    </div>
                    <label className="block space-y-2 text-sm font-medium">
                      <span>接收目录</span>
                      <select
                        className="flex h-10 w-full rounded-md border border-input bg-card/80 px-3 py-2 text-sm text-foreground shadow-hairline transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        disabled={!moveTargetOptions.length}
                        value={
                          moveTargetOptions.length
                            ? safeMoveTargetCategory
                            : ''
                        }
                        onChange={(event) =>
                          setMoveTargetCategory(event.target.value)
                        }
                      >
                        {moveTargetOptions.length ? (
                          moveTargetOptions.map((categoryName) => (
                            <option key={categoryName} value={categoryName}>
                              {formatCategoryLabel(categoryName)}
                            </option>
                          ))
                        ) : (
                          <option value="">无可用目录</option>
                        )}
                      </select>
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        disabled={!moveTargetOptions.length}
                        type="button"
                        variant="secondary"
                        onClick={moveCardsFromManagedCategory}
                      >
                        <Folder />
                        移动卡
                      </Button>
                      <Button
                        disabled={!currentManagedCategory}
                        type="button"
                        variant="outline"
                        onClick={openDeleteCategoryDialog}
                      >
                        <Trash2 />
                        删除
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>

            <Card className="bg-card/80 backdrop-blur-xl">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Import className="size-4" />
                  批量导入
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <CategorySelectControl
                  categories={categoryPaths.map((item) => item.category)}
                  label="导入分类路径"
                  value={importCategory}
                  onChange={setImportCategory}
                  onCreate={() =>
                    openSiblingCategoryCreator(importCategory, 'import')
                  }
                />
                <label className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/60 px-3 py-2 text-sm font-medium">
                  <span>导入为推荐</span>
                  <input
                    checked={importRecommended}
                    className="size-4 accent-neutral-900 dark:accent-neutral-100"
                    type="checkbox"
                    onChange={(event) => setImportRecommended(event.target.checked)}
                  />
                </label>
                <Textarea
                  className="min-h-44"
                  placeholder="标题换行后放 Discord 链接"
                  value={importText}
                  onChange={(event) => {
                    setImportText(event.target.value)
                    setImportError('')
                  }}
                />
                {importError ? (
                  <p
                    className="rounded-md border border-border bg-muted/60 px-3 py-2 text-sm text-muted-foreground"
                    role="alert"
                  >
                    {importError}
                  </p>
                ) : null}
                <div className="grid gap-2 sm:grid-cols-2">
                  <Button type="button" onClick={handleImport}>
                    <Import />
                    导入文本
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={handleClipboardImport}
                  >
                    <ClipboardPaste />
                    读剪贴板
                  </Button>
                </div>
              </CardContent>
            </Card>

            </div>
          ) : null}

          <section className="min-w-0">
            <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-border bg-card/80 px-4 py-3 shadow-hairline backdrop-blur-xl">
              <div className="min-w-0">
                <h2 className="text-base font-semibold leading-6">展示区</h2>
                <p className="text-sm text-muted-foreground">
                  {filteredCards.length} 张卡正在显示
                  {isAdmin ? `, admin ${isEditMode ? '编辑模式' : '浏览模式'}` : ''}
                </p>
                {notice ? (
                  <p className="mt-1 text-xs text-muted-foreground" role="status">
                    {notice}
                  </p>
                ) : null}
              </div>
              <Button type="button" variant="outline" onClick={jumpToTop}>
                回到顶部
              </Button>
            </div>

            {groupedCards.length ? (
              <div className="space-y-7">
                {recommendedCards.length ? (
                  <section
                    id={RECOMMENDED_SECTION_ID}
                    className="scroll-mt-28"
                  >
                    <div className="mb-3 flex items-center justify-between gap-3 border-b border-border pb-2">
                      <h2 className="flex min-w-0 items-center gap-2 text-lg font-semibold">
                        <Star className="size-4 shrink-0 text-muted-foreground" />
                        <span className="truncate">推荐</span>
                      </h2>
                      <span className="rounded-md border border-border bg-card/80 px-2.5 py-1 text-xs font-medium text-muted-foreground shadow-hairline">
                        {recommendedCards.length} 张
                      </span>
                    </div>
                    <div className="card-grid">
                      {recommendedCards.map((card) => (
                        <TavernCardItem
                          card={card}
                          isEditMode={isEditMode}
                          key={`recommended-${card.id}`}
                          onCopyLink={copyLink}
                          onDeleteCard={deleteCard}
                          onOpenEditor={openEditor}
                        />
                      ))}
                    </div>
                  </section>
                ) : null}
                {groupedCards.map(([categoryName, group]) => (
                  <section
                    id={categoryElementId(categoryName)}
                    key={categoryName}
                    className="scroll-mt-28"
                  >
                    <div className="mb-3 flex items-center justify-between gap-3 border-b border-border pb-2">
                      <h2 className="flex min-w-0 items-center gap-2 text-lg font-semibold">
                        <Folder className="size-4 shrink-0 text-muted-foreground" />
                        <span className="truncate">{categoryName}</span>
                      </h2>
                      <span className="rounded-md border border-border bg-card/80 px-2.5 py-1 text-xs font-medium text-muted-foreground shadow-hairline">
                        {group.length} 张
                      </span>
                    </div>

                    <div className="card-grid">
                      {group.map((card) => (
                        <TavernCardItem
                          card={card}
                          isEditMode={isEditMode}
                          key={card.id}
                          onCopyLink={copyLink}
                          onDeleteCard={deleteCard}
                          onOpenEditor={openEditor}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            ) : (
              <Card className="flex min-h-72 items-center justify-center bg-card/80 backdrop-blur-xl">
                <CardContent className="pt-5 text-center text-sm text-muted-foreground">
                  没有匹配的卡片
                </CardContent>
              </Card>
            )}
          </section>
        </section>
      </div>

      <Dialog
        open={adminDialogOpen}
        onOpenChange={(open) => {
          setAdminDialogOpen(open)
          if (!open) {
            setAdminAccount('')
            setAdminPassword('')
            setAdminError('')
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {adminConfigured || !adminSetupAllowed ? 'Admin' : '设置 Admin'}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {adminConfigured
                ? '服务端 Admin 会话登录'
                : '创建服务端 Admin 账号'}
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={enterAdmin}>
            {!adminConfigured && !adminSetupAllowed ? (
              <p
                className="rounded-md border border-border bg-muted/60 px-3 py-2 text-sm text-muted-foreground"
                role="alert"
              >
                服务端还没有配置 ADMIN_ACCOUNT / ADMIN_PASSWORD。
              </p>
            ) : null}
            <label className="block space-y-2 text-sm font-medium">
              <span>账号</span>
              <Input
                autoFocus
                value={adminAccount}
                onChange={(event) => {
                  setAdminAccount(event.target.value)
                  setAdminError('')
                }}
              />
            </label>
            <label className="block space-y-2 text-sm font-medium">
              <span>密码</span>
              <Input
                type="password"
                value={adminPassword}
                onChange={(event) => {
                  setAdminPassword(event.target.value)
                  setAdminError('')
                }}
              />
            </label>
            {adminError ? (
              <p className="text-sm text-muted-foreground" role="alert">
                {adminError}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setAdminDialogOpen(false)}
              >
                取消
              </Button>
              <Button type="submit">
                <Lock />
                {adminConfigured || !adminSetupAllowed ? '进入' : '创建'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={siteTitleDialogOpen && isAdmin}
        onOpenChange={(open) => {
          setSiteTitleDialogOpen(open)
          if (!open) {
            setSiteTitleDraft('')
            setSiteTitleError('')
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑标题</DialogTitle>
            <DialogDescription className="sr-only">
              修改左上角展示标题
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={saveSiteTitle}>
            <label className="block space-y-2 text-sm font-medium">
              <span>标题</span>
              <Input
                autoFocus
                value={siteTitleDraft}
                onChange={(event) => {
                  setSiteTitleDraft(event.target.value)
                  setSiteTitleError('')
                }}
              />
            </label>
            {siteTitleError ? (
              <p
                className="rounded-md border border-border bg-muted/60 px-3 py-2 text-sm text-muted-foreground"
                role="alert"
              >
                {siteTitleError}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setSiteTitleDialogOpen(false)}
              >
                取消
              </Button>
              <Button type="submit">
                <Check />
                保存
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={categoryDialogOpen}
        onOpenChange={(open) => {
          setCategoryDialogOpen(open)
          if (!open) {
            setCategoryDraft('')
            setCategoryParent('')
            setCategoryTarget('none')
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>创建分类</DialogTitle>
            <DialogDescription className="sr-only">
              创建新的分类路径
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={saveCategory}>
            <div className="rounded-md border border-border bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
              创建位置 {categoryParent ? categoryParent : '根目录'}
            </div>
            <label className="block space-y-2 text-sm font-medium">
              <span>分类名称</span>
              <Input
                autoFocus
                value={categoryDraft}
                onChange={(event) => setCategoryDraft(event.target.value)}
              />
            </label>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setCategoryDialogOpen(false)}
              >
                取消
              </Button>
              <Button type="submit">
                <Plus />
                创建
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={renameCategoryDialogOpen && isAdmin && isEditMode}
        onOpenChange={(open) => {
          setRenameCategoryDialogOpen(open)
          if (!open) {
            setRenamingCategory('')
            setRenameCategoryDraft('')
            setRenameCategoryError('')
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重命名分类</DialogTitle>
            <DialogDescription>
              修改 {renamingCategory} 及其子分类路径。
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={saveRenamedCategory}>
            <label className="block space-y-2 text-sm font-medium">
              <span>分类名称</span>
              <Input
                autoFocus
                value={renameCategoryDraft}
                onChange={(event) => {
                  setRenameCategoryDraft(event.target.value)
                  setRenameCategoryError('')
                }}
              />
            </label>
            {renameCategoryError ? (
              <p
                className="rounded-md border border-border bg-muted/60 px-3 py-2 text-sm text-muted-foreground"
                role="alert"
              >
                {renameCategoryError}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setRenameCategoryDialogOpen(false)}
              >
                取消
              </Button>
              <Button type="submit">
                <Check />
                保存
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteCategoryDialogOpen && isAdmin && isEditMode}
        onOpenChange={setDeleteCategoryDialogOpen}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除分类</DialogTitle>
            <DialogDescription>
              删除 {currentManagedCategory}，其中的卡会移动到接收目录。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <label className="block space-y-2 text-sm font-medium">
              <span>接收目录</span>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-card/80 px-3 py-2 text-sm text-foreground shadow-hairline transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                disabled={!deleteTargetOptions.length}
                value={
                  deleteTargetOptions.length
                    ? safeDeleteMoveTargetCategory
                    : ''
                }
                onChange={(event) =>
                  setDeleteMoveTargetCategory(event.target.value)
                }
              >
                {deleteTargetOptions.length ? (
                  deleteTargetOptions.map((categoryName) => (
                    <option key={categoryName} value={categoryName}>
                      {formatCategoryLabel(categoryName)}
                    </option>
                  ))
                ) : (
                  <option value="">无可用目录</option>
                )}
              </select>
            </label>
            <div className="rounded-md border border-border bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
              将移动{' '}
              {
                cards.filter((card) =>
                  isCategoryWithin(card.category, currentManagedCategory),
                ).length
              }{' '}
              张卡
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setDeleteCategoryDialogOpen(false)}
              >
                取消
              </Button>
              <Button
                disabled={
                  !currentManagedCategory || !deleteTargetOptions.length
                }
                type="button"
                onClick={deleteManagedCategory}
              >
                <Trash2 />
                删除
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={addDialogOpen && isAdmin && isEditMode}
        onOpenChange={(open) => {
          setAddDialogOpen(open)
          if (!open) {
            setAddFormError('')
          }
          if (!open && cropTarget === 'card') {
            setCropTarget(null)
          }
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>新增链接卡片</DialogTitle>
            <DialogDescription className="sr-only">
              添加卡片标题、分类、预览图和 Discord 链接
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleAddCard}>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block space-y-2 text-sm font-medium">
                <span>标题</span>
                <Input
                  autoFocus
                  placeholder="卡片标题"
                  value={title}
                  onChange={(event) => {
                    setTitle(event.target.value)
                    setAddFormError('')
                  }}
                />
              </label>
              <CategorySelectControl
                categories={categoryPaths.map((item) => item.category)}
                label="分类路径"
                value={category}
                onChange={setCategory}
                onCreate={() => openSiblingCategoryCreator(category, 'card')}
              />
            </div>

            <label className="block space-y-2 text-sm font-medium">
              <span>DC 链接</span>
              <Input
                placeholder="https://discord.com/channels/..."
                value={url}
                onChange={(event) => {
                  setUrl(event.target.value)
                  setAddFormError('')
                }}
              />
            </label>
            {addFormError ? (
              <p
                className="rounded-md border border-border bg-muted/60 px-3 py-2 text-sm text-muted-foreground"
                role="alert"
              >
                {addFormError}
              </p>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_190px]">
              <div className="space-y-3">
                <label className="block space-y-2 text-sm font-medium">
                  <span>预览图链接</span>
                  <Input
                    placeholder="https://..."
                    value={imageUrl}
                    onChange={(event) => {
                      setImageUrl(event.target.value)
                      setCropX(DEFAULT_CROP)
                      setCropY(DEFAULT_CROP)
                      setCropWidth(DEFAULT_CROP_SIZE)
                      setCropHeight(DEFAULT_CROP_SIZE)
                      setImageAspectRatio(DEFAULT_IMAGE_ASPECT_RATIO)
                    }}
                  />
                </label>
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md border border-border bg-card/80 px-3 text-sm font-medium shadow-hairline transition-colors hover:bg-accent hover:text-accent-foreground">
                    <Upload className="size-4 shrink-0" />
                    <span className="truncate">上传图片</span>
                    <input
                      accept="image/*"
                      className="sr-only"
                      type="file"
                      onChange={(event) =>
                        handlePreviewUpload(
                          event,
                          setImageUrl,
                          setImageAspectRatio,
                          'card',
                        )
                      }
                    />
                  </label>
                  <Button
                    disabled={!imageUrl}
                    type="button"
                    variant="outline"
                    onClick={() => openCropEditor('card')}
                  >
                    <CropIcon />
                    裁剪图片
                  </Button>
                </div>
                {imageUrl ? (
                  <Button
                    className="w-full"
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      setImageUrl('')
                      setCropX(DEFAULT_CROP)
                      setCropY(DEFAULT_CROP)
                      setCropWidth(DEFAULT_CROP_SIZE)
                      setCropHeight(DEFAULT_CROP_SIZE)
                      setImageAspectRatio(DEFAULT_IMAGE_ASPECT_RATIO)
                    }}
                  >
                    清除预览图
                  </Button>
                ) : null}
              </div>
              <CroppedImage
                className="rounded-md border border-border"
                cropHeight={cropHeight}
                cropWidth={cropWidth}
                cropX={cropX}
                cropY={cropY}
                imageAspectRatio={imageAspectRatio}
                imageUrl={imageUrl}
              />
            </div>

            <label className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/60 px-3 py-2 text-sm font-medium">
              <span>推荐</span>
              <input
                checked={recommended}
                className="size-4 accent-neutral-900 dark:accent-neutral-100"
                type="checkbox"
                onChange={(event) => setRecommended(event.target.checked)}
              />
            </label>

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setAddDialogOpen(false)}
              >
                取消
              </Button>
              <Button type="submit">
                <Plus />
                添加
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(editingCard && isAdmin && isEditMode)}
        onOpenChange={(open) => {
          if (!open) {
            setEditingCard(null)
            setEditFormError('')
          }
        }}
      >
        {editingCard ? (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>编辑卡片</DialogTitle>
              <DialogDescription className="sr-only">
                修改当前卡片标题、分类和 Discord 链接
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <label className="block space-y-2 text-sm font-medium">
                <span>标题</span>
                <Input
                  value={editTitle}
                  onChange={(event) => {
                    setEditTitle(event.target.value)
                    setEditFormError('')
                  }}
                />
              </label>
              <CategorySelectControl
                categories={categoryPaths.map((item) => item.category)}
                label="分类路径"
                value={editCategory}
                onChange={setEditCategory}
                onCreate={() =>
                  openSiblingCategoryCreator(editCategory, 'edit')
                }
              />
              <label className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/60 px-3 py-2 text-sm font-medium">
                <span>推荐</span>
                <input
                  checked={editRecommended}
                  className="size-4 accent-neutral-900 dark:accent-neutral-100"
                  type="checkbox"
                  onChange={(event) => setEditRecommended(event.target.checked)}
                />
              </label>
              <label className="block space-y-2 text-sm font-medium">
                <span>DC 链接</span>
                <Input
                  value={editUrl}
                  onChange={(event) => {
                    setEditUrl(event.target.value)
                    setEditFormError('')
                  }}
                />
              </label>
              {editFormError ? (
                <p
                  className="rounded-md border border-border bg-muted/60 px-3 py-2 text-sm text-muted-foreground"
                  role="alert"
                >
                  {editFormError}
                </p>
              ) : null}
              <label className="block space-y-2 text-sm font-medium">
                <span>预览图链接</span>
                <Input
                  value={editImageUrl}
                  onChange={(event) => {
                    setEditImageUrl(event.target.value)
                    setEditCropX(DEFAULT_CROP)
                    setEditCropY(DEFAULT_CROP)
                    setEditCropWidth(DEFAULT_CROP_SIZE)
                    setEditCropHeight(DEFAULT_CROP_SIZE)
                    setEditImageAspectRatio(DEFAULT_IMAGE_ASPECT_RATIO)
                  }}
                />
              </label>
              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_190px]">
                <div className="space-y-2">
                  <label className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md border border-border bg-card/80 px-3 text-sm font-medium shadow-hairline transition-colors hover:bg-accent hover:text-accent-foreground">
                    <Upload className="size-4 shrink-0" />
                    <span className="truncate">上传图片</span>
                    <input
                      accept="image/*"
                      className="sr-only"
                      type="file"
                      onChange={(event) =>
                        handlePreviewUpload(
                          event,
                          setEditImageUrl,
                          setEditImageAspectRatio,
                          'edit',
                        )
                      }
                    />
                  </label>
                  <Button
                    className="w-full"
                    disabled={!editImageUrl}
                    type="button"
                    variant="outline"
                    onClick={() => openCropEditor('edit')}
                  >
                    <CropIcon />
                    裁剪图片
                  </Button>
                  {editImageUrl ? (
                    <Button
                      className="w-full"
                      type="button"
                      variant="secondary"
                      onClick={() => {
                        setEditImageUrl('')
                        setEditCropX(DEFAULT_CROP)
                        setEditCropY(DEFAULT_CROP)
                        setEditCropWidth(DEFAULT_CROP_SIZE)
                        setEditCropHeight(DEFAULT_CROP_SIZE)
                        setEditImageAspectRatio(DEFAULT_IMAGE_ASPECT_RATIO)
                      }}
                    >
                      清除预览图
                    </Button>
                  ) : null}
                </div>
                <CroppedImage
                  className="rounded-md border border-border"
                  cropHeight={editCropHeight}
                  cropWidth={editCropWidth}
                  cropX={editCropX}
                  cropY={editCropY}
                  imageAspectRatio={editImageAspectRatio}
                  imageUrl={editImageUrl}
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setEditingCard(null)}
                >
                  取消
                </Button>
                <Button type="button" onClick={saveEdit}>
                  <Check />
                  保存
                </Button>
              </div>
            </div>
          </DialogContent>
        ) : null}
      </Dialog>

      <ImageCropDialog
        imageUrl={cropDialogImageUrl}
        initialCrop={cropDialogInitialCrop}
        key={`${cropTarget || 'none'}-${cropDialogImageUrl ? 'image' : 'empty'}-${cropDialogInitialCrop.x}-${cropDialogInitialCrop.y}-${cropDialogInitialCrop.width}-${cropDialogInitialCrop.height}`}
        open={Boolean(cropTarget && isAdmin && isEditMode)}
        title="裁剪预览图"
        onOpenChange={(open) => {
          if (!open) {
            setCropTarget(null)
          }
        }}
        onSave={saveCropResult}
      />
    </main>
  )
}

export default App
