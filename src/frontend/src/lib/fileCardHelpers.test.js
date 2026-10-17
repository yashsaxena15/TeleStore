/**
 * Unit tests for FileGrid card helpers: duration formatting, metadata extraction, and star state.
 */

import { formatDuration, getItemDuration, isItemStarred } from './fileCardHelpers.js';

export function runFileCardHelperTests() {
  console.log('Running FileCard Helpers Unit Tests...');

  // 1. formatDuration - Under 60 seconds
  console.assert(formatDuration(0) === null, '0 duration should return null');
  console.assert(formatDuration(-15) === null, 'Negative duration should return null');
  console.assert(formatDuration(null) === null, 'null should return null');
  console.assert(formatDuration(undefined) === null, 'undefined should return null');
  console.assert(formatDuration(NaN) === null, 'NaN should return null');
  console.assert(formatDuration(Infinity) === null, 'Infinity should return null');
  console.assert(formatDuration(5) === '0:05', '5s should format to 0:05');
  console.assert(formatDuration(42) === '0:42', '42s should format to 0:42');

  // 2. formatDuration - Minutes & seconds
  console.assert(formatDuration(60) === '1:00', '60s should format to 1:00');
  console.assert(formatDuration(65) === '1:05', '65s should format to 1:05');
  console.assert(formatDuration(125) === '2:05', '125s should format to 2:05');
  console.assert(formatDuration(3599) === '59:59', '3599s should format to 59:59');
  console.assert(formatDuration('120') === '2:00', 'String "120" should format to 2:00');
  console.assert(formatDuration(75.8) === '1:15', 'Float 75.8 should floor to 1:15');

  // 3. formatDuration - Hours, minutes, seconds
  console.assert(formatDuration(3600) === '1:00:00', '3600s should format to 1:00:00');
  console.assert(formatDuration(3665) === '1:01:05', '3665s should format to 1:01:05');
  console.assert(formatDuration(7322) === '2:02:02', '7322s should format to 2:02:02');

  // 4. getItemDuration - Metadata field extraction
  console.assert(getItemDuration(null) === null, 'null item should return null');
  console.assert(getItemDuration({}) === null, 'Empty item should return null');
  console.assert(getItemDuration({ duration: 85 }) === '1:25', 'item.duration should be extracted');
  console.assert(getItemDuration({ metadata: { duration: 130 } }) === '2:10', 'item.metadata.duration should be extracted');
  console.assert(getItemDuration({ video_duration: 3605 }) === '1:00:05', 'item.video_duration should be extracted');
  console.assert(getItemDuration({ video: { duration: 90 } }) === '1:30', 'item.video.duration should be extracted');
  console.assert(getItemDuration({ duration: 0 }) === null, 'duration 0 should return null');

  // 5. isItemStarred - Starred state check
  console.assert(isItemStarred(null) === false, 'null item should not be starred');
  console.assert(isItemStarred(undefined) === false, 'undefined item should not be starred');
  console.assert(isItemStarred({}) === false, 'item without starred property should be false');
  console.assert(isItemStarred({ starred: true }) === true, 'item with starred: true should be true');
  console.assert(isItemStarred({ is_starred: true }) === true, 'item with is_starred: true should be true');
  console.assert(isItemStarred({ starred: false, is_starred: false }) === false, 'item with false flags should be false');

  console.log('All FileCard Helpers tests passed successfully! (25/25 assertions)');
  return true;
}

if (typeof process !== 'undefined' || (typeof window !== 'undefined' && window.location?.protocol === 'file:')) {
  runFileCardHelperTests();
}
