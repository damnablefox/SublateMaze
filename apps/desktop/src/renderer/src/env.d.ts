/// <reference types="vite/client" />

export interface PluginState {
  id: string
  name: string
  status: 'running' | 'disabled' | 'failed'
  error?: string
}

export interface CarrierFileInfo {
  sha256: string
  relPath: string
  mime: string
  size: number
}

export interface Carrier {
  id: string
  kind: 'pdf' | 'web'
  title: string
  authors: string[]
  sourceUrl?: string
  language?: string
  pageCount: number
  status: 'pending' | 'parsing' | 'ready' | 'failed'
  error?: string
  createdAt: string
  updatedAt: string
  deletedAt?: string
  file: CarrierFileInfo
}

export interface ReadState {
  pageNo: number
  scrollRatio: number
}

export interface PageText {
  pageNo: number
  text: string
}

export interface SearchHit {
  carrierId: string
  title: string
  pageNo: number
  snippet: string
}

export interface ImportResult {
  carrierId?: string
  title: string
  duplicated: boolean
  status: 'ready' | 'failed'
  error?: string
}

export interface CarrierDetail {
  carrier: Carrier
  readState?: ReadState
}

export interface KnowledgeUnit {
  id: string
  carrierId: string
  title: string
  pageStart?: number
  pageEnd?: number
  status: 'draft' | 'confirmed'
  source: 'ai' | 'manual'
  createdAt: string
  updatedAt: string
}

export interface KnowledgePoint {
  id: string
  unitId?: string
  carrierId: string
  title: string
  content: string
  pageStart: number
  pageEnd: number
  status: 'draft' | 'confirmed' | 'rejected'
  source: 'ai' | 'manual'
  createdAt: string
  updatedAt: string
}

export interface KnowledgeStats {
  total: number
  draft: number
  confirmed: number
  rejected: number
}

export interface AiJobSummary {
  id: string
  kind: string
  status: 'pending' | 'running' | 'done' | 'failed' | 'cancelled'
  error?: string
  createdAt: string
}

export interface KnowledgeSnapshot {
  units: KnowledgeUnit[]
  points: KnowledgePoint[]
  stats: KnowledgeStats
  jobs: AiJobSummary[]
}

export interface ExtractResult {
  jobId: string
  status: 'done' | 'failed'
  unitCount: number
  pointCount: number
  error?: string
}

declare global {
  interface Window {
    sublate: {
      getPlugins(): Promise<PluginState[]>
      demoPing(): Promise<string>
      library: {
        list(): Promise<Carrier[]>
        pickFiles(): Promise<string[]>
        importFiles(paths: string[]): Promise<ImportResult[]>
        importUrl(url: string): Promise<ImportResult>
        detail(id: string): Promise<CarrierDetail>
        file(id: string): Promise<Uint8Array>
        pages(id: string, from: number, to: number): Promise<PageText[]>
        saveReadPosition(id: string, pageNo: number, scrollRatio: number): Promise<void>
        remove(id: string): Promise<void>
        restore(id: string): Promise<void>
        trash(): Promise<Carrier[]>
        search(text: string): Promise<SearchHit[]>
      }
      knowledge: {
        list(carrierId: string): Promise<KnowledgeSnapshot>
        extract(carrierId: string): Promise<ExtractResult>
        confirm(ids: string[]): Promise<void>
        reject(ids: string[]): Promise<void>
        setAnchor(id: string, pageStart: number, pageEnd: number): Promise<void>
        merge(ids: string[]): Promise<{ id: string }>
        split(id: string, splitPage: number): Promise<{ firstId: string; secondId: string }>
      }
    }
  }
}

export {}
