# Spec-0003：AI Provider 与调用成本

- 状态：已完成
- 日期：2026-10-22
- 里程碑：M2（第一阶段）

## 目标

建立可替换的 AI 能力层，为后续知识点抽取、向量索引与 Agent 工具提供统一入口：

1. `ctx.ai` 暴露 Provider 中立的 `chat` 与 `embed` 接口；
2. 内置 DeepSeek 适配，同时兼容 OpenAI 风格的 `/chat/completions` 与 `/embeddings`；
3. 没有 API Key 时插件仍正常加载，标记 `available=false`，业务方按能力降级；
4. 每次调用记录模型、状态、token 用量与耗时，可按时间汇总成本；
5. 失败重试只覆盖 429 与 5xx，避免重复计费。

## 非目标

- 知识点抽取与修订界面（Spec-0004）；
- chunk embedding 与混合检索（Spec-0005）；
- 设置界面中的模型选择（先用环境变量，UI 后续补）；
- 计费金额换算（只记录 token，价格表后续加）。

## 配置

全部通过环境变量提供，缺失时使用默认值：

| 变量 | 默认 | 说明 |
|---|---|---|
| `SUBLATE_AI_PROVIDER` | `deepseek` | Provider 标识，写入调用记录 |
| `SUBLATE_AI_BASE_URL` | `https://api.deepseek.com` | OpenAI 兼容根地址 |
| `SUBLATE_AI_API_KEY` | - | 优先读取；缺失时回退 `DEEPSEEK_API_KEY` |
| `SUBLATE_AI_CHAT_MODEL` | `deepseek-chat` | 对话模型 |
| `SUBLATE_AI_EMBEDDING_MODEL` | - | 留空表示该 Provider 不支持向量 |
| `SUBLATE_AI_EMBEDDING_DIM` | `1024` | 必须与 LanceDB collection 维度一致 |
| `SUBLATE_AI_TIMEOUT_MS` | `60000` | 单次请求超时 |
| `SUBLATE_AI_MAX_RETRIES` | `2` | 429/5xx 重试次数 |

DeepSeek 官方接口暂不提供 embedding，因此 `embedding.available` 在未配置模型时为 `false`；后续接入其他兼容服务只需换环境变量，不改业务代码。

## 接口

```ts
// ctx.ai
interface AiService {
  readonly provider: string
  readonly available: boolean
  readonly chatModel: string
  readonly embedding: {
    available: boolean
    model?: string
    dim: number
    reason?: string
  }

  chat(request: ChatRequest, options?: AiCallOptions): Promise<ChatResult>
  embed(request: EmbeddingRequest, options?: AiCallOptions): Promise<EmbeddingResult>
  stats(options?: { since?: string }): AiStats
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface ChatRequest {
  messages: ChatMessage[]
  model?: string
  temperature?: number
  maxTokens?: number
  /** 请求 JSON 输出（response_format=json_object）。 */
  json?: boolean
}

interface ChatResult {
  text: string
  model: string
  usage: AiUsage
}

interface EmbeddingRequest {
  input: string[]
  model?: string
}

interface EmbeddingResult {
  vectors: number[][]
  model: string
  usage: AiUsage
}

interface AiUsage {
  promptTokens: number
  completionTokens: number
}

interface AiStats {
  calls: number
  promptTokens: number
  completionTokens: number
  byKind: Record<'chat' | 'embedding', number>
}
```

`AiCallOptions` 支持 `signal?: AbortSignal`，用于后续任务取消。

## 数据变更（迁移 003）

```sql
CREATE TABLE ai_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  kind TEXT NOT NULL,              -- chat | embedding
  model TEXT NOT NULL,
  status TEXT NOT NULL,            -- ok | error | cancelled
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX ai_calls_created_idx ON ai_calls (created_at);
```

由 `storage-sqlite` 提供 `ctx.db.aiCalls`：

```ts
record(input: AiCallRecord): void
stats(options?: { since?: string }): AiStats
list(limit?: number): AiCallRecord[]
```

## 行为

1. 无 API Key：`available=false`，`chat`/`embed` 抛「未配置 AI API Key」，不写调用记录；
2. 有 Key：请求带 `Authorization: Bearer`，超时或取消抛可读错误；
3. 重试：429、500、502、503、504 最多重试 `maxRetries` 次，退避 300ms 起翻倍；其他状态码直接失败；
4. 每次真实发出的请求都写一条 `ai_calls`，成功记录 token，失败记录状态与错误摘要；
5. `stats` 按 `since` 过滤，返回调用数与 token 总量。

## 验收标准

- 无 Key 启动：`ai-provider` 为 `running`，`ctx.ai.available === false`，其余插件不受影响；
- mock 服务下 `chat` 正确解析文本与 usage，`embed` 正确解析向量并校验维度；
- 前两次返回 500、第三次成功的场景在 `maxRetries=2` 时可成功，且记录一次成功调用；
- 401 不重试，记录一条 error；
- `stats` 汇总与写入记录一致；
- `pnpm typecheck`、`pnpm lint`、`pnpm test` 通过。

## 测试点

1. 无 Key 时能力标记与错误文案；
2. chat 请求体（模型、消息、`response_format`）与响应解析；
3. embedding 维度不匹配时抛错；
4. 429/500 重试与 401 不重试；
5. 调用记录：成功、失败、取消；
6. stats 汇总与 `since` 过滤；
7. Provider 替换：构造不同 baseUrl 的实例，业务调用代码不变。

## 实测结果（2026-10-22）

- 插件树：14 个插件全部 `running`，无 Key 时 `ai-provider` 仍正常加载并给出降级提示；
- 测试：51 passed（新增 provider 9、AI 调用仓储 2）；
- 覆盖：无 Key、chat/embed 解析、JSON 输出、500 重试、401 不重试、维度校验、取消、stats 委托；
- 未验证：真实 DeepSeek 请求需要 `DEEPSEEK_API_KEY`；DeepSeek 暂无 embedding 接口，向量能力留待接入兼容服务后在 Spec-0005 验证。

## 风险与后续

- DeepSeek 无 embedding：向量能力在 Spec-0005 中按 `embedding.available` 降级为 FTS5；
- 重试可能造成重复计费，仅对明确未成功的 429/5xx 重试；
- 成本金额需要后续维护价格表，本阶段只记录 token。
