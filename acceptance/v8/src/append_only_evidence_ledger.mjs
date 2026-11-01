/** Offline append-only evidence ledger codec. Caller owns durable storage/fsync and backups. */
import {createHash} from 'node:crypto';
const digest = value => createHash('sha256').update(value).digest('hex');
const stable = value => JSON.stringify(value);
export function appendEvidenceRecord(existingText, event) {
 const prior = replayEvidenceLedger(existingText);
 if (!prior.ok) throw Error('ledger_corrupt');
 if (!event || typeof event !== 'object' || Array.isArray(event) || typeof event.id !== 'string' || !event.id.trim() || typeof event.source !== 'string' || !event.source.trim() || typeof event.occurred_at !== 'string' || !Number.isFinite(Date.parse(event.occurred_at))) throw Error('invalid_event');
 if (prior.records.some(x => x.event.id === event.id)) throw Error('duplicate_event_id');
 const payload = {sequence: prior.records.length + 1, previous_hash:prior.last_hash, event};
 const record = {...payload,hash:digest(stable(payload))};
 return {text:existingText + JSON.stringify(record) + '\n', record};
}
export function replayEvidenceLedger(text) {
 if (typeof text !== 'string') return {ok:false,error:'invalid_input'};
 const records=[]; let previous='GENESIS';
 if (!text) return {ok:true,records,last_hash:previous};
 if (!text.endsWith('\n')) return {ok:false,error:'partial_tail',valid_records:0};
 const lines=text.slice(0,-1).split('\n');
 for (let i=0;i<lines.length;i++) {
  let record;
  try {record=JSON.parse(lines[i]);} catch {return {ok:false,error:'invalid_json',valid_records:i};}
  if (!record || typeof record!=='object' || Array.isArray(record) || Object.keys(record).sort().join(',')!=='event,hash,previous_hash,sequence' || record.sequence!==i+1 || record.previous_hash!==previous || typeof record.hash!=='string' || record.hash!==digest(stable({sequence:record.sequence,previous_hash:record.previous_hash,event:record.event}))) return {ok:false,error:'broken_chain',valid_records:i};
  if (!record.event || typeof record.event.id!=='string' || !record.event.id.trim() || typeof record.event.source!=='string' || !record.event.source.trim() || !Number.isFinite(Date.parse(record.event.occurred_at)) || records.some(x=>x.event.id===record.event.id)) return {ok:false,error:'invalid_or_duplicate_event',valid_records:i};
  records.push(record);previous=record.hash;
 }
 return {ok:true,records,last_hash:previous};
}
