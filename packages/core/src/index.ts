/**
 * 平台无关的领域核心。
 *
 * 约束：不得 import Electron、node:fs、node:path、node:child_process。
 * 文件与数据库能力由插件以接口注入。
 */

export const CORE_VERSION = '0.1.0'

export * from './budget.ts'
export * from './library.ts'
export * from './notes.ts'
export * from './plan.ts'
export * from './review.ts'
export * from './text.ts'

/** 领域实体 id 统一使用字符串，便于跨进程与持久化。 */
export type EntityId = string

/** 领域层的最小错误类型，避免把宿主异常泄露到 core。 */
export class DomainError extends Error {
  readonly code: string

  constructor(message: string, code: string) {
    super(message)
    this.name = 'DomainError'
    this.code = code
  }
}
