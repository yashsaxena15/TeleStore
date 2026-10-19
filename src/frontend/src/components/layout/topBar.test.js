import { describe, it, expect } from 'vitest';
import { getSortLabel, getTypeChips } from './topBarConfig.js';

describe('TopBar Configuration & Filter Chips', () => {
  it('resolves sort labels correctly', () => {
    expect(getSortLabel('name', 'asc')).toBe('Name (A-Z)');
    expect(getSortLabel('name', 'desc')).toBe('Name (Z-A)');
    expect(getSortLabel('date', 'desc')).toBe('Newest');
    expect(getSortLabel('date', 'asc')).toBe('Oldest');
    expect(getSortLabel('size', 'desc')).toBe('Size (High)');
    expect(getSortLabel('size', 'asc')).toBe('Size (Low)');
    expect(getSortLabel('unknown', 'asc')).toBe('Sort');
  });

  it('generates 7 type filter chips in normal mode', () => {
    const normalChips = getTypeChips(false);
    expect(normalChips.length).toBe(7);
    const chipIds = normalChips.map(c => c.id);
    expect(chipIds).toContain('all');
    expect(chipIds).toContain('folder');
    expect(chipIds).toContain('video');
    expect(chipIds).toContain('document');
    expect(chipIds).toContain('photo');
    expect(chipIds).toContain('audio');
    expect(chipIds).toContain('archive');
  });

  it('provides valid Lucide component icons for all chips (no emoji strings)', () => {
    const normalChips = getTypeChips(false);
    normalChips.forEach(chip => {
      const isComponent = typeof chip.icon === 'object' || typeof chip.icon === 'function';
      expect(isComponent).toBe(true);
      expect(typeof chip.icon).not.toBe('string');
    });
  });

  it('excludes folder chip in Telegram Inbox mode', () => {
    const inboxChips = getTypeChips(true);
    expect(inboxChips.length).toBe(6);
    expect(inboxChips.some(c => c.id === 'folder')).toBe(false);
  });
});
