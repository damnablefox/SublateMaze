import { useEffect, useState } from 'react'

interface PluginState {
  id: string
  name: string
  status: 'running' | 'disabled' | 'failed'
  error?: string
}

export function App() {
  const [plugins, setPlugins] = useState<PluginState[]>([])
  const [pong, setPong] = useState('加载中…')
  const [error, setError] = useState<string>()

  useEffect(() => {
    window.sublate
      .getPlugins()
      .then(setPlugins)
      .catch((reason) => setError(String(reason)))

    window.sublate
      .demoPing()
      .then(setPong)
      .catch((reason) => setError(String(reason)))
  }, [])

  return (
    <main className="shell">
      <header>
        <h1>SublateMaze</h1>
        <p className="subtitle">本地优先的个人学习平台与知识库</p>
      </header>

      <section>
        <h2>插件树</h2>
        {error ? <p className="error">{error}</p> : null}
        <ul className="plugins">
          {plugins.map((plugin) => (
            <li key={plugin.id}>
              <span className={`dot ${plugin.status}`} />
              <strong>{plugin.id}</strong>
              <span className="name">{plugin.name}</span>
              <span className="status">{plugin.status}</span>
            </li>
          ))}
        </ul>
        <p className="pong">服务自检：{pong}</p>
      </section>

      <footer>M0 工程骨架 · Windows x64</footer>
    </main>
  )
}
