#!/usr/bin/env node
/**
 * First pass holistic LLM scoring for 300-sample hybrid run.
 */

const fs = require('fs');
const path = require('path');
const { score: scoreHolistic } = require('../services/scoring/holistic/agent');

const BASE_DIR = path.join(__dirname, '..', 'experiments', 'hybrid_300');
const SNAPSHOT_DIR = path.join(BASE_DIR, 'data', 'snapshots');
const RESULTS_DIR = path.join(BASE_DIR, 'results');

function loadSnapshots() {
  const snapshotDir = fs.readdirSync(SNAPSHOT_DIR)
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort()
    .pop();

  if (!snapshotDir) throw new Error('No snapshots found');

  const snapshotPath = path.join(SNAPSHOT_DIR, snapshotDir);
  const files = fs.readdirSync(snapshotPath)
    .filter(f => f.endsWith('.json') && !f.startsWith('_'));

  return files.map(f => JSON.parse(fs.readFileSync(path.join(snapshotPath, f), 'utf-8')));
}

function mapTier(score) {
  if (score >= 85) return 'TRUSTED';
  if (score >= 70) return 'LOW';
  if (score >= 55) return 'MODERATE';
  if (score >= 35) return 'HIGH';
  return 'CRITICAL';
}

function scoreToRiskLevel(score) {
  if (score >= 70) return 'LOW';
  if (score >= 50) return 'MEDIUM';
  if (score >= 25) return 'HIGH';
  return 'CRITICAL';
}

async function main() {
  if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });

  const snapshots = loadSnapshots();

  const results = [];

  for (const snapshot of snapshots) {
    const meta = {
      id: snapshot.contractor_id,
      name: snapshot.business_name,
      city: snapshot.city,
      archetype: snapshot.archetype || '',
      expected_score: snapshot.expected_score
    };

    const res = await scoreHolistic(snapshot, meta);
    if (!res.result) {
      results.push({
        contractor_id: snapshot.contractor_id,
        business_name: snapshot.business_name,
        error: res.meta?.error || 'LLM scoring failed'
      });
      continue;
    }

    const trustScore = Number(res.result.trust_score);
    if (!Number.isFinite(trustScore)) {
      results.push({
        contractor_id: snapshot.contractor_id,
        business_name: snapshot.business_name,
        error: `Invalid trust_score: ${res.result.trust_score}`
      });
      continue;
    }

    results.push({
      contractor_id: snapshot.contractor_id,
      business_name: snapshot.business_name,
      city: snapshot.city,
      state: snapshot.state,
      verticals: snapshot.verticals || [],
      scoring_mode: 'holistic_llm',
      score: trustScore,
      risk_level: res.result.risk_level || scoreToRiskLevel(trustScore),
      tier: mapTier(trustScore),
      score_breakdown: res.comparison_helpers?.category_scores || {},
      reasoning: res.result.reasoning
    });
  }

  fs.writeFileSync(path.join(RESULTS_DIR, 'first_pass.json'), JSON.stringify(results, null, 2));

  const sorted = results
    .filter(r => typeof r.score === 'number')
    .sort((a, b) => b.score - a.score);

  fs.writeFileSync(path.join(RESULTS_DIR, 'first_pass_sorted.json'), JSON.stringify(sorted, null, 2));

  const tierCounts = {};
  for (const row of sorted) {
    tierCounts[row.tier] = (tierCounts[row.tier] || 0) + 1;
  }

  fs.writeFileSync(path.join(RESULTS_DIR, 'first_pass_tiers.json'), JSON.stringify(tierCounts, null, 2));

  console.log(`First pass complete: ${sorted.length} scored`);
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
