const TICKER = /^[A-Z0-9][A-Z0-9.\-^]{0,18}$/;
const ISO = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
export const EVIDENCE_FRESHNESS_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function isFreshTimestamp(value, { now = new Date(), maxAgeMs = EVIDENCE_FRESHNESS_MAX_AGE_MS } = {}) {
  if (!ISO(value)) return false;
  const nowMs = now instanceof Date ? now.getTime() : typeof now === 'string' ? Date.parse(now) : NaN;
  const timestampMs = Date.parse(value);
  return Number.isFinite(nowMs) && Number.isSafeInteger(maxAgeMs) && maxAgeMs > 0 &&
    timestampMs <= nowMs && timestampMs >= nowMs - maxAgeMs;
}

export function isFreshEvidence(items, options = {}) {
  return Array.isArray(items) && items.length >= 2 &&
    items.every(item => isFreshTimestamp(item?.sourceTimestamp, options));
}

function assertEvent(event) {
  if (!event || !['government', 'news', 'market'].includes(event.engine) ||
      !event.source || !event.sourceEventId || !event.fingerprint || !sha(event.fingerprint)) {
    throw new TypeError('invalid_event_reference');  }
}

export function isIndependentEvidence(items) {
  if (!Array.isArray(items) || items.length < 2) return false;
  const hosts = [];
  const sourceNames = [];
  try {
    for (const item of items) {
      const host = new URL(item.url).hostname.toLowerCase().replace(/^www\./, '');
      const sourceName = String(item.sourceName ?? '').trim().toLowerCase();
      if (!host || !sourceName) return false;
      hosts.push(host);
      sourceNames.push(sourceName);
    }
  } catch { return false; }
  return new Set(hosts).size === items.length && new Set(sourceNames).size === items.length;
}



function preserveEvidence(items) {
  if (!Array.isArray(items) || items.length === 0) throw new TypeError('supporting_evidence_required');
  const result = items.map(item => {
    if (!item || typeof item.url !== 'string' || !/^https:\/\//i.test(item.url) ||
        !sha(item.sha256) || !ISO(item.retrievedAt) ||
        (item.sourceTimestamp !== null && item.sourceTimestamp !== undefined && !ISO(item.sourceTimestamp))) {
      throw new TypeError('invalid_supporting_evidence');
    }
    return Object.freeze({
      sourceName: String(item.sourceName ?? '').slice(0, 240),
      url: item.url,
      sha256: item.sha256.toLowerCase(),
      retrievedAt: new Date(item.retrievedAt).toISOString(),
      sourceTimestamp: item.sourceTimestamp ? new Date(item.sourceTimestamp).toISOString() : null,
      originalName: String(item.originalName ?? '').slice(0, 500),
      rawEvidence: item.rawEvidence ?? null,
    });
  });
  if (new Set(result.map(item => item.url)).size !== result.length ||
      new Set(result.map(item => item.sha256)).size !== result.length) {
    throw new TypeError('duplicate_supporting_evidence');
  }
  return result;
}

/**
 * Pure fail-closed bridge from raw event + primary-source issuer correlation to
 * research and alert stages. It never sends notifications or mutates outbox.
 */
export function qualifyDiscovery({ event, issuerResolution, parentRelationship = null,
  impactAssessment = null, humanReview = null, evidence, now = new Date(),
  maxEvidenceAgeMs = EVIDENCE_FRESHNESS_MAX_AGE_MS } = {}) {
  const nowMs = now instanceof Date ? now.getTime() : typeof now === 'string' ? Date.parse(now) : NaN;
  if (!Number.isFinite(nowMs) || !Number.isSafeInteger(maxEvidenceAgeMs) || maxEvidenceAgeMs <= 0) {
    throw new TypeError('invalid_qualification_clock_or_freshness');
  }
  const checkedAt = new Date(nowMs);
  assertEvent(event);
  const supportingEvidence = preserveEvidence(evidence);
  const issuerCandidates = Array.isArray(issuerResolution?.candidates) ? issuerResolution.candidates : [];
  const exact = issuerResolution?.status === 'cross_correlated' ? issuerCandidates.filter(candidate =>
    candidate?.status === 'primary_source_cross_correlated' &&
    typeof candidate.cik === 'string' && /^\d{10}$/.test(candidate.cik) &&
    typeof candidate.ticker === 'string' && TICKER.test(candidate.ticker) &&
    typeof candidate.legal_name === 'string' && candidate.legal_name.trim() &&
    typeof candidate.exchange === 'string' && candidate.exchange.trim()) : [];
  const unique = new Map(exact.map(candidate => [`${candidate.cik}|${candidate.ticker}|${candidate.exchange}`, candidate]));
  const issuer = unique.size === 1 ? [...unique.values()][0] : null;
  const stage = issuer ? 'research_qualified' : 'raw_discovery';
  const parentReview = parentRelationship?.review;
  const parentReviewOK = parentReview?.approved === true &&
    typeof parentReview.reviewerId === 'string' && parentReview.reviewerId.trim() &&
    isFreshTimestamp(parentReview.reviewedAt, { now: checkedAt, maxAgeMs: maxEvidenceAgeMs });
  const parent = parentRelationship ? {
    childName: String(parentRelationship.childName ?? '').slice(0, 500),
    parentName: String(parentRelationship.parentName ?? '').slice(0, 500),
    status: parentRelationship.status === 'verified_primary_document' && parentReviewOK &&
      /^https:\/\//i.test(parentRelationship.sourceUrl ?? '') && sha(parentRelationship.sourceSha256) &&
      parentRelationship.transactionStatus === 'completed' ? 'verified_primary_document' : 'requires_review',
    sourceUrl: /^https:\/\//i.test(parentRelationship.sourceUrl ?? '') ? parentRelationship.sourceUrl : null,
    sourceSha256: sha(parentRelationship.sourceSha256) ? parentRelationship.sourceSha256.toLowerCase() : null,
    transactionStatus: String(parentRelationship.transactionStatus ?? 'unknown'),
    review: parentReviewOK ? { approved: true, reviewerId: parentReview.reviewerId.trim(),
      reviewedAt: new Date(parentReview.reviewedAt).toISOString() } : null,
  } : { status: 'unknown' };
  const impact = impactAssessment && typeof impactAssessment.rationale === 'string' &&
    impactAssessment.rationale.trim().length >= 20 &&
    ['positive', 'negative', 'mixed', 'unclear'].includes(impactAssessment.direction) ? {
      direction: impactAssessment.direction,
      rationale: impactAssessment.rationale.trim().slice(0, 4000),
      assessedAt: ISO(impactAssessment.assessedAt) ? new Date(impactAssessment.assessedAt).toISOString() : null,
    } : null;
  const reviewed = humanReview && humanReview.approved === true &&
    typeof humanReview.reviewerId === 'string' && humanReview.reviewerId.trim() &&
    ISO(humanReview.reviewedAt) && Date.parse(humanReview.reviewedAt) <= nowMs;
  const independentEvidence = isIndependentEvidence(supportingEvidence);
  const independenceReviewed = Boolean(reviewed && humanReview.independentEvidenceConfirmed === true);
  const freshEvidence = isFreshEvidence(supportingEvidence, { now: checkedAt, maxAgeMs: maxEvidenceAgeMs });
  const freshImpact = Boolean(impact && isFreshTimestamp(impact.assessedAt, { now: checkedAt, maxAgeMs: maxEvidenceAgeMs }));
  const freshReview = Boolean(reviewed && isFreshTimestamp(humanReview.reviewedAt, { now: checkedAt, maxAgeMs: maxEvidenceAgeMs }));
  const alertEligible = Boolean(issuer && impact && reviewed && independenceReviewed && independentEvidence && freshEvidence && freshImpact && freshReview &&
    parent.status !== 'requires_review' && parent.status !== 'unknown');
  return Object.freeze({
    event: Object.freeze({ engine: event.engine, source: event.source,
      sourceEventId: event.sourceEventId, fingerprint: event.fingerprint.toLowerCase() }),
    stage: alertEligible ? 'alert_eligible' : stage,
    alertEligible,
    issuer: issuer ? Object.freeze({ cik: issuer.cik, legalName: issuer.legal_name,
      ticker: issuer.ticker, exchange: issuer.exchange }) : null,
    issuerResolutionStatus: issuerResolution?.status ?? 'unverified',
    parentRelationship: Object.freeze(parent),
    impactAssessment: impact,
    review: reviewed ? Object.freeze({ approved: true, reviewerId: humanReview.reviewerId.trim(),
      reviewedAt: new Date(humanReview.reviewedAt).toISOString(),
      independentEvidenceConfirmed: independenceReviewed }) : null,
    evidence: Object.freeze(supportingEvidence),
    notificationAction: 'none',
    alertEligibilityReasons: alertEligible ? [] : [
      ...(!issuer ? ['issuer_not_uniquely_cross_correlated'] : []),
      ...(!impact ? ['impact_assessment_incomplete'] : []),
      ...(impact && !freshImpact ? ['impact_assessment_stale'] : []),
      ...(!reviewed ? ['explicit_human_review_required'] : []),
      ...(reviewed && !freshReview ? ['human_review_stale'] : []),
      ...(!independentEvidence ? ['two_independent_evidence_items_required'] : []),
      ...(independentEvidence && !independenceReviewed ? ['evidence_independence_review_required'] : []),
      ...(independentEvidence && !freshEvidence ? ['source_evidence_stale_or_undated'] : []),
      ...(['requires_review', 'unknown'].includes(parent.status) ? ['parent_relationship_unresolved'] : []),
    ],
  });
}

export async function persistQualification(client, qualification) {
  if (!client || typeof client.query !== 'function') throw new TypeError('database_client_required');
  const { event } = qualification;
  const qualificationKey = [event.engine, event.source, event.sourceEventId,
    event.fingerprint, qualification.issuer?.cik ?? 'unresolved',
    qualification.issuer?.ticker ?? 'unresolved'].join(':');
  const { rows } = await client.query(`
    INSERT INTO catalyst_acceptance.research_qualifications
      (qualification_key, engine, source, source_event_id, fingerprint, stage,
       alert_eligible, issuer_resolution, parent_relationship, impact_assessment,
       review, supporting_evidence, eligibility_reasons)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    ON CONFLICT (qualification_key) DO UPDATE SET
      stage=EXCLUDED.stage, alert_eligible=EXCLUDED.alert_eligible,
      issuer_resolution=EXCLUDED.issuer_resolution,
      parent_relationship=EXCLUDED.parent_relationship,
      impact_assessment=EXCLUDED.impact_assessment,
      review=EXCLUDED.review, supporting_evidence=EXCLUDED.supporting_evidence,
      eligibility_reasons=EXCLUDED.eligibility_reasons,
      updated_at=clock_timestamp()
    RETURNING qualification_key, stage, alert_eligible
  `, [qualificationKey, event.engine, event.source, event.sourceEventId,
      event.fingerprint, qualification.stage, qualification.alertEligible,
      JSON.stringify({ status: qualification.issuerResolutionStatus, issuer: qualification.issuer }),
      JSON.stringify(qualification.parentRelationship),
      qualification.impactAssessment ? JSON.stringify(qualification.impactAssessment) : null,
      qualification.review ? JSON.stringify(qualification.review) : null,
      JSON.stringify(qualification.evidence), JSON.stringify(qualification.alertEligibilityReasons)]);
  return rows[0];
}
