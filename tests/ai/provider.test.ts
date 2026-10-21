import { describe, expect, it } from 'vitest'
import {
  AiService,
  type AiCallRecord,
  type AiServiceDeps,
  type AiStats,
  type FetchLike,
} from '@sublate/plugin-ai-provider'

function createService(overrides: Partial<AiServiceDeps> = {}) {
  const calls: AiCallRecord[] = []

  const service = new AiService({
    provider: 'test',
    baseUrl: 'https://example.test',
    apiKey: 'sk-test',
    chatModel: 'test-chat',
    embeddingModel: 'test-embed',
    embeddingDim: 3,
    timeoutMs: 5_000,
    maxRetries: 0,
    retryBaseMs: 1,
    calls: {
      record: (call) => {
        calls.push(call)
      },
      stats: () => ({
        calls: calls.length,
        promptTokens: 0,
        completionTokens: 0,
        byKind: { chat: 0, embedding: 0 },
      }),
    },
    sleep: async () => {},
    ...overrides,
  })

  return { service, calls }
}

function chatResponse(text: string, promptTokens = 10, completionTokens = 5): Response {
  return new Response(
    JSON.stringify({
      model: 'test-chat',
      choices: [{ message: { content: text } }],
      usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

function embeddingResponse(vectors: number[][], promptTokens = 8): Response {
  return new Response(
    JSON.stringify({
      model: 'test-embed',
      data: vectors.map(embedding => ({ embedding })),
      usage: { prompt_tokens: promptTokens },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

describe('ai-provider', () => {
  it('没有 API Key 时标记不可用且不记录调用', async () => {
    const { service, calls } = createService({ apiKey: '' })

    expect(service.available).toBe(false)
    expect(service.embedding.available).toBe(false)
    expect(service.embedding.reason).toBe('未配置 AI API Key')

    await expect(
      service.chat({ messages: [{ role: 'user', content: '你好' }] }),
    ).rejects.toThrow('未配置 AI API Key')

    expect(calls).toHaveLength(0)
  })

  it('chat 解析文本与用量，并写入调用记录', async () => {
    const requests: { url: string; init: RequestInit }[] = []
    const fetchImpl: FetchLike = async (url, init) => {
      requests.push({ url, init })
      return chatResponse('{"ok":true}')
    }
    const { service, calls } = createService({ fetchImpl })

    const result = await service.chat({
      messages: [{ role: 'user', content: '你好' }],
      json: true,
      temperature: 0.2,
    })

    expect(result.text).toBe('{"ok":true}')
    expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 5 })
    expect(result.model).toBe('test-chat')

    const request = requests[0]!
    expect(request.url).toBe('https://example.test/chat/completions')
    const body = JSON.parse(String(request.init.body)) as Record<string, unknown>
    expect(body.model).toBe('test-chat')
    expect(body.temperature).toBe(0.2)
    expect(body.response_format).toEqual({ type: 'json_object' })

    const headers = request.init.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer sk-test')

    expect(calls).toHaveLength(1)
    expect(calls[0]?.status).toBe('ok')
    expect(calls[0]?.promptTokens).toBe(10)
  })

  it('500 按配置重试，成功后只记录一次调用', async () => {
    let attempts = 0
    const fetchImpl: FetchLike = async () => {
      attempts += 1
      return attempts <= 2 ? new Response('busy', { status: 500 }) : chatResponse('完成')
    }
    const { service, calls } = createService({
      fetchImpl,
      maxRetries: 2,
      retryBaseMs: 1,
    })

    const result = await service.chat({ messages: [{ role: 'user', content: '重试' }] })

    expect(result.text).toBe('完成')
    expect(attempts).toBe(3)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.status).toBe('ok')
  })

  it('401 不重试并记录错误', async () => {
    let attempts = 0
    const fetchImpl: FetchLike = async () => {
      attempts += 1
      return new Response('unauthorized', { status: 401 })
    }
    const { service, calls } = createService({ fetchImpl, maxRetries: 2 })

    await expect(
      service.chat({ messages: [{ role: 'user', content: '鉴权' }] }),
    ).rejects.toThrow('HTTP 401')

    expect(attempts).toBe(1)
    expect(calls[0]?.status).toBe('error')
    expect(calls[0]?.error).toContain('401')
  })

  it('embed 解析向量并校验维度', async () => {
    const fetchImpl: FetchLike = async () => embeddingResponse([[0.1, 0.2, 0.3]])
    const { service, calls } = createService({ fetchImpl })

    const result = await service.embed({ input: ['知识点'] })

    expect(result.vectors).toEqual([[0.1, 0.2, 0.3]])
    expect(result.usage.promptTokens).toBe(8)
    expect(calls[0]?.kind).toBe('embedding')
  })

  it('向量维度不匹配时抛错并记录', async () => {
    const fetchImpl: FetchLike = async () => embeddingResponse([[0.1, 0.2]])
    const { service, calls } = createService({ fetchImpl })

    await expect(service.embed({ input: ['知识点'] })).rejects.toThrow('向量维度不匹配')
    expect(calls[0]?.status).toBe('error')
  })

  it('未配置 embedding 模型时明确提示', async () => {
    const { service } = createService({ embeddingModel: undefined })

    expect(service.embedding.available).toBe(false)
    expect(service.embedding.reason).toBe('当前 AI Provider 未配置 embedding 模型')
    await expect(service.embed({ input: ['x'] })).rejects.toThrow('未配置 embedding 模型')
  })

  it('取消的请求记录为 cancelled', async () => {
    const fetchImpl: FetchLike = async () => {
      const error = new Error('aborted')
      error.name = 'AbortError'
      throw error
    }
    const { service, calls } = createService({ fetchImpl })

    await expect(
      service.chat({ messages: [{ role: 'user', content: '取消' }] }),
    ).rejects.toThrow('已取消或超时')

    expect(calls[0]?.status).toBe('cancelled')
    expect(calls[0]?.error).toBeUndefined()
  })

  it('stats 委托给调用记录仓储', () => {
    const expected: AiStats = {
      calls: 3,
      promptTokens: 120,
      completionTokens: 40,
      byKind: { chat: 2, embedding: 1 },
    }
    const service = new AiService({
      provider: 'test',
      baseUrl: 'https://example.test',
      apiKey: 'sk-test',
      chatModel: 'test-chat',
      embeddingDim: 3,
      timeoutMs: 1_000,
      maxRetries: 0,
      retryBaseMs: 1,
      calls: { record: () => {}, stats: () => expected },
    })

    expect(service.stats()).toEqual(expected)
  })
})
