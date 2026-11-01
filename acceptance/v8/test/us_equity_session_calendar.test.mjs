import test from 'node:test';
import assert from 'node:assert/strict';
import {sessionDay,classifyUtcTimestamp,expectedMinutes,auditMinuteWindows,budgetForTradingDays} from '../src/us_equity_session_calendar.mjs';
const classify=x=>classifyUtcTimestamp(x).session;
test('market closure New Year 2026',()=>assert.equal(sessionDay('2026-01-01').category,'holiday_closed'));
test('July 3 observed Independence Day 2026 closed',()=>assert.equal(sessionDay('2026-07-03').category,'holiday_closed'));
test('Good Friday 2026 closed',()=>assert.equal(sessionDay('2026-04-03').category,'holiday_closed'));
test('Saturday closed',()=>assert.equal(sessionDay('2026-11-07').category,'weekend_closed'));
test('ordinary Monday open',()=>assert.equal(sessionDay('2026-11-02').category,'regular_day'));
test('Nov 27 early close at 13:00 eastern',()=>assert.equal(sessionDay('2026-11-27').regular_end_et,'13:00'));
test('Dec 24 early close at 13:00 eastern',()=>assert.equal(sessionDay('2026-12-24').category,'early_close'));
test('2027 outside documented calendar fails closed',()=>assert.equal(sessionDay('2027-01-04').category,'calendar_unverified'));
test('before daylight savings transition 9:30 AM ET is 14:30Z',()=>assert.equal(classify('2026-03-06T14:30:00Z'),'regular'));
test('after spring DST transition 9:30 AM ET is 13:30Z',()=>assert.equal(classify('2026-03-09T13:30:00Z'),'regular'));
test('before autumn DST transition 9:30 AM ET is 13:30Z',()=>assert.equal(classify('2026-10-30T13:30:00Z'),'regular'));
test('after autumn DST transition 9:30 AM ET is 14:30Z',()=>assert.equal(classify('2026-11-02T14:30:00Z'),'regular'));
test('premarket 04:00 EDT',()=>assert.equal(classify('2026-08-03T08:00:00Z'),'premarket'));
test('after-hours 16:00 EDT',()=>assert.equal(classify('2026-08-03T20:00:00Z'),'afterhours'));
test('after 20:00 ET is not falsely classified as no trading worldwide',()=>assert.equal(classify('2026-08-04T00:00:00Z'),'outside_documented_day_session'));
test('early close after 13:00 is unverified, not an automatic post-market claim',()=>assert.equal(classify('2026-11-27T18:00:00Z'),'early_close_extended_unverified'));
test('early close documented minimum only 540 minutes',()=>{const v=expectedMinutes('2026-11-27');assert.equal(v.known.reduce((n,w)=>n+w.end-w.start,0),540);assert.deepEqual(v.unknown,['early_close_extended_hours']);});
test('normal 4am-8pm baseline includes 960 minutes',()=>assert.equal(expectedMinutes('2026-11-02').known.reduce((n,w)=>n+w.end-w.start,0),960));
test('holiday does not impose a fake 960-minute scan window',()=>assert.equal(expectedMinutes('2026-11-26').known.length,0));
test('minute audit flags holes, duplicates and unclassified observations',()=>{
 const a=auditMinuteWindows({date:'2026-11-02',observedEtMinuteIndices:[240,240,241,1201,-1]});
 assert.equal(a.documented_expected_minute_count,960);assert.equal(a.missing_count,958);assert.deepEqual(a.duplicate_minute_indices,[240]);assert.equal(a.unclassified_observed_minute_indices.length,2);
});
test('full documented minute coverage is unconditionally visible, not claimed complete market coverage',()=>{
 const a=auditMinuteWindows({date:'2026-11-02',observedEtMinuteIndices:Array.from({length:960},(_,i)=>i+240)});
 assert.equal(a.missing_count,0);assert(a.limitations.some(x=>/not/i.test(x)));
});
test('minute budget 22 normal days 21120 calls exceeds 10000',()=>{
 const x=budgetForTradingDays({normalDays:22});assert.equal(x.minimumCallsIfEveryMinute,21120);assert.equal(x.shortfall,11120);
});
test('two-page scan doubles nominal call requirement',()=>assert.equal(budgetForTradingDays({normalDays:22,pagesPerScan:2}).minimumCallsIfEveryMinute,42240));
test('unknown-year date not treated as market-open',()=>assert.equal(classify('2027-01-04T15:00:00Z'),'calendar_unverified'));
test('bad date rejected',()=>assert.throws(()=>sessionDay('2026-02-31'),/invalid_date/));
