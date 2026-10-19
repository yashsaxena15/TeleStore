import logger from './logger.js';

const THEME_STORAGE_KEY = 'telestore-theme';
export const THEMES = {
  DARK: 'dark',
  LIGHT: 'light',
  SYSTEM: 'system',
};

/**
 * Safely retrieve the currently stored theme preference.
 * Defaults to 'dark' for Obsidian Studio, falling back gracefully if storage is blocked.
 */
export function getStoredTheme() {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === THEMES.LIGHT || stored === THEMES.DARK || stored === THEMES.SYSTEM) {
      return stored;
    }
  } catch (error) {
    logger.warn('Could not read theme from localStorage:', error);
  }
  return THEMES.DARK;
}

/**
 * Apply the theme class to the document root element.
 * @param {'dark'|'light'|'system'} theme
 */
export function applyTheme(theme = getStoredTheme()) {
  try {
    if (typeof document === 'undefined') {
      return;
    }
    const root = document.documentElement;
    let isDark = true;

    if (theme === THEMES.SYSTEM) {
      isDark = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)').matches : true;
    } else {
      isDark = theme === THEMES.DARK;
    }

    if (isDark) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }

    logger.debug(`Theme applied: ${theme} (dark class: ${isDark})`);
  } catch (error) {
    logger.error('Failed to apply theme:', error);
  }
}

/**
 * Persist and apply a new theme preference.
 * Dispatches a 'telestore-theme-changed' custom event for reactive UI components.
 * @param {'dark'|'light'|'system'} theme
 */
export function setTheme(theme) {
  if (theme !== THEMES.LIGHT && theme !== THEMES.DARK && theme !== THEMES.SYSTEM) {
    logger.warn(`Invalid theme requested: ${theme}`);
    return;
  }

  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch (error) {
    logger.warn('Could not persist theme to localStorage:', error);
  }

  applyTheme(theme);

  try {
    window.dispatchEvent(new CustomEvent('telestore-theme-changed', { detail: { theme } }));
  } catch (e) {
    // ignore in environments without CustomEvent
  }
}

/**
 * Initialize theme listeners on application mount.
 * Returns a cleanup function for media query listeners.
 */
export function initTheme() {
  const currentTheme = getStoredTheme();
  applyTheme(currentTheme);

  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const handleSystemChange = (e) => {
    if (getStoredTheme() === THEMES.SYSTEM) {
      if (e.matches) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    }
  };

  mediaQuery.addEventListener('change', handleSystemChange);
  return () => {
    mediaQuery.removeEventListener('change', handleSystemChange);
  };
}
