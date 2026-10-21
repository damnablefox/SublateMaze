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
    }
  }
}

export {}
