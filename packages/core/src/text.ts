/**
 * 检索文本处理：平台无关，供索引写入与查询构造共用。
 *
 * SQLite FTS5 的 unicode61 分词器会把连续汉字当成一个 token，
 * 因此写入与查询前都把 CJK 字符逐字用空格切开，使中文可以按短语匹配。
 */

/** CJK 及日韩文字范围。 */
const CJK_PATTERN =
  /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u3040-\u30FF\uAC00-\uD7AF]/u

export function isCjkChar(char: string): boolean {
  return CJK_PATTERN.test(char)
}

/** 把 CJK 字符逐字分隔，英文与数字保持原样。 */
export function segmentCjk(text: string): string {
  let output = ''

  for (const char of text.normalize('NFKC')) {
    if (isCjkChar(char)) {
      output += ` ${char} `
    } else {
      output += char
    }
  }

  return output.replace(/\s+/g, ' ').trim()
}

/**
 * 把用户输入转成 FTS5 MATCH 表达式。
 *
 * - 连续汉字转为短语，例如「知识点」→ `"知 识 点"`；
 * - 拉丁词与数字各自成词，用 AND 连接；
 * - 过滤双引号等 FTS 语法字符，避免查询注入或语法错误；
 * - 无有效字符时返回 undefined。
 */
export function buildFtsMatch(query: string): string | undefined {
  const terms: string[] = []
  let latin = ''
  let cjk = ''

  const flushLatin = () => {
    if (latin) {
      terms.push(`"${latin}"`)
      latin = ''
    }
  }

  const flushCjk = () => {
    if (cjk) {
      const chars = [...cjk].join(' ')
      terms.push(`"${chars}"`)
      cjk = ''
    }
  }

  for (const raw of query.normalize('NFKC')) {
    if (isCjkChar(raw)) {
      flushLatin()
      cjk += raw
    } else if (/[A-Za-z0-9_]/.test(raw)) {
      flushCjk()
      latin += raw
    } else {
      flushLatin()
      flushCjk()
    }
  }

  flushLatin()
  flushCjk()

  return terms.length > 0 ? terms.join(' AND ') : undefined
}
