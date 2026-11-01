/** Offline, source-bounded 2026 Nasdaq US equity baseline. Not exchange feed validation or trading guarantee.
 * Explicitly separates the regular session from unverified early-close extended hours and overnight sessions.
 */
const SOURCE='https://www.nasdaq.com/market-activity/stock-market-holiday-schedule';
const HOLIDAYS=new Set(['2026-01-01','2026-01-19','2026-02-16','2026-04-03','2026-05-25','2026-06-19','2026-07-03','2026-09-07','2026-11-26','2026-12-25']);
const EARLY_CLOSE=new Set(['2026-11-27','2026-12-24']);
const fmt=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',weekday:'short',hourCycle:'h23'});
function etPart(instant) {
 const d=new Date(instant);
 if(Number.isNaN(d.valueOf())) throw Error('invalid_utc_time');
 const p=Object.fromEntries(fmt.formatToParts(d).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
 return {date:`${p.year}-${p.month}-${p.day}`, minute:Number(p.hour)*60+Number(p.minute), weekday:p.weekday,local_time:`${p.hour}:${p.minute}`};
}
function validateDate(date) {
 if(!/^\d{4}-\d\d-\d\d$/.test(date) || new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date) throw Error('invalid_date');
}
export function sessionDay(date) {
 validateDate(date);
 const w=new Date(date+'T12:00:00Z').getUTCDay();
 const reference={source:SOURCE,year:2026,venue:'Nasdaq U.S. equities (baseline, not all trading venues)'};
 if(!date.startsWith('2026-'))return {date,category:'calendar_unverified',source:reference};
 if(w===0||w===6)return {date,category:'weekend_closed',source:reference};
 if(HOLIDAYS.has(date))return {date,category:'holiday_closed',source:reference};
 if(EARLY_CLOSE.has(date))return {date,category:'early_close',regular_start_et:'09:30',regular_end_et:'13:00',extended_after_close:'unverified',source:reference};
 return {date,category:'regular_day',premarket_start_et:'04:00',regular_start_et:'09:30',regular_end_et:'16:00',postmarket_end_et:'20:00',source:reference};
}
export function classifyUtcTimestamp(utc) {
 const et=etPart(utc), day=sessionDay(et.date);
 let session;
 if(day.category==='calendar_unverified')session='calendar_unverified';
 else if(day.category==='weekend_closed'||day.category==='holiday_closed')session=day.category;
 else if(et.minute<240||et.minute>=1200)session='outside_documented_day_session';
 else if(et.minute<570)session='premarket';
 else if(et.minute<(day.category==='early_close'?780:960))session='regular';
 else if(day.category==='early_close')session='early_close_extended_unverified';
 else session='afterhours';
 return {utc:new Date(utc).toISOString(),date_et:et.date,time_et:et.local_time,session,calendar_day:day.category,
   outside_session_note:session==='outside_documented_day_session'?'Overnight trading or alternate venues may exist; not evaluated by the baseline':null};
}
// Counts windows whose presence is supported by the cited Nasdaq 2026 calendar.
// The early-close after-hours window is NOT inferred from standard market hours.
export function expectedMinutes(date) {
 const day=sessionDay(date);
 if(day.category==='calendar_unverified')return {date,known:[],unknown:['entire_day'],source:day.source};
 if(day.category==='weekend_closed'||day.category==='holiday_closed')return {date,known:[],unknown:[],source:day.source};
 const windows=[{name:'premarket',start:240,end:570},{name:'regular',start:570,end:day.category==='early_close'?780:960}];
 if(day.category==='regular_day')windows.push({name:'afterhours',start:960,end:1200});
 return {date,known:windows,unknown:day.category==='early_close'?['early_close_extended_hours']:[],source:day.source};
}
export function auditMinuteWindows({date,observedEtMinuteIndices=[]}={}) {
 const expectation=expectedMinutes(date);
 const knownMinutes=new Set(expectation.known.flatMap(w=>Array.from({length:w.end-w.start},(_,i)=>w.start+i)));
 const observed=new Set(),duplicates=[],outOfWindow=[];
 for(const n of observedEtMinuteIndices) {
   if(!Number.isInteger(n)||n<0||n>=1440){outOfWindow.push(n);continue;}
   if(observed.has(n)){duplicates.push(n);continue;}
   observed.add(n);
   if(!knownMinutes.has(n))outOfWindow.push(n);
 }
 const missing=[...knownMinutes].filter(n=>!observed.has(n));
 return {date,documented_expected_minute_count:knownMinutes.size,
   observed_documented_minute_count:[...observed].filter(n=>knownMinutes.has(n)).length,
   missing_count:missing.length,missing_minute_indices:missing,
   duplicate_minute_indices:duplicates,unclassified_observed_minute_indices:outOfWindow,
   unknown_windows:expectation.unknown,
   limitations:['This audits scan timing ONLY, not ticker coverage, completeness of price observations, or provider availability',
    'Overnight or alternate-venue trading is outside the validated schedule and must be audited separately']};
}
export function budgetForTradingDays({normalDays,earlyCloseDays=0,allowedCalls=10000,pagesPerScan=1}={}) {
 if(![normalDays,earlyCloseDays,allowedCalls,pagesPerScan].every(Number.isInteger) || [normalDays,earlyCloseDays,allowedCalls].some(x=>x<0)||pagesPerScan<1)throw Error('invalid_budget_inputs');
 const documentedMinutes=960*normalDays+540*earlyCloseDays;
 return {documentedMinutes,minimumCallsIfEveryMinute:documentedMinutes*pagesPerScan,
   allowance:allowedCalls,shortfall:Math.max(0,documentedMinutes*pagesPerScan-allowedCalls),
   limitations:['Excludes retries, extras, and unverified early-close after-hours or overnight trading',
    'Does not establish complete market-wide instrument coverage from a single scan']};
}
