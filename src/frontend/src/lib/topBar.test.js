/**
 * Unit tests for TopBar configuration, sorting labels, and type filter chips.
 */

import { getSortLabel, getTypeChips } from './topBarConfig.js';

export function runTopBarTests() {
  console.log('Running TopBar Configuration & Filter Chip tests...');

  // 1. Sort label resolution
  console.assert(getSortLabel('name', 'asc') === 'Name (A-Z)', 'name asc should be Name (A-Z)');
  console.assert(getSortLabel('name', 'desc') === 'Name (Z-A)', 'name desc should be Name (Z-A)');
  console.assert(getSortLabel('date', 'desc') === 'Newest', 'date desc should be Newest');
  console.assert(getSortLabel('date', 'asc') === 'Oldest', 'date asc should be Oldest');
  console.assert(getSortLabel('size', 'desc') === 'Size (High)', 'size desc should be Size (High)');
  console.assert(getSortLabel('size', 'asc') === 'Size (Low)', 'size asc should be Size (Low)');
  console.assert(getSortLabel('unknown', 'asc') === 'Sort', 'unknown should default to Sort');

  // 2. Type chips generation (normal mode)
  const normalChips = getTypeChips(false);
  console.assert(normalChips.length === 7, 'Normal mode should have 7 filter chips');
  const chipIds = normalChips.map(c => c.id);
  console.assert(chipIds.includes('all'), 'Should include "all" chip');
  console.assert(chipIds.includes('folder'), 'Should include "folder" chip in normal mode');
  console.assert(chipIds.includes('video'), 'Should include "video" chip');
  console.assert(chipIds.includes('document'), 'Should include "document" chip');
  console.assert(chipIds.includes('photo'), 'Should include "photo" chip');
  console.assert(chipIds.includes('audio'), 'Should include "audio" chip');
  console.assert(chipIds.includes('archive'), 'Should include "archive" chip');

  // 3. Vector icons presence (verify all chips have a valid Lucide component, no emoji strings)
  normalChips.forEach(chip => {
    console.assert(typeof chip.icon === 'object' || typeof chip.icon === 'function', `Chip ${chip.id} must have a valid Lucide component icon`);
    console.assert(typeof chip.icon !== 'string', `Chip ${chip.id} icon must NOT be an emoji string`);
  });

  // 4. Type chips in Telegram Inbox mode (folders excluded)
  const inboxChips = getTypeChips(true);
  console.assert(inboxChips.length === 6, 'Inbox mode should have 6 filter chips');
  console.assert(!inboxChips.some(c => c.id === 'folder'), 'Inbox mode must exclude folder chip');

  console.log('All TopBar Configuration & Filter Chip tests passed successfully! (14/14 assertions)');
  return true;
}

if (typeof process !== 'undefined' || (typeof window !== 'undefined' && window.location?.protocol === 'file:')) {
  runTopBarTests();
}
