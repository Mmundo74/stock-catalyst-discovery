import { randomUUID } from 'node:crypto';

const CLAIM_SQL = `
WITH candidates AS (
  SELECT idempotency_key
  FROM catalyst_acceptance.notification_outbox
  WHERE idempotency_key = ANY($1::text[])
    AND (state = 'pending' OR (state = 'processing' AND lease_expires_at <= clock_timestamp()))
  ORDER BY created_at, idempotency_key
  LIMIT $2
  FOR UPDATE SKIP LOCKED
), claimed AS (
  UPDATE catalyst_acceptance.notification_outbox AS outbox
  SET state = 'processing', claim_token = $3::uuid,
      lease_expires_at = clock_timestamp() + ($4::int * interval '1 millisecond'),
      attempts = attempts + 1, last_error = NULL
  FROM candidates
  WHERE outbox.idempotency_key = candidates.idempotency_key
  RETURNING outbox.*
)
SELECT claimed.idempotency_key, claimed.engine, claimed.source, claimed.source_event_id,
       claimed.fingerprint, claimed.attempts, claimed.claim_token, claimed.lease_expires_at,
       jsonb_build_object(
         'engine', events.engine, 'source', events.source,
         'source_event_id', events.source_event_id, 'original_name', events.original_name,
         'event_time', events.event_time, 'observed_at', events.observed_at,
         'source_url', events.source_url, 'event_fingerprint', events.fingerprint,
         'source_payload', events.source_payload, 'revision_payload', revisions.original_payload
       ) AS payload
FROM claimed
JOIN catalyst_acceptance.events AS events
  ON events.engine = claimed.engine AND events.source = claimed.source
 AND events.source_event_id = claimed.source_event_id
JOIN catalyst_acceptance.event_revisions AS revisions
  ON revisions.engine = claimed.engine AND revisions.source = claimed.source
 AND revisions.source_event_id = claimed.source_event_id AND revisions.fingerprint = claimed.fingerprint;
`;

function validateKeys(idempotencyKeys) {
  if (!Array.isArray(idempotencyKeys) || idempotencyKeys.length < 1 || idempotencyKeys.length > 100 ||
      idempotencyKeys.some(key => typeof key !== 'string' || key.length < 1 || key.length > 512) ||
      new Set(idempotencyKeys).size !== idempotencyKeys.length) {
    throw new TypeError('invalid_idempotency_keys');
  }
}

function validateWorkerToken(workerToken) {
  if (typeof workerToken !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(workerToken)) {
    throw new TypeError('invalid_worker_token');
  }
}

function validateErrorCode(errorCode) {
  if (typeof errorCode !== 'string' || errorCode.length > 120 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(errorCode)) {
    throw new TypeError('invalid_error_code');
  }
}

export async function claimOutboxItems(client, {
  idempotencyKeys, limit, leaseMs = 60_000, workerToken = randomUUID(),
} = {}) {
  validateKeys(idempotencyKeys);
  validateWorkerToken(workerToken);
  const boundedLimit = limit ?? Math.min(10, idempotencyKeys.length);
  if (!Number.isSafeInteger(boundedLimit) || boundedLimit < 1 || boundedLimit > Math.min(100, idempotencyKeys.length)) throw new TypeError('invalid_claim_limit');
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 1_000 || leaseMs > 3_600_000) throw new TypeError('invalid_lease_ms');
  const { rows } = await client.query(CLAIM_SQL, [idempotencyKeys, boundedLimit, workerToken, leaseMs]);
  return { workerToken, items: rows };
}

export async function acknowledgeOutboxItem(client, { idempotencyKey, workerToken } = {}) {
  if (typeof idempotencyKey !== 'string' || !idempotencyKey) throw new TypeError('invalid_idempotency_key');
  validateWorkerToken(workerToken);
  const { rowCount } = await client.query(`
    UPDATE catalyst_acceptance.notification_outbox
    SET state='sent', claim_token=NULL, lease_expires_at=NULL, delivered_at=clock_timestamp(), last_error=NULL
    WHERE idempotency_key=$1 AND state='processing' AND claim_token=$2::uuid
      AND lease_expires_at > clock_timestamp()
  `, [idempotencyKey, workerToken]);
  if (rowCount !== 1) throw new Error('outbox_claim_lost');
}

export async function releaseOutboxItem(client, {
  idempotencyKey, workerToken, errorCode, permanent = false,
} = {}) {
  if (typeof idempotencyKey !== 'string' || !idempotencyKey) throw new TypeError('invalid_idempotency_key');
  validateWorkerToken(workerToken);
  validateErrorCode(errorCode);
  const state = permanent ? 'failed' : 'pending';
  const { rowCount } = await client.query(`
    UPDATE catalyst_acceptance.notification_outbox
    SET state=$3, claim_token=NULL, lease_expires_at=NULL, last_error=$4
    WHERE idempotency_key=$1 AND state='processing' AND claim_token=$2::uuid
      AND lease_expires_at > clock_timestamp()
  `, [idempotencyKey, workerToken, state, errorCode]);
  if (rowCount !== 1) throw new Error('outbox_claim_lost');
}
