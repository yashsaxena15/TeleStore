import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { getPlayerPreference, setPlayerPreference, resetPlayerPreference } from './playerSettings';

describe('player settings', () => {
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

  it('returns built-in as default player preference', () => {
    const defaultPreference = getPlayerPreference();
    expect(defaultPreference).toBe('built-in');
  });

  it('saves and retrieves external player preference', () => {
    setPlayerPreference('external');
    const savedPreference = getPlayerPreference();
    expect(savedPreference).toBe('external');
  });

  it('resets player preference to default', () => {
    setPlayerPreference('external');
    resetPlayerPreference();
    const resetPreference = getPlayerPreference();
    expect(resetPreference).toBe('built-in');
  });

  it('handles invalid player preference by falling back to built-in', () => {
    mockLocalStorage.setItem('playerPreference', 'invalid-value');
    const invalidPreference = getPlayerPreference();
    expect(invalidPreference).toBe('built-in');
  });
});
