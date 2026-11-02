import { createHash } from 'node:crypto';
import { acknowledgeOutboxItem, releaseOutboxItem } from '../v12/outbox_worker.mjs';
import { isFreshEvidence, isFreshTimestamp, isIndependentEvidence } from '../v13/research_qualification.mjs';

const isSha256 = value => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
const isHttps = value => typeof value === 'string' && /^https:\/\//i.test(value);

function requireEligible(item, qualification) {
  if (!item || typeof item.idempotency_key !== 'string' || !item.idempotency_key ||
      item.idempotency_key.length > 512) throw new TypeError('invalid_outbox_item');
  if (!qualification || qualification.stage !== 'alert_eligible' || qualification.alert_eligible !== true) {
    throw new Error('qualification_not_alert_eligible');
  }
  if (qualification.engine !== item.engine || qualification.source !== item.source ||
      qualification.source_event_id !== item.source_event_id ||
      qualification.fingerprint !== item.fingerprint) throw new Error('qualification_event_mismatch');
  const issuer = qualification.issuer_resolution?.issuer;
  if (qualification.issuer_resolution?.status !== 'cross_correlated' || !issuer?.ticker || !issuer?.cik ||
      !issuer?.legal_name || !issuer?.exchange) throw new Error('verified_issuer_required');
  if (qualification.parent_relationship?.status !== 'verified_primary_document' ||
      qualification.parent_relationship?.review?.approved !== true) throw new Error('verified_parent_review_required');
  if (qualification.review?.approved !== true || !qualification.impact_assessment) throw new Error('review_and_impact_required');
  if (qualification.review.independentEvidenceConfirmed !== true) throw new Error('evidence_independence_review_required');
  const evidence = qualification.supporting_evidence;
  if (!Array.isArray(evidence) || evidence.length < 2 || evidence.some(x => !isHttps(x?.url) || !isSha256(x?.sha256)) ||
      !isIndependentEvidence(evidence) || new Set(evidence.map(x => x.url)).size !== evidence.length ||
      new Set(evidence.map(x => x.sha256.toLowerCase())).size !== evidence.length || !isFreshEvidence(evidence)) {
    throw new Error('independent_evidence_required');
  }
  if (!isFreshTimestamp(qualification.impact_assessment.assessedAt) ||
      !isFreshTimestamp(qualification.review.reviewedAt) ||
      !isFreshTimestamp(qualification.parent_relationship.review.reviewedAt)) {
    throw new Error('qualification_evidence_stale');
  }
}

export function buildMakeAlertPayload({ item, qualification } = {}) {
  requireEligible(item, qualification);
  const payload = {
    schema_version: 'scd.alert.v1', idempotency_key: item.idempotency_key,
    event: { engine: item.engine, source: item.source, source_event_id: item.source_event_id,
      fingerprint: item.fingerprint, original_name: item.original_name, event_time: item.event_time,
      observed_at: item.observed_at, source_url: item.source_url ?? null },
    issuer: qualification.issuer_resolution.issuer, parent_relationship: qualification.parent_relationship,
    impact_assessment: qualification.impact_assessment,
    evidence: qualification.supporting_evidence.map(({sourceName,url,sha256,sourceTimestamp,originalName}) =>
      ({sourceName,url,sha256,sourceTimestamp:sourceTimestamp ?? null,originalName:originalName ?? null})),
  };
  const body = JSON.stringify(payload);
  return Object.freeze({ payload: Object.freeze(payload), payloadSha256: createHash('sha256').update(body).digest('hex'), body });
}

/** Dry-run is default. Live POST needs caller and environment opt-ins; receiver dedupe is still required. */
export async function deliverMakeAlert({ item, qualification, endpoint, enabled = false,
  fetchImpl = globalThis.fetch, timeoutMs = 10_000 } = {}) {
  const prepared = buildMakeAlertPayload({item,qualification});
  if (!enabled) return { delivered:false, mode:'dry_run', idempotencyKey:item.idempotency_key,
    payloadSha256:prepared.payloadSha256, payload:prepared.payload };
  if (process.env.SCD_NOTIFICATION_DELIVERY_ENABLED !== 'true') throw new Error('delivery_environment_opt_in_required');
  if (!isHttps(endpoint) || typeof fetchImpl !== 'function') throw new TypeError('secure_delivery_endpoint_required');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30000) throw new TypeError('invalid_delivery_timeout');
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(endpoint, {method:'POST',headers:{'content-type':'application/json',
      'idempotency-key':item.idempotency_key},body:prepared.body,signal:controller.signal});
    if (!response?.ok) throw new Error('delivery_http_' + (Number(response?.status) || 'unknown'));
    return {delivered:true,mode:'live',idempotencyKey:item.idempotency_key,payloadSha256:prepared.payloadSha256,
      receiverStatus:response.status};
  } finally { clearTimeout(timer); }
}

/** Existing explicit-key/lease worker supplies claims and fences ack; lost ack can retry. */
export async function dispatchClaimedOutboxItem({ client, item, workerToken, endpoint,
  enabled = false, fetchImpl = globalThis.fetch, timeoutMs = 10_000 } = {}) {
  if (!enabled) return { delivered:false, mode:'dry_run', idempotencyKey:item?.idempotency_key ?? null };
  if (process.env.SCD_NOTIFICATION_DELIVERY_ENABLED !== 'true') throw new Error('delivery_environment_opt_in_required');
  if (!client || typeof client.query !== 'function' || !item || item.claim_token !== workerToken ||
      !item.idempotency_key || !item.source_event_id || !item.fingerprint) throw new TypeError('live_claim_reference_required');
  const claim = await client.query('SELECT 1 FROM catalyst_acceptance.notification_outbox WHERE idempotency_key=$1 AND state=\'processing\' AND claim_token=$2::uuid AND lease_expires_at > clock_timestamp()',[item.idempotency_key,workerToken]);
  if (claim.rowCount !== 1) throw new Error('outbox_claim_lost');
  const { rows } = await client.query('SELECT engine,source,source_event_id,fingerprint,stage,alert_eligible,issuer_resolution,parent_relationship,impact_assessment,review,supporting_evidence FROM catalyst_acceptance.research_qualifications WHERE engine=$1 AND source=$2 AND source_event_id=$3 AND fingerprint=$4 ORDER BY updated_at DESC LIMIT 1',[item.engine,item.source,item.source_event_id,item.fingerprint]);
  const qualification = rows?.[0];
  if (!qualification || qualification.stage !== 'alert_eligible' || qualification.alert_eligible !== true) {
    await releaseOutboxItem(client,{idempotencyKey:item.idempotency_key,workerToken,errorCode:'qualification.not_eligible',permanent:true});
    return {delivered:false,mode:'blocked',reason:'qualification_not_alert_eligible'};
  }
  const preparedItem = {...item,...(item.payload ?? {})}; let receipt;
  try { receipt = await deliverMakeAlert({item:preparedItem,qualification,endpoint,enabled:true,fetchImpl,timeoutMs}); }
  catch (error) {
    const code = /^[A-Za-z0-9._:-]{1,100}$/.test(error?.message ?? '') ? error.message : 'delivery.transport_error';
    await releaseOutboxItem(client,{idempotencyKey:item.idempotency_key,workerToken,errorCode:code,
      permanent:/^delivery_http_4\d\d$/.test(code)});
    throw error;
  }
  await acknowledgeOutboxItem(client,{idempotencyKey:item.idempotency_key,workerToken}); return receipt;
}
