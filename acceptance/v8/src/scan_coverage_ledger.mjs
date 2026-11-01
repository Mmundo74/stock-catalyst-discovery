/** Offline market-wide scan coverage audit. Never equates a 200 response with full exchange coverage. */
import {classifyUtcTimestamp} from './us_equity_session_calendar.mjs';
export function auditScanPages({runId,requestedAt,expectedPages,pages,universeSize=null}={}) {
 if(typeof runId!=='string'||!runId.trim()||!Number.isInteger(expectedPages)||expectedPages<1||!Array.isArray(pages))throw Error('invalid_run');
 const requestMs=Date.parse(requestedAt);
 if(typeof requestedAt!=='string'||!Number.isFinite(requestMs)||!/^\d{4}-\d\d-\d\dT/.test(requestedAt))throw Error('invalid_requested_at');
 if(universeSize!==null&&(!Number.isInteger(universeSize)||universeSize<0))throw Error('invalid_universe_size');
 const session=classifyUtcTimestamp(requestedAt);
 const encountered=new Set(),successful=new Set(),issues=[],instruments=new Set();let nullSignals=0,stale=0,duplicateInstruments=0,invalidRows=0;
 for(const p of pages){
  if(!p||!Number.isInteger(p.page)||p.page<1||p.page>expectedPages){issues.push('invalid_page');continue;}
  if(encountered.has(p.page)){issues.push('duplicate_page');continue;}
  encountered.add(p.page);
  if(p.httpStatus!==200||!Array.isArray(p.rows)){issues.push('failed_page');continue;}
  successful.add(p.page);
  for(const row of p.rows){
   if(!row||typeof row.symbol!=='string'||!row.symbol.trim()){issues.push('invalid_instrument');invalidRows++;continue;}
   const symbol=row.symbol.trim();
   if(instruments.has(symbol)){issues.push('duplicate_instrument');duplicateInstruments++;}
   instruments.add(symbol);
   if(row.signal===null||row.signal===undefined)nullSignals++;
   const t=typeof row.priceAsOf==='string'?Date.parse(row.priceAsOf):NaN;
   if(!Number.isFinite(t)||t>requestMs||requestMs-t>5*60*1000)stale++;
  }
 }
 const missingPages=Array.from({length:expectedPages},(_,i)=>i+1).filter(i=>!encountered.has(i));
 const unsuccessfulPages=Array.from({length:expectedPages},(_,i)=>i+1).filter(i=>!successful.has(i));
 if(missingPages.length)issues.push('missing_pages');
 if(universeSize!==null&&instruments.size>universeSize)issues.push('universe_count_conflict');
 const unresolved=issues.length>0||nullSignals>0||stale>0||universeSize===null||instruments.size!==universeSize;
 return {run_id:runId,requested_at:new Date(requestMs).toISOString(),session:session.session,
 expected_pages:expectedPages,received_page_count:encountered.size,successful_page_count:successful.size,
 missing_pages:missingPages,unsuccessful_pages:unsuccessfulPages,
 unique_instruments_observed:instruments.size,duplicate_instrument_rows:duplicateInstruments,invalid_instrument_rows:invalidRows,
 declared_universe_size:universeSize,null_signal_rows:nullSignals,stale_or_invalid_price_rows:stale,
 issues:[...new Set(issues)],coverage_status:unresolved?'incomplete_or_unverified':'all_declared_instruments_observed_not_signal_validated',
 checkpoint_eligible:false,
 note:'Matching declared universe counts do not establish exchange-wide coverage or signal history. Failed pages remain unsuccessful even when a page number was received.'};
}
