import pg from 'pg';
import nodemailer from 'nodemailer';

// Only reviewed, independently supported qualifications are deliverable.
// The existing notification outbox contains test fixtures; never drain it blindly.
const required = name => { const value = process.env[name]; if (!value) throw new Error('missing_' + name); return value; };
export async function deliver() {
  const url = required('SUPABASE_SESSION_POOLER_URL');
  const host = required('ALERT_SMTP_HOST');
  const user = required('ALERT_SMTP_USER');
  const pass = required('ALERT_SMTP_PASSWORD');
  const from = required('ALERT_EMAIL_FROM');
  const to = required('ALERT_EMAIL_TO');
  if (to !== 'warriorniner74@gmail.com') throw new Error('recipient_not_allowlisted');
  const client = new pg.Client({connectionString:url,connectionTimeoutMillis:8000});
  const transport = nodemailer.createTransport({host,port:587,secure:false,requireTLS:true,auth:{user,pass},tls:{minVersion:'TLSv1.2'}});
  await client.connect();
  try {
    // Deliberately no automatic historical backfill; only independently verified
    // research qualifications that were created in the last 24 hours.
    const {rows} = await client.query(`
      SELECT q.qualification_key, q.issuer_resolution, q.impact_assessment,
             q.updated_at, e.original_name, e.event_time, e.source_url
      FROM catalyst_acceptance.research_qualifications q
      JOIN catalyst_acceptance.events e
        ON e.engine=q.engine AND e.source=q.source
       AND e.source_event_id=q.source_event_id
      WHERE q.alert_eligible=true AND q.stage='alert_eligible'
        AND q.updated_at >= now()-interval '24 hours'
        AND q.engine='government' AND q.source LIKE 'luxalgo%'
      ORDER BY q.updated_at ASC LIMIT 10
    `);
    console.log(JSON.stringify({phase:'eligible_count',count:rows.length}));
    // Fail closed: delivery ledger is required before sending real signals.
    // No alert is sent until durable per-recipient idempotency is implemented.
    if (rows.length) throw new Error('delivery_ledger_not_configured');
    if (process.env.ALERT_TEST_ONLY === 'true') {
      const result = await transport.sendMail({
        from,to,subject:'[STOCK-CATALYST] DIRECT SMTP DELIVERY TEST',
        text:'This is a direct SMTP transport test. No stock catalyst has been qualified or alerted.'
      });
      console.log(JSON.stringify({phase:'smtp_test_sent',accepted:result.accepted.length}));
    }
  } finally { await client.end(); transport.close(); }
}
if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  deliver().catch(e=>{console.error(JSON.stringify({phase:'delivery_error',code:e.message}));process.exitCode=1;});
}
