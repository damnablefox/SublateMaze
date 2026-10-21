import type { Context } from '@deepseek-ai/cordis'

export const name = 'ai-provider'
export const inject: string[] = []

export type AiCallKind = 'chat' | 'embedding'
export type AiCallStatus = 'ok' | 'error' | 'cancelled'

export interface AiCallRecord {
  provider: string
  kind: AiCallKind
  model: string
  status: AiCallStatus
  promptTokens?: number
  completionTokens?: number
  durationMs?: number
  error?: string
}

export interface AiStats {
  calls: number
  promptTokens: number
  completionTokens: number
  byKind: Record<AiCallKind, number>
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatRequest {
  messages: ChatMessage[]
  model?: string
  temperature?: number
  maxTokens?: number
  /** 请求 JSON 输出（response_format=json_object）。 */
  json?: boolean
}

export interface AiUsage {
  promptTokens: number
  completionTokens: number
}

export interface ChatResult {
  text: string
  model: string
  usage: AiUsage
}

export interface EmbeddingRequest {
  input: string[]
  model?: string
}

export interface EmbeddingResult {
  vectors: number[][]
  model: string
  usage: AiUsage
}

export interface AiCallOptions {
  signal?: AbortSignal
}

export interface AiProviderConfig {
  provider?: string
  baseUrl?: string
  apiKey?: string
  chatModel?: string
  embeddingModel?: string
  embeddingDim?: number
  timeoutMs?: number
  maxRetries?: number
  /** 重试退避基数，测试可调小。 */
  retryBaseMs?: number
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

interface AiCallSink {
  record(call: AiCallRecord): void
  stats(options?: { since?: string }): AiStats
}

interface DbLike {
  aiCalls: AiCallSink
}

export interface AiServiceDeps extends ResolvedConfig {
  calls: AiCallSink
  fetchImpl?: FetchLike
  sleep?: (ms: number) => Promise<void>
}

export interface ResolvedConfig {
  provider: string
  baseUrl: string
  apiKey: string
  chatModel: string
  embeddingModel?: string
  embeddingDim: number
  timeoutMs: number
  maxRetries: number
  retryBaseMs: number
}

export class AiRequestError extends Error {
  readonly status?: number
  readonly cancelled: boolean

  constructor(message: string, status?: number, cancelled = false) {
    super(message)
    this.name = 'AiRequestError'
    this.status = status
    this.cancelled = cancelled
  }
}

function numberFromEnv(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

/** 环境变量优先于 profile 配置，便于本地临时覆盖。 */
export function resolveConfig(
  config: AiProviderConfig = {},
  env: NodeJS.ProcessEnv = process.env,
): ResolvedConfig {
  const embeddingModel =
    config.embeddingModel ?? env.SUBLATE_AI_EMBEDDING_MODEL ?? undefined

  return {
    provider: config.provider ?? env.SUBLATE_AI_PROVIDER ?? 'deepseek',
    baseUrl: (config.baseUrl ?? env.SUBLATE_AI_BASE_URL ?? 'https://api.deepseek.com').replace(
      /\/+$/,
      '',
    ),
    apiKey: config.apiKey ?? env.SUBLATE_AI_API_KEY ?? env.DEEPSEEK_API_KEY ?? '',
    chatModel: config.chatModel ?? env.SUBLATE_AI_CHAT_MODEL ?? 'deepseek-chat',
    embeddingModel: embeddingModel ? embeddingModel : undefined,
    embeddingDim:
      config.embeddingDim ?? numberFromEnv(env.SUBLATE_AI_EMBEDDING_DIM) ?? 1024,
    timeoutMs: config.timeoutMs ?? numberFromEnv(env.SUBLATE_AI_TIMEOUT_MS) ?? 60_000,
    maxRetries: config.maxRetries ?? numberFromEnv(env.SUBLATE_AI_MAX_RETRIES) ?? 2,
    retryBaseMs: config.retryBaseMs ?? 300,
  }
}

function isAbortError(error: unknown): boolean {
  return (error as { name?: string } | undefined)?.name === 'AbortError'
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function parseUsage(value: unknown): AiUsage {
  const usage = (value ?? {}) as { prompt_tokens?: number; completion_tokens?: number }
  return {
    promptTokens: Number(usage.prompt_tokens ?? 0),
    completionTokens: Number(usage.completion_tokens ?? 0),
  }
}

function withTimeout(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

interface ChatResponseJson {
  model?: string
  choices?: { message?: { content?: string } }[]
  usage?: unknown
}

interface EmbeddingResponseJson {
  model?: string
  data?: { embedding?: number[] }[]
  usage?: unknown
}

/**
 * Provider 中立的 AI 服务。
 *
 * 每次真实发出的请求都会写入调用记录；未配置 Key 时能力标记为不可用，
 * 由业务方决定降级方式。
 */
export class AiService {
  readonly provider: string
  readonly available: boolean
  readonly chatModel: string
  readonly embedding: {
    available: boolean
    model?: string
    dim: number
    reason?: string
  }

  private readonly baseUrl: string
  private readonly apiKey: string
  private readonly embeddingModel?: string
  private readonly embeddingDim: number
  private readonly timeoutMs: number
  private readonly maxRetries: number
  private readonly retryBaseMs: number
  private readonly fetchImpl: FetchLike
  private readonly sleep: (ms: number) => Promise<void>
  private readonly calls: AiCallSink

  constructor(deps: AiServiceDeps) {
    this.provider = deps.provider
    this.baseUrl = deps.baseUrl
    this.apiKey = deps.apiKey
    this.chatModel = deps.chatModel
    this.embeddingModel = deps.embeddingModel
    this.embeddingDim = deps.embeddingDim
    this.timeoutMs = deps.timeoutMs
    this.maxRetries = Math.max(0, deps.maxRetries)
    this.retryBaseMs = deps.retryBaseMs
    this.fetchImpl = deps.fetchImpl ?? fetch
    this.sleep = deps.sleep ?? (ms => new Promise(done => setTimeout(done, ms)))
    this.calls = deps.calls

    this.available = this.apiKey.length > 0
    this.embedding = {
      available: this.available && Boolean(this.embeddingModel),
      model: this.embeddingModel,
      dim: this.embeddingDim,
      reason: !this.available
        ? '未配置 AI API Key'
        : this.embeddingModel
          ? undefined
          : '当前 AI Provider 未配置 embedding 模型',
    }
  }

  stats(options: { since?: string } = {}): AiStats {
    return this.calls.stats(options)
  }

  async chat(request: ChatRequest, options: AiCallOptions = {}): Promise<ChatResult> {
    this.ensureAvailable()
    const model = request.model ?? this.chatModel
    const started = Date.now()

    try {
      const data = (await this.requestJson(
        '/chat/completions',
        {
          model,
          messages: request.messages,
          temperature: request.temperature,
          max_tokens: request.maxTokens,
          response_format: request.json ? { type: 'json_object' } : undefined,
        },
        options,
      )) as ChatResponseJson

      const text = data.choices?.[0]?.message?.content
      if (typeof text !== 'string') {
        throw new AiRequestError('AI 响应缺少文本内容')
      }

      const usage = parseUsage(data.usage)
      this.calls.record({
        provider: this.provider,
        kind: 'chat',
        model: data.model ?? model,
        status: 'ok',
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        durationMs: Date.now() - started,
      })

      return { text, model: data.model ?? model, usage }
    } catch (error) {
      this.recordFailure('chat', model, started, error)
      throw error
    }
  }

  async embed(request: EmbeddingRequest, options: AiCallOptions = {}): Promise<EmbeddingResult> {
    this.ensureAvailable()
    const model = request.model ?? this.embeddingModel
    if (!model) {
      throw new AiRequestError('当前 AI Provider 未配置 embedding 模型')
    }
    if (request.input.length === 0) {
      return { vectors: [], model, usage: { promptTokens: 0, completionTokens: 0 } }
    }

    const started = Date.now()

    try {
      const data = (await this.requestJson(
        '/embeddings',
        { model, input: request.input },
        options,
      )) as EmbeddingResponseJson

      const vectors = (data.data ?? []).map(item => item.embedding ?? [])
      if (vectors.length !== request.input.length) {
        throw new AiRequestError(
          `向量数量不匹配：请求 ${request.input.length} 段，返回 ${vectors.length} 段`,
        )
      }
      for (const vector of vectors) {
        if (vector.length !== this.embeddingDim) {
          throw new AiRequestError(
            `向量维度不匹配：期望 ${this.embeddingDim}，收到 ${vector.length}`,
          )
        }
      }

      const usage = parseUsage(data.usage)
      this.calls.record({
        provider: this.provider,
        kind: 'embedding',
        model: data.model ?? model,
        status: 'ok',
        promptTokens: usage.promptTokens,
        durationMs: Date.now() - started,
      })

      return { vectors, model: data.model ?? model, usage }
    } catch (error) {
      this.recordFailure('embedding', model, started, error)
      throw error
    }
  }

  private ensureAvailable(): void {
    if (!this.apiKey) {
      throw new AiRequestError('未配置 AI API Key（SUBLATE_AI_API_KEY 或 DEEPSEEK_API_KEY）')
    }
  }

  private recordFailure(
    kind: AiCallKind,
    model: string,
    started: number,
    error: unknown,
  ): void {
    const cancelled =
      isAbortError(error) || (error instanceof AiRequestError && error.cancelled)
    this.calls.record({
      provider: this.provider,
      kind,
      model,
      status: cancelled ? 'cancelled' : 'error',
      durationMs: Date.now() - started,
      error: cancelled ? undefined : errorMessage(error).slice(0, 500),
    })
  }

  private async requestJson(
    path: string,
    body: Record<string, unknown>,
    options: AiCallOptions,
  ): Promise<unknown> {
    if (!this.apiKey) {
      throw new AiRequestError('未配置 AI API Key（SUBLATE_AI_API_KEY 或 DEEPSEEK_API_KEY）')
    }

    const url = `${this.baseUrl}${path}`
    const signal = withTimeout(options.signal, this.timeoutMs)
    let attempt = 0

    while (true) {
      let response: Response
      try {
        response = await this.fetchImpl(url, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${this.apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
          signal,
        })
      } catch (error) {
        if (isAbortError(error)) {
          throw new AiRequestError('AI 请求已取消或超时', undefined, true)
        }
        throw new AiRequestError(`AI 请求失败：${errorMessage(error)}`)
      }

      if (response.ok) {
        try {
          return await response.json()
        } catch {
          throw new AiRequestError('AI 响应不是合法 JSON', response.status)
        }
      }

      if (isRetryableStatus(response.status) && attempt < this.maxRetries) {
        await response.text().catch(() => '')
        attempt += 1
        await this.sleep(this.retryBaseMs * 2 ** (attempt - 1))
        continue
      }

      const detail = await response.text().catch(() => '')
      const suffix = detail ? ` ${detail.slice(0, 200)}` : ''
      throw new AiRequestError(`AI 请求失败：HTTP ${response.status}${suffix}`, response.status)
    }
  }
}

export function apply(ctx: Context, config: AiProviderConfig = {}) {
  const db = ctx.get('db') as DbLike | undefined
  if (!db) throw new Error('ai-provider 需要 db 服务')

  const service = new AiService({
    ...resolveConfig(config),
    calls: db.aiCalls,
  })

  ctx.provide('ai', service)

  if (service.available) {
    ctx.logger('ai-provider').info(
      `AI Provider 已就绪：${service.provider} / ${service.chatModel}` +
        (service.embedding.available ? `，向量模型 ${service.embedding.model}` : '，无向量能力'),
    )
  } else {
    ctx.logger('ai-provider').warn('未配置 AI API Key，AI 能力标记为不可用')
  }
}
