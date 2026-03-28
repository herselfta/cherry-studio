import * as crypto from 'crypto'
import * as fs from 'fs/promises'
import * as path from 'path'
import sharp from 'sharp'

type Variant = 'dark' | 'light'
type SourceKind = 'apps' | 'models' | 'providers'

type SourceEntry = {
  light?: string
  dark?: string
}

type TargetOverride = {
  kind: SourceKind
  baseName: string
}

const DESKTOP_ROOT = path.resolve(__dirname, '..')
const DEFAULT_APP_ROOT = path.resolve(DESKTOP_ROOT, '../cherry-studio-app')

const SOURCE_DIRECTORIES: Record<SourceKind, string> = {
  apps: path.join(DESKTOP_ROOT, 'src/renderer/src/assets/images/apps'),
  models: path.join(DESKTOP_ROOT, 'src/renderer/src/assets/images/models'),
  providers: path.join(DESKTOP_ROOT, 'src/renderer/src/assets/images/providers')
}

const TARGET_DIRECTORIES: Record<Variant, string> = {
  dark: path.join(DEFAULT_APP_ROOT, 'src/assets/images/llmIcons/dark'),
  light: path.join(DEFAULT_APP_ROOT, 'src/assets/images/llmIcons/light')
}

const SOURCE_EXTENSION_PRIORITY = ['.png', '.webp', '.jpeg', '.jpg', '.svg']
const SVG_DENSITY = 384

const TARGET_NAME_ALIASES: Record<string, string[]> = {
  azure: ['microsoft'],
  baai: ['bge'],
  baidu: ['baidu-cloud'],
  bedrock: ['aws-bedrock'],
  dmxapi: ['DMXAPI'],
  commanda: ['cohere'],
  giteeai: ['gitee-ai'],
  githubcopilot: ['copilot'],
  meta: ['llama'],
  ovms: ['intel'],
  stepfun: ['step'],
  tencentcloud: ['tencent-cloud-ti'],
  vercel: ['vercel'],
  voyage: ['voyageai'],
  zhinao: ['360']
}

const TARGETS_THAT_PREFER_PROVIDER = new Set([
  '302ai',
  'aihubmix',
  'alayanew',
  'anthropic',
  'azure',
  'baidu',
  'bedrock',
  'burncloud',
  'bytedance',
  'cephalon',
  'cerebras',
  'cherryin',
  'dashscope',
  'dmxapi',
  'fireworks',
  'giteeai',
  'github',
  'githubcopilot',
  'google',
  'gpustack',
  'grok',
  'groq',
  'hyperbolic',
  'infini',
  'jina',
  'lanyun',
  'lmstudio',
  'longcat',
  'moonshot',
  'newapi',
  'nvidia',
  'o3',
  'ocoolai',
  'ollama',
  'openai',
  'openrouter',
  'ovms',
  'perplexity',
  'ph8',
  'poe',
  'ppio',
  'qiniu',
  'silicon',
  'sophnet',
  'stepfun',
  'tencentcloud',
  'together',
  'tokenflux',
  'vercel',
  'vertexai',
  'voyage',
  'xirang',
  'yi',
  'zhinao',
  'zhipu'
])

function parseAppRootArg(): string {
  const cliAppRootIndex = process.argv.indexOf('--app-root')
  if (cliAppRootIndex >= 0) {
    const cliValue = process.argv[cliAppRootIndex + 1]
    if (!cliValue) {
      throw new Error('Missing value for --app-root')
    }
    return path.resolve(cliValue)
  }

  return process.env.CHERRY_APP_ROOT ? path.resolve(process.env.CHERRY_APP_ROOT) : DEFAULT_APP_ROOT
}

function normalizeBaseName(fileName: string): { baseName: string; variant: Variant | 'shared'; ext: string } {
  const ext = path.extname(fileName)
  const rawBaseName = path.basename(fileName, ext)

  if (rawBaseName.endsWith('_dark')) {
    return {
      baseName: rawBaseName.slice(0, -'_dark'.length),
      variant: 'dark',
      ext
    }
  }

  return {
    baseName: rawBaseName,
    variant: 'shared',
    ext
  }
}

async function buildSourceIndex(sourceDirectory: string): Promise<Map<string, SourceEntry>> {
  const files = await fs.readdir(sourceDirectory)
  const index = new Map<string, SourceEntry>()

  const sortedFiles = files
    .filter((fileName) => SOURCE_EXTENSION_PRIORITY.includes(path.extname(fileName)))
    .sort((left, right) => {
      const leftPriority = SOURCE_EXTENSION_PRIORITY.indexOf(path.extname(left))
      const rightPriority = SOURCE_EXTENSION_PRIORITY.indexOf(path.extname(right))
      return leftPriority - rightPriority
    })

  for (const fileName of sortedFiles) {
    const { baseName, variant } = normalizeBaseName(fileName)
    const nextPath = path.join(sourceDirectory, fileName)
    const currentEntry = index.get(baseName) ?? {}

    if (variant === 'dark') {
      currentEntry.dark ??= nextPath
    } else {
      currentEntry.light ??= nextPath
    }

    index.set(baseName, currentEntry)
  }

  return index
}

async function hashFile(filePath: string): Promise<string> {
  const fileBuffer = await fs.readFile(filePath)
  return crypto.createHash('sha1').update(fileBuffer).digest('hex')
}

async function buildConflictingTargetOverrides(
  indices: Record<SourceKind, Map<string, SourceEntry>>
): Promise<Record<Variant, Record<string, TargetOverride>>> {
  const overrides: Record<Variant, Record<string, TargetOverride>> = {
    dark: {},
    light: {}
  }

  const sharedBaseNames = [...indices.models.keys()].filter((baseName) => indices.providers.has(baseName)).sort()

  for (const baseName of sharedBaseNames) {
    const modelEntry = indices.models.get(baseName)
    const providerEntry = indices.providers.get(baseName)

    if (!modelEntry || !providerEntry) {
      continue
    }

    const modelPaths = [modelEntry.light, modelEntry.dark].filter(Boolean) as string[]
    const providerPaths = [providerEntry.light, providerEntry.dark].filter(Boolean) as string[]

    if (modelPaths.length === 0 || providerPaths.length === 0) {
      continue
    }

    const modelHashes = new Set(await Promise.all(modelPaths.map(hashFile)))
    const providerHashes = new Set(await Promise.all(providerPaths.map(hashFile)))
    const hasSharedAsset = [...modelHashes].some((hash) => providerHashes.has(hash))

    if (hasSharedAsset) {
      continue
    }

    for (const variant of ['dark', 'light'] as const) {
      overrides[variant][`${baseName}-model.png`] = {
        kind: 'models',
        baseName
      }
      overrides[variant][`${baseName}-provider.png`] = {
        kind: 'providers',
        baseName
      }
    }
  }

  return overrides
}

function buildCandidateNames(targetBaseName: string): string[] {
  return [targetBaseName, ...(TARGET_NAME_ALIASES[targetBaseName] ?? [])]
}

function resolveSourceForTarget(
  targetBaseName: string,
  variant: Variant,
  indices: Record<SourceKind, Map<string, SourceEntry>>
): string | undefined {
  const preferredKinds: SourceKind[] = TARGETS_THAT_PREFER_PROVIDER.has(targetBaseName)
    ? ['providers', 'models', 'apps']
    : ['models', 'providers', 'apps']

  for (const candidateBaseName of buildCandidateNames(targetBaseName)) {
    for (const kind of preferredKinds) {
      const entry = indices[kind].get(candidateBaseName)
      const exactVariantPath = variant === 'dark' ? entry?.dark : entry?.light

      if (exactVariantPath) {
        return exactVariantPath
      }
    }

    for (const kind of preferredKinds) {
      const entry = indices[kind].get(candidateBaseName)
      if (entry?.light) {
        return entry.light
      }
      if (entry?.dark) {
        return entry.dark
      }
    }
  }

  return undefined
}

function resolveOverriddenSource(
  targetFileName: string,
  variant: Variant,
  indices: Record<SourceKind, Map<string, SourceEntry>>,
  targetOverrides: Record<Variant, Record<string, TargetOverride>>
): string | undefined {
  const override = targetOverrides[variant][targetFileName]
  if (!override) {
    return undefined
  }

  const entry = indices[override.kind].get(override.baseName)
  if (!entry) {
    return undefined
  }

  const exactVariantPath = variant === 'dark' ? entry.dark : entry.light
  return exactVariantPath ?? entry.light ?? entry.dark
}

async function syncTargetFile(sourcePath: string, targetPath: string): Promise<void> {
  const targetExt = path.extname(targetPath).toLowerCase()
  const sourceExt = path.extname(sourcePath).toLowerCase()
  const density = sourceExt === '.svg' ? SVG_DENSITY : undefined

  const transformer = sharp(sourcePath, density ? { density } : undefined)

  if (targetExt === '.webp') {
    await transformer.webp({ quality: 100 }).toFile(targetPath)
    return
  }

  await transformer.png().toFile(targetPath)
}

async function ensureDirectory(directoryPath: string): Promise<void> {
  await fs.mkdir(directoryPath, { recursive: true })
}

async function syncVariant(
  variant: Variant,
  appRoot: string,
  indices: Record<SourceKind, Map<string, SourceEntry>>,
  targetOverrides: Record<Variant, Record<string, TargetOverride>>
): Promise<{ synced: string[]; skipped: string[] }> {
  const targetDirectory = path.join(appRoot, `src/assets/images/llmIcons/${variant}`)
  await ensureDirectory(targetDirectory)

  const targetFiles = (await fs.readdir(targetDirectory))
    .filter((fileName) => ['.png', '.webp'].includes(path.extname(fileName).toLowerCase()))
    .concat(Object.keys(targetOverrides[variant]))

  const uniqueTargetFiles = [...new Set(targetFiles)].sort()

  const synced: string[] = []
  const skipped: string[] = []

  for (const targetFileName of uniqueTargetFiles) {
    const targetBaseName = path.basename(targetFileName, path.extname(targetFileName))
    const sourcePath =
      resolveOverriddenSource(targetFileName, variant, indices, targetOverrides) ??
      resolveSourceForTarget(targetBaseName, variant, indices)

    if (!sourcePath) {
      skipped.push(targetFileName)
      continue
    }

    const targetPath = path.join(targetDirectory, targetFileName)
    await syncTargetFile(sourcePath, targetPath)
    synced.push(targetFileName)
  }

  return { synced, skipped }
}

async function main(): Promise<void> {
  const appRoot = parseAppRootArg()
  const indices = {
    apps: await buildSourceIndex(SOURCE_DIRECTORIES.apps),
    models: await buildSourceIndex(SOURCE_DIRECTORIES.models),
    providers: await buildSourceIndex(SOURCE_DIRECTORIES.providers)
  }
  const targetOverrides = await buildConflictingTargetOverrides(indices)

  const darkResult = await syncVariant('dark', appRoot, indices, targetOverrides)
  const lightResult = await syncVariant('light', appRoot, indices, targetOverrides)
  const skipped = [...new Set([...darkResult.skipped, ...lightResult.skipped])].sort()

  console.log(`Synced ${darkResult.synced.length} dark icon(s) and ${lightResult.synced.length} light icon(s) to:`)
  console.log(`  ${path.join(appRoot, 'src/assets/images/llmIcons')}`)

  if (skipped.length > 0) {
    console.warn('Skipped app-only icon targets without a desktop source:')
    for (const fileName of skipped) {
      console.warn(`  - ${fileName}`)
    }
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
