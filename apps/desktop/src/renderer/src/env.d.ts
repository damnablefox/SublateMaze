import './styles.css'

declare global {
  interface Window {
    sublate: {
      getPlugins(): Promise<
        {
          id: string
          name: string
          status: 'running' | 'disabled' | 'failed'
          error?: string
        }[]
      >
      demoPing(): Promise<string>
    }
  }
}

export {}
