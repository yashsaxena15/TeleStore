import { describe, it, expect } from 'vitest';
import { formatDuration, getItemDuration, isItemStarred } from './fileCardHelpers.js';

describe('FileCard Helpers', () => {
  it('formats duration under 60 seconds', () => {
    expect(formatDuration(0)).toBe(null);
    expect(formatDuration(-15)).toBe(null);
    expect(formatDuration(null)).toBe(null);
    expect(formatDuration(undefined)).toBe(null);
    expect(formatDuration(NaN)).toBe(null);
    expect(formatDuration(Infinity)).toBe(null);
    expect(formatDuration(5)).toBe('0:05');
    expect(formatDuration(42)).toBe('0:42');
  });

  it('formats duration in minutes & seconds', () => {
    expect(formatDuration(60)).toBe('1:00');
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(125)).toBe('2:05');
    expect(formatDuration(3599)).toBe('59:59');
    expect(formatDuration('120')).toBe('2:00');
    expect(formatDuration(75.8)).toBe('1:15');
  });

  it('formats duration in hours, minutes, seconds', () => {
    expect(formatDuration(3600)).toBe('1:00:00');
    expect(formatDuration(3665)).toBe('1:01:05');
    expect(formatDuration(7322)).toBe('2:02:02');
  });

  it('extracts item duration from metadata fields', () => {
    expect(getItemDuration(null)).toBe(null);
    expect(getItemDuration({})).toBe(null);
    expect(getItemDuration({ duration: 85 })).toBe('1:25');
    expect(getItemDuration({ metadata: { duration: 130 } })).toBe('2:10');
    expect(getItemDuration({ video_duration: 3605 })).toBe('1:00:05');
    expect(getItemDuration({ video: { duration: 90 } })).toBe('1:30');
    expect(getItemDuration({ duration: 0 })).toBe(null);
  });

  it('checks item starred state accurately', () => {
    expect(isItemStarred(null)).toBe(false);
    expect(isItemStarred(undefined)).toBe(false);
    expect(isItemStarred({})).toBe(false);
    expect(isItemStarred({ starred: true })).toBe(true);
    expect(isItemStarred({ is_starred: true })).toBe(true);
    expect(isItemStarred({ starred: false, is_starred: false })).toBe(false);
  });
});
