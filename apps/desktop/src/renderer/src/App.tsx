import { useEffect, useState } from 'react'
import { Sidebar, type SidebarView } from './components/Sidebar'
import { CoursesPage } from './pages/CoursesPage'
import { KnowledgePage } from './pages/KnowledgePage'
import { LibraryPage } from './pages/LibraryPage'
import { ReaderPage } from './pages/ReaderPage'
import { ReviewPage } from './pages/ReviewPage'
import { TodayPage } from './pages/TodayPage'
import { TrashPage } from './pages/TrashPage'
import {
  applyTheme,
  loadThemeMode,
  saveThemeMode,
  watchSystemTheme,
  type ThemeMode,
} from './theme/theme'

type View =
  | { name: 'today' }
  | { name: 'reviews' }
  | { name: 'library' }
  | { name: 'knowledge' }
  | { name: 'courses' }
  | { name: 'reader'; id: string; page?: number }
  | { name: 'trash' }

export function App() {
  const [view, setView] = useState<View>({ name: 'today' })
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
        ) : view.name === 'knowledge' ? (
          <KnowledgePage />
        ) : view.name === 'courses' ? (
          <CoursesPage />
        ) : view.name === 'reviews' ? (
          <ReviewPage
            onOpenCarrier={(id, page) => setView({ name: 'reader', id, page })}
          />
        ) : view.name === 'today' ? (
          <TodayPage onOpenReviews={() => setView({ name: 'reviews' })} />
        ) : (
          <LibraryPage
            onOpen={(id, page) => setView({ name: 'reader', id, page })}
          />
        )}
      </main>
    </div>
  )
}
