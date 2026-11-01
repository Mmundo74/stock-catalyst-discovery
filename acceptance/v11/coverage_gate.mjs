// Fail-closed coverage accounting for independent discovery source pages.
// Pure acceptance helper; it never schedules collectors or writes checkpoints.
export function assessDiscoveryPage({ sourceKey, cursorIn = null, cursorOut = null,
  expectedCount = null, records = [], truncated = false, errors = [], providerComplete = false }) {
  if (typeof sourceKey !== 'string' || !sourceKey || !Array.isArray(records) || !Array.isArray(errors)) {
    throw new TypeError('invalid_page');
  }
  const ids = records.map(record => record?.sourceEventId);
  const missingIds = ids.some(id => typeof id !== 'string' || !id);
  const duplicates = ids.length - new Set(ids).size;
  const countMismatch = expectedCount !== null &&
    (!Number.isSafeInteger(expectedCount) || expectedCount !== records.length);
  const cursorLoop = cursorOut !== null && cursorOut === cursorIn;
  const incomplete = truncated || errors.length > 0 || missingIds || duplicates > 0 || countMismatch || cursorLoop;
  const safeToCommitPage = !incomplete;
  const sourceComplete = safeToCommitPage && cursorOut === null && providerComplete === true;
  return {
    sourceKey, cursorIn, cursorOut, recordsSeen: records.length, duplicates, missingIds,
    countMismatch, cursorLoop, safeToCommitPage, sourceComplete,
    checkpointCandidate: safeToCommitPage && cursorOut !== null ? cursorOut : null,
    reasons: [truncated && 'truncated', errors.length > 0 && 'source_errors', missingIds && 'missing_ids',
      duplicates > 0 && 'duplicate_ids', countMismatch && 'count_mismatch', cursorLoop && 'cursor_loop',
      !providerComplete && cursorOut === null && 'terminal_unverified'].filter(Boolean),
  };
}
