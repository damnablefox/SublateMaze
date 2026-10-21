export type ThemeMode = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'sublate.theme'

/** 读取用户主题偏好；无记录时跟随系统。 */
export function loadThemeMode(): ThemeMode {
  const value = localStorage.getItem(STORAGE_KEY)
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system'
}

/** 把主题落到 body 属性上，token 由 body[data-ds-dark-theme] 整体切换。 */
export function applyTheme(mode: ThemeMode): void {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const dark = mode === 'dark' || (mode === 'system' && prefersDark)

  document.body.toggleAttribute('data-ds-dark-theme', dark)
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
}

export function saveThemeMode(mode: ThemeMode): void {
  localStorage.setItem(STORAGE_KEY, mode)
  applyTheme(mode)
}

/** 监听系统配色变化；返回取消订阅函数。 */
export function watchSystemTheme(onChange: () => void): () => void {
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  const listener = () => onChange()

  media.addEventListener('change', listener)
  return () => media.removeEventListener('change', listener)
}
