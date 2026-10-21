import type { ThemeMode } from '../theme/theme'
import {
  CourseIcon,
  KnowledgeIcon,
  LibraryIcon,
  MoonIcon,
  SunIcon,
  SystemIcon,
  TodayIcon,
  TrashIcon,
} from './icons'

export type SidebarView = 'today' | 'library' | 'knowledge' | 'courses' | 'trash'

interface SidebarProps {
  active: SidebarView | 'reader'
  themeMode: ThemeMode
  onNavigate(view: SidebarView): void
  onThemeModeChange(mode: ThemeMode): void
}

const THEME_OPTIONS: { mode: ThemeMode; label: string; Icon: typeof SunIcon }[] = [
  { mode: 'light', label: '浅色', Icon: SunIcon },
  { mode: 'dark', label: '深色', Icon: MoonIcon },
  { mode: 'system', label: '跟随系统', Icon: SystemIcon },
]

const NAV_ITEMS: { view: SidebarView; label: string; Icon: typeof SunIcon }[] = [
  { view: 'today', label: '今日', Icon: TodayIcon },
  { view: 'library', label: '知识库', Icon: LibraryIcon },
  { view: 'knowledge', label: '知识点', Icon: KnowledgeIcon },
  { view: 'courses', label: '课程', Icon: CourseIcon },
  { view: 'trash', label: '回收站', Icon: TrashIcon },
]

export function Sidebar({ active, themeMode, onNavigate, onThemeModeChange }: SidebarProps) {
  const current: SidebarView = active === 'reader' ? 'library' : active

  return (
    <aside className="sidebar">
      <button type="button" className="brand" onClick={() => onNavigate('library')}>
        <span className="brand-mark">S</span>
        <span className="brand-name">SublateMaze</span>
      </button>

      <nav className="sidebar-nav" aria-label="主导航">
        {NAV_ITEMS.map(({ view, label, Icon }) => (
          <button
            key={view}
            type="button"
            className={`nav-item${current === view ? ' active' : ''}`}
            onClick={() => onNavigate(view)}
          >
            <Icon />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      <div className="sidebar-foot">
        <div className="theme-switch" role="group" aria-label="主题">
          {THEME_OPTIONS.map(({ mode, label, Icon }) => (
            <button
              key={mode}
              type="button"
              className={`theme-option${themeMode === mode ? ' active' : ''}`}
              aria-label={label}
              title={label}
              onClick={() => onThemeModeChange(mode)}
            >
              <Icon size={14} />
            </button>
          ))}
        </div>
        <span className="sidebar-version">M3 · Windows x64</span>
      </div>
    </aside>
  )
}
