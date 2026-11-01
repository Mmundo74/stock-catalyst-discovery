/** Pure fail-closed checkpoint gate. A coverage report is evidence, not a commit authorization. */
export function decideCheckpoint({previousCursor,proposedCursor,runId,sourceKey,coverage,commitReceipt,quarantined=0}={}) {
 const reasons=[];
 if(typeof sourceKey!=='string'||!sourceKey.trim()||typeof runId!=='string'||!runId.trim())reasons.push('invalid_identity');
 if(typeof previousCursor!=='string'||typeof proposedCursor!=='string'||!proposedCursor.trim())reasons.push('invalid_cursor');
 if(!coverage||coverage.run_id!==runId)reasons.push('coverage_run_mismatch');
 if(!coverage||coverage.coverage_status!=='all_declared_instruments_observed_not_signal_validated')reasons.push('coverage_unverified');
 const pageLists=['unsuccessful_pages','missing_pages','issues'];
 const validPageLists=!!coverage&&pageLists.every(key=>Array.isArray(coverage[key]));
 if(!validPageLists)reasons.push('coverage_shape_unverified');
 else if(pageLists.some(key=>coverage[key].length>0))reasons.push('page_failure');
 if(!Number.isInteger(quarantined)||quarantined<0||quarantined>0)reasons.push('quarantine_unresolved');
 if(!commitReceipt||commitReceipt.runId!==runId||commitReceipt.sourceKey!==sourceKey||commitReceipt.durable!==true||commitReceipt.transactionCommitted!==true)reasons.push('durable_commit_unverified');
 if(commitReceipt?.outboxCommitted!==true)reasons.push('outbox_unverified');
 if(commitReceipt?.checkpointInSameTransaction!==true)reasons.push('checkpoint_atomicity_unverified');
 // Lexical cursor ordering is unsafe for opaque provider tokens; equality only is detectable.
 if(previousCursor===proposedCursor)reasons.push('no_cursor_progress');
 return {eligible:reasons.length===0,reasons:[...new Set(reasons)],sourceKey,runId,previousCursor,proposedCursor,warning:'This is a preflight evidence gate, not proof of PostgreSQL atomicity or external delivery.'};
}
