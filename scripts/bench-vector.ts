import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VectorService } from '@sublate/plugin-storage-lancedb'

interface BenchOptions {
  rows: number
  dim: number
  batch: number
  queries: number
}

function parseArgs(argv: string[]): BenchOptions {
  const options: BenchOptions = { rows: 100_000, dim: 1024, batch: 5000, queries: 50 }

  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]
    const value = Number.parseInt(argv[index + 1] ?? '', 10)
    if (!Number.isFinite(value) || value <= 0) continue

    if (key === '--rows') options.rows = value
    if (key === '--dim') options.dim = value
    if (key === '--batch') options.batch = value
    if (key === '--queries') options.queries = value
  }

  return options
}

/** 确定性伪随机向量，避免基准依赖网络与 embedding 服务。 */
function vectorFor(seed: number, dim: number): number[] {
  const vector = new Array<number>(dim)
  let state = (seed * 2654435761) % 4_294_967_296

  for (let index = 0; index < dim; index += 1) {
    state = (state * 1664525 + 1013904223) % 4_294_967_296
    vector[index] = (state / 4_294_967_296) * 2 - 1
  }

  return vector
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0

  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(ratio * sorted.length) - 1))
  return sorted[index]!
}

function round(value: number): number {
  return Math.round(value * 10) / 10
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const dir = mkdtempSync(join(tmpdir(), 'sublate-bench-'))
  const vector = new VectorService(dir, options.dim, 'bench')

  try {
    await vector.init()

    const startedAt = performance.now()
    const writeDurations: number[] = []
    let written = 0

    while (written < options.rows) {
      const size = Math.min(options.batch, options.rows - written)
      const records = Array.from({ length: size }, (_, offset) => {
        const id = `bench-${written + offset}`
        return {
          id,
          vector: vectorFor(written + offset, options.dim),
          ownerType: 'bench',
          ownerId: `owner-${Math.floor(written / options.batch)}`,
        }
      })

      const batchStart = performance.now()
      await vector.upsert(records)
      writeDurations.push(performance.now() - batchStart)
      written += size
    }

    const writeFinishedAt = performance.now()
    const queryDurations: number[] = []

    for (let index = 0; index < options.queries; index += 1) {
      const queryVector = vectorFor(index * 7919 + 17, options.dim)
      const queryStart = performance.now()
      await vector.query(queryVector, 10)
      queryDurations.push(performance.now() - queryStart)
    }

    const finishedAt = performance.now()
    const stats = await vector.stats()

    console.log(
      JSON.stringify(
        {
          rows: options.rows,
          dim: options.dim,
          batch: options.batch,
          queries: options.queries,
          tableRows: stats.rows,
          writeBatches: writeDurations.length,
          writeP50Ms: round(percentile(writeDurations, 0.5)),
          writeP95Ms: round(percentile(writeDurations, 0.95)),
          queryP50Ms: round(percentile(queryDurations, 0.5)),
          queryP95Ms: round(percentile(queryDurations, 0.95)),
          writeTotalMs: round(writeFinishedAt - startedAt),
          queryTotalMs: round(finishedAt - writeFinishedAt),
          totalMs: round(finishedAt - startedAt),
        },
        null,
        2,
      ),
    )
  } finally {
    vector.close()
    rmSync(dir, { recursive: true, force: true })
  }
}

await main()
