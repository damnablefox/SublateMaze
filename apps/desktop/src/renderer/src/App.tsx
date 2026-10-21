import { useEffect, useState } from 'react'
import { Sidebar, type SidebarView } from './components/Sidebar'
import { LibraryPage } from './pages/LibraryPage'
import { ReaderPage } from './pages/ReaderPage'
import { TrashPage } from './pages/TrashPage'
import {
  applyTheme,
  loadThemeMode,
  saveThemeMode,
  watchSystemTheme,
  type ThemeMode,
} from './theme/theme'

type View =
  | { name: 'library' }
  | { name: 'reader'; id: string; page?: number }
  | { name: 'trash' }

export function App() {
  const [view, setView] = useState<View>({ name: 'library' })
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => loadThemeMode())

  useEffect(() => {
    applyTheme(themeMode)
    return watchSystemTheme(() => applyTheme(themeMode))
  }, [themeMode])

  function changeTheme(mode: ThemeMode) {
    setThemeMode(mode)
    saveThemeMode(mode)
  }

  function navigate(target: SidebarView) {
    setView({ name: target })
  }

  return (
    <div className="app-frame">
      <Sidebar
        active={view.name}
        themeMode={themeMode}
        onNavigate={navigate}
        onThemeModeChange={changeTheme}
      />

      <main className="app-main">
        {view.name === 'reader' ? (
          <ReaderPage
            key={view.id}
            id={view.id}
            initialPage={view.page}
            onBack={() => setView({ name: 'library' })}
          />
        ) : view.name === 'trash' ? (
          <TrashPage onBack={() => setView({ name: 'library' })} />
        ) : (
          <LibraryPage
            onOpen={(id, page) => setView({ name: 'reader', id, page })}
          />
        )}
      </main>
    </div>
  )
}
