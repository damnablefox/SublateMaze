import { useEffect, useState } from 'react'
import { Sidebar, type SidebarView } from './components/Sidebar'
import { AgentPage } from './pages/AgentPage'
import { CoursesPage } from './pages/CoursesPage'
import { KnowledgePage } from './pages/KnowledgePage'
import { LibraryPage } from './pages/LibraryPage'
import { NotesPage } from './pages/NotesPage'
import { OverviewPage } from './pages/OverviewPage'
import { ReaderPage } from './pages/ReaderPage'
import { ReviewPage } from './pages/ReviewPage'
import { SetsPage } from './pages/SetsPage'
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
  | { name: 'notes'; noteId?: string; ref?: { refType: 'point' | 'carrier'; refId: string; label: string } }
  | { name: 'sets' }
  | { name: 'courses' }
  | { name: 'overview' }
  | { name: 'agent' }
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
          <KnowledgePage
            onCreateNote={point =>
              setView({
                name: 'notes',
                ref: { refType: 'point', refId: point.id, label: point.title },
              })
            }
          />
        ) : view.name === 'notes' ? (
          <NotesPage
            key={view.ref ? `${view.ref.refType}:${view.ref.refId}` : view.noteId ?? 'notes'}
            initialNoteId={view.noteId}
            initialRef={view.ref}
          />
        ) : view.name === 'sets' ? (
          <SetsPage />
        ) : view.name === 'courses' ? (
          <CoursesPage />
        ) : view.name === 'overview' ? (
          <OverviewPage />
        ) : view.name === 'agent' ? (
          <AgentPage />
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
