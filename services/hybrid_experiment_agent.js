/**
 * Hybrid Experiment Agent
 *
 * Runs deterministic base scoring and optional holistic adjuster for hybrid matrix.
 * Kept separate from the main experiment agent to avoid interference.
 */

const { buildPrompt } = require('./experiment_prompts');
const { callDeepSeek } = require('./council_callers');

const DEEPSEEK_RATES = { input: 0.00014, output: 0.00028 };

async function runVariation(variation, contractorData) {
  const startTime = Date.now();

  try {
    let result;

    switch (variation.mode) {
      case 'deterministic':
        result = runDeterministic(contractorData);
        break;

      case 'deterministic_plus':
        result = await runDeterministicPlus(variation, contractorData);
        break;

      case 'holistic':
        result = await runHolistic(variation, contractorData);
        break;

      default:
        throw new Error(`Unknown mode: ${variation.mode}`);
    }

    return {
      success: true,
      variation: variation.id,
      ...result,
      duration_ms: Date.now() - startTime
    };
  } catch (err) {
    return {
      success: false,
      variation: variation.id,
      error: err.message,
      duration_ms: Date.now() - startTime
    };
  }
}

function runDeterministic(contractorData) {
  const base = computeDeterministicScore(contractorData);

  return {
    trust_score: base.score,
    risk_level: scoreToRiskLevel(base.score),
    reasoning: base.reasoning,
    score_breakdown: base.breakdown,
    cost_usd: 0
  };
}

async function runDeterministicPlus(variation, contractorData) {
  const base = computeDeterministicScore(contractorData);
  const holistic = await runHolistic(variation, contractorData);

  const delta = clamp(holistic.trust_score - base.score, -5, 5);
  const finalScore = clamp(base.score + delta, 0, 100);

  return {
    trust_score: finalScore,
    risk_level: scoreToRiskLevel(finalScore),
    reasoning: `Base=${base.score}, Holistic=${holistic.trust_score}, Adjust=${delta}`,
    score_breakdown: base.breakdown,
    base_score: base.score,
    holistic_score: holistic.trust_score,
    adjustment: delta,
    cost_usd: holistic.cost_usd
  };
}

async function runHolistic(variation, contractorData) {
  const prompt = buildPrompt('holistic', contractorData);
  const response = await callDeepSeek(prompt.system, prompt.user, {
    temperature: 0,
    seed: 42
  });

  const parsed = parseJsonResponse(response);

  return {
    trust_score: parsed.trust_score,
    risk_level: parsed.risk_level,
    reasoning: parsed.reasoning,
    red_flags: parsed.red_flags || [],
    raw_response: parsed,
    cost_usd: estimateCost(prompt.user.length, response.length)
  };
}

function computeDeterministicScore(contractorData) {
  const reviewStats = extractReviewStats(contractorData);
  const reviewAnalysis = contractorData?.sources?.review_analysis?.data || {};
  const bbb = contractorData?.sources?.bbb?.data || {};
  const court = contractorData?.sources?.court_records?.data || {};
  const liens = contractorData?.sources?.county_liens?.data || {};
  const ag = contractorData?.sources?.tx_ag_complaints?.data || {};

  const avgRating = reviewStats.avgRating;
  const reviewCount = reviewStats.reviewCount;
  const negRatio = reviewStats.negRatio;
  const hasReviews = reviewCount > 0;

  const fakeScore = Number(reviewAnalysis.fake_review_score || 0);
  const complaintCount = Array.isArray(reviewAnalysis.complaint_patterns)
    ? reviewAnalysis.complaint_patterns.length
    : 0;

  const bbbFound = !!bbb.found;
  const bbbRating = typeof bbb.rating === 'string' ? bbb.rating : '';

  const agResults = Array.isArray(ag.results) ? ag.results.length : 0;
  const courtCases = Number(court.total_cases_found || 0);
  const lienRecords = Number(liens.total_records || 0);

  const reviewWeight = hasReviews ? Math.min(1, reviewCount / 20) : 0;
  const ratingScore = hasReviews ? (avgRating - 3.0) * 20 * reviewWeight : 0;
  const volumeScore = hasReviews ? (reviewCount >= 50 ? 10 : reviewCount >= 20 ? 7 : reviewCount >= 5 ? 4 : 1) : 0;

  let negPenalty = hasReviews ? -Math.round(negRatio * 100 * 1.0 * reviewWeight) : 0;
  if (negPenalty < -25) negPenalty = -25;

  let fakeAdj = 0;
  if (fakeScore >= 60) fakeAdj = -10;
  else if (fakeScore >= 40) fakeAdj = -5;
  else if (fakeScore <= 20) fakeAdj = 3;

  let bbbAdj = 0;
  if (bbbFound) {
    bbbAdj = bbbRating.startsWith('A') ? 8 : 4;
  }

  const complaintPenalty = -Math.round(Math.min(12, complaintCount * 3) * reviewWeight);

  let agPenalty = 0;
  if (agResults >= 8) agPenalty = -8;
  else if (agResults >= 5) agPenalty = -4;
  else if (agResults >= 3) agPenalty = -2;

  const courtPenalty = courtCases > 0 ? -10 : 0;
  const lienPenalty = lienRecords > 0 ? -10 : 0;

  const base = 25;
  const rawScore = clamp(
    base + ratingScore + volumeScore + negPenalty + fakeAdj + bbbAdj + complaintPenalty + agPenalty + courtPenalty + lienPenalty,
    0,
    100
  );
  const qualityCap = maxScoreForReviewCount(reviewCount);
  const score = Math.min(rawScore, qualityCap);

  const breakdown = {
    base,
    rating_score: round1(ratingScore),
    volume_score: volumeScore,
    negative_penalty: negPenalty,
    fake_adjustment: fakeAdj,
    bbb_adjustment: bbbAdj,
    complaint_penalty: complaintPenalty,
    ag_penalty: agPenalty,
    court_penalty: courtPenalty,
    lien_penalty: lienPenalty,
    data_quality_cap: qualityCap,
    cap_applied: score !== rawScore
  };

  const ratingLabel = hasReviews ? formatMetric(avgRating, 1) : 'NA';
  const negLabel = hasReviews ? formatMetric(negRatio, 3) : 'NA';
  const reviewWeightLabel = formatMetric(reviewWeight, 2);
  const reasoning = `rating=${ratingLabel}, reviews=${reviewCount}, neg_ratio=${negLabel}, review_weight=${reviewWeightLabel}, fake=${fakeScore}, complaints=${complaintCount}, bbb_found=${bbbFound}, cap=${qualityCap}`;

  return { score, breakdown, reasoning };
}

function extractReviewStats(contractorData) {
  const local = contractorData?.sources?.google_maps_local?.data || {};
  const hq = contractorData?.sources?.google_maps_hq?.data || {};
  const reviews = Array.isArray(local.reviews) ? local.reviews : [];

  let avgRating = 0;
  let reviewCount = 0;
  let negRatio = 0;

  if (reviews.length > 0) {
    reviewCount = reviews.length;
    const sum = reviews.reduce((acc, r) => acc + (Number(r.rating) || 0), 0);
    avgRating = sum / reviewCount;
    const neg = reviews.filter(r => (Number(r.rating) || 0) <= 2).length;
    negRatio = reviewCount > 0 ? neg / reviewCount : 0;
  } else {
    avgRating = Number(local.rating || hq.rating || 0);
    reviewCount = Number(local.review_count || hq.review_count || 0);
    negRatio = 0;
  }

  return { avgRating, reviewCount, negRatio };
}

function parseJsonResponse(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error(`No JSON in response: ${text.substring(0, 100)}`);
  }
  return JSON.parse(match[0]);
}

function scoreToRiskLevel(score) {
  if (score >= 70) return 'LOW';
  if (score >= 50) return 'MEDIUM';
  if (score >= 25) return 'HIGH';
  return 'CRITICAL';
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function round3(value) {
  return Math.round(value * 1000) / 1000;
}

function formatMetric(value, digits) {
  if (!Number.isFinite(value)) return 'NA';
  const factor = Math.pow(10, digits);
  return Math.round(value * factor) / factor;
}

function maxScoreForReviewCount(reviewCount) {
  if (reviewCount >= 20) return 100;
  if (reviewCount >= 5) return 84;
  if (reviewCount > 0) return 69;
  return 54;
}

function estimateCost(inputLen, outputLen) {
  const inputTokens = inputLen / 4;
  const outputTokens = outputLen / 4;
  return (inputTokens * DEEPSEEK_RATES.input + outputTokens * DEEPSEEK_RATES.output) / 1000;
}

module.exports = {
  runVariation
};
