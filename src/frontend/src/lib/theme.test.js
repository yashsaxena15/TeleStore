import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getStoredTheme, setTheme, applyTheme, THEMES } from './theme.js';

describe('theme module', () => {
  let storage = {};
  const mockLocalStorage = {
    getItem: (k) => storage[k] || null,
    setItem: (k, v) => { storage[k] = String(v); },
    removeItem: (k) => { delete storage[k]; },
    clear: () => { storage = {}; },
  };

  const originalStorage = globalThis.localStorage;
  globalThis.localStorage = mockLocalStorage;

  beforeEach(() => {
    mockLocalStorage.clear();
  });

  afterAll(() => {
    globalThis.localStorage = originalStorage;
  });

  it('defaults theme to dark when unset', () => {
    const defaultTheme = getStoredTheme();
    expect(defaultTheme).toBe(THEMES.DARK);
  });

  it('persists light theme', () => {
    setTheme(THEMES.LIGHT);
    const lightTheme = getStoredTheme();
    expect(lightTheme).toBe(THEMES.LIGHT);
  });

  it('persists system theme', () => {
    setTheme(THEMES.SYSTEM);
    const systemTheme = getStoredTheme();
    expect(systemTheme).toBe(THEMES.SYSTEM);
  });

  it('rejects invalid theme value', () => {
    setTheme(THEMES.SYSTEM);
    setTheme('neon-green');
    const unchangedTheme = getStoredTheme();
    expect(unchangedTheme).toBe(THEMES.SYSTEM);
  });
});
