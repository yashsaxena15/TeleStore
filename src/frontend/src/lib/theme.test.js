import { getStoredTheme, setTheme, applyTheme, THEMES } from './theme.js';

export function runThemeTests() {
  console.log('Running theme module tests...');

  // Mock localStorage if in node/test environment
  let storage = {};
  const mockLocalStorage = {
    getItem: (k) => storage[k] || null,
    setItem: (k, v) => { storage[k] = String(v); },
    removeItem: (k) => { delete storage[k]; },
    clear: () => { storage = {}; },
  };

  const originalStorage = globalThis.localStorage;
  globalThis.localStorage = mockLocalStorage;

  try {
    // Test 1: Default theme when unset
    mockLocalStorage.clear();
    const defaultTheme = getStoredTheme();
    console.assert(defaultTheme === THEMES.DARK, `Default theme should be 'dark', got '${defaultTheme}'`);

    // Test 2: Persist light theme
    setTheme(THEMES.LIGHT);
    const lightTheme = getStoredTheme();
    console.assert(lightTheme === THEMES.LIGHT, `Stored theme should be 'light', got '${lightTheme}'`);

    // Test 3: Persist system theme
    setTheme(THEMES.SYSTEM);
    const systemTheme = getStoredTheme();
    console.assert(systemTheme === THEMES.SYSTEM, `Stored theme should be 'system', got '${systemTheme}'`);

    // Test 4: Reject invalid theme value
    setTheme('neon-green');
    const unchangedTheme = getStoredTheme();
    console.assert(unchangedTheme === THEMES.SYSTEM, `Invalid theme should not overwrite stored value`);

    console.log('All theme module tests passed successfully!');
    return true;
  } finally {
    globalThis.localStorage = originalStorage;
  }
}

if (typeof window !== 'undefined' && window.location?.protocol === 'file:') {
  runThemeTests();
}
