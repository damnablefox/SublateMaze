import type { ThemeMode } from '../theme/theme'
import { LibraryIcon, MoonIcon, SunIcon, SystemIcon, TrashIcon } from './icons'

export type SidebarView = 'library' | 'trash'

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

export function Sidebar({ active, themeMode, onNavigate, onThemeModeChange }: SidebarProps) {
  const current: SidebarView = active === 'reader' ? 'library' : active

  return (
    <aside className="sidebar">
      <button type="button" className="brand" onClick={() => onNavigate('library')}>
        <span className="brand-mark">S</span>
        <span className="brand-name">SublateMaze</span>
      </button>

      <nav className="sidebar-nav" aria-label="主导航">
        <button
          type="button"
          className={`nav-item${current === 'library' ? ' active' : ''}`}
          onClick={() => onNavigate('library')}
        >
          <LibraryIcon />
          <span>知识库</span>
        </button>
        <button
          type="button"
          className={`nav-item${current === 'trash' ? ' active' : ''}`}
          onClick={() => onNavigate('trash')}
        >
          <TrashIcon />
          <span>回收站</span>
        </button>
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
        <span className="sidebar-version">M1 · Windows x64</span>
      </div>
    </aside>
  )
}
