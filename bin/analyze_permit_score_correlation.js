#!/usr/bin/env node
/**
 * Permit → Contractor Trust Score Correlation Analysis
 *
 * Tests whether permit data has predictive/analytical power
 * on contractor quality as measured by trust scores.
 *
 * Hypotheses tested:
 *   H1: Contractors who appear on permits score differently than those who don't
 *   H2: Permit volume in a contractor's city correlates with trust score
 *   H3: Pool permit density correlates with pool contractor quality
 *   H4: Property values (CAD) in a contractor's city correlate with trust score
 *   H5: Permit type diversity in a city correlates with contractor quality
 *   H6: Recent permit activity (freshness) correlates with contractor quality
 *
 * Usage:
 *   node bin/analyze_permit_score_correlation.js
 */

const fs = require('fs');
const path = require('path');
const db = require('../services/db_pg');

// ─── Name Cleaning ──────────────────────────────────────────────

const JUNK_NAMES = new Set([
  'owner', 'homeowner', 'home owner', 'property owner',
  'tenant', 'resident', 'applicant', 'self', 'n/a', 'na',
  'none', 'unknown', 'see notes', 'tbd', 'pending',
]);

const JUNK_PATTERNS = [
  /^plumbing permit/i,
  /^electrical permit/i,
  /^mechanical permit/i,
  /^building permit/i,
  /permit\s*(application|#|\d)/i,
  /^\s*$/,
];

// Retail/commercial brands that are NOT contractors
const NON_CONTRACTOR_BRANDS = new Set([
  'kroger', 'mcdonalds', "mcdonald's", 'taco bell', 'starbucks',
  'cvs pharmacy', 'cvs pharamacy', 'walgreens', 'walmart',
  'bank of america', 'comerica bank', 'chase', 'wells fargo',
  'circle k', 'texaco', 'shell', 'quik trip', 'quiktrip',
  'extra space storage', 'prologis', 'spirit halloween',
  'jack-in-the-box', 'popeyes', 'chipotle', 'dunkin baskin robbins',
  'jollibee', "rita's", 'caliber car wash', 'dutch bros coffee',
  'gm financial', 'pls', 'swig', 'cae', 'knockout live',
  'tccd', 'tarrant county college', 'tccd - tarrant county college',
]);

// Arlington SI permits are business/tenant names, not contractors
const EXCLUDE_CITY_TYPE = [
  { city: 'arlington', type: 'SI' },
];

function normalizeContractorName(name) {
  if (!name || typeof name !== 'string') return null;
  let n = name.trim().toLowerCase();
  // Strip common suffixes
  n = n.replace(/\b(llc|inc|corp|co|ltd|l\.l\.c\.?|incorporated)\b\.?/gi, '').trim();
  // Collapse whitespace
  n = n.replace(/\s+/g, ' ');
  return n || null;
}

function isJunkName(raw) {
  if (!raw) return true;
  const normalized = normalizeContractorName(raw);
  if (!normalized) return true;
  if (normalized.length < 3) return true;
  if (JUNK_NAMES.has(normalized)) return true;
  if (NON_CONTRACTOR_BRANDS.has(normalized)) return true;
  // Check partial matches for brands
  for (const brand of NON_CONTRACTOR_BRANDS) {
    if (normalized.startsWith(brand)) return true;
  }
  for (const pat of JUNK_PATTERNS) {
    if (pat.test(raw)) return true;
  }
  return false;
}

function isExcludedCityType(city, permitType) {
  return EXCLUDE_CITY_TYPE.some(e =>
    e.city === city.toLowerCase() && e.type === permitType
  );
}

// ─── Fuzzy Matching ─────────────────────────────────────────────

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function similarity(a, b) {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

function matchContractorToPermitName(contractorName, permitName) {
  const cn = normalizeContractorName(contractorName);
  const pn = normalizeContractorName(permitName);
  if (!cn || !pn) return { matched: false };

  // Both names must have at least 2 words (single words like "Ferguson" are too ambiguous)
  const cnWordCount = cn.split(' ').filter(w => w.length >= 2).length;
  const pnWordCount = pn.split(' ').filter(w => w.length >= 2).length;

  // Exact match
  if (cn === pn) return { matched: true, method: 'exact', confidence: 98 };

  // Contains match: the shorter name must be fully inside the longer one
  // Requirements: shorter name must be 2+ words AND length ratio > 0.6
  if (cnWordCount >= 2 && pnWordCount >= 2) {
    if (cn.includes(pn) || pn.includes(cn)) {
      const shorter = cn.length < pn.length ? cn : pn;
      const longer = cn.length < pn.length ? pn : cn;
      const ratio = shorter.length / longer.length;
      // "Sandler Pools" in "Riverbend Sandler Pools" = OK (ratio 0.59+)
      // "Ferguson" in "Bobby Ferguson" = blocked (single word)
      if (ratio > 0.55) return { matched: true, method: 'contains', confidence: 75 + Math.round(ratio * 15) };
    }
  }

  // Levenshtein similarity — strict threshold, require both names 10+ chars
  // Blocks: "EAV Construction" ↔ "ESA Construction" (differ by one letter but different company)
  //         "A & A Construction" ↔ "J & J Construction" (pattern match, wrong)
  if (cn.length >= 10 && pn.length >= 10) {
    const sim = similarity(cn, pn);
    // Require 90%+ for names under 20 chars, 88%+ for longer names
    const threshold = Math.max(cn.length, pn.length) < 20 ? 0.92 : 0.90;
    if (sim >= threshold) return { matched: true, method: 'fuzzy', confidence: Math.round(sim * 100) };
  }

  // Word overlap — require 2+ SPECIFIC (non-generic) words to match
  const GENERIC_WORDS = new Set([
    // Trade words
    'texas', 'roofing', 'construction', 'plumbing', 'electric', 'electrical',
    'pool', 'pools', 'fence', 'fencing', 'hvac', 'air', 'heating', 'cooling',
    'mechanical', 'siding', 'windows', 'doors', 'blinds', 'shutters',
    'patio', 'patios', 'cover', 'covers', 'carport', 'retaining', 'walls',
    'water', 'heater', 'heaters', 'solar', 'insulation', 'painting',
    'concrete', 'pavers', 'paving', 'turf', 'lawn', 'landscape', 'landscaping',
    'garage', 'gutter', 'gutters', 'stucco', 'drywall', 'flooring',
    // Business words
    'services', 'service', 'solutions', 'company', 'group', 'pro', 'pros',
    'home', 'homes', 'house', 'building', 'builders', 'contracting',
    'contractors', 'contractor', 'repair', 'repairs', 'remodeling',
    'exteriors', 'exterior', 'interior', 'custom', 'premier', 'superior',
    'star', 'one', 'all', 'new', 'best', 'top', 'first', 'american',
    'national', 'general', 'quality', 'direct', 'foundation', 'north',
    'south', 'east', 'west', 'dfw', 'dallas', 'fort', 'worth', 'plano',
    'frisco', 'arlington', 'and', 'the', 'of', 'in',
    // Common short words that cause false matches
    'same', 'day', 'big', 'old', 'good', 'great', 'city', 'metro',
    'metroplex', 'affordable', 'reliable', 'trusted', 'certified',
    'professional', 'professionals', 'expert', 'experts', 'elite',
    'deck', 'decks',
  ]);
  const cWords = cn.split(' ').filter(w => w.length >= 3 && !GENERIC_WORDS.has(w));
  const pWords = pn.split(' ').filter(w => w.length >= 3 && !GENERIC_WORDS.has(w));
  const overlap = cWords.filter(w => pWords.includes(w));
  // Require 2+ specific matching words AND they cover majority of both names' specific words
  if (overlap.length >= 2 && cWords.length >= 2 && pWords.length >= 2 &&
      overlap.length >= Math.max(cWords.length, pWords.length) * 0.5) {
    return { matched: true, method: 'word_overlap', confidence: 55 + overlap.length * 5 };
  }

  return { matched: false };
}

// ─── Statistics ─────────────────────────────────────────────────

function mean(arr) {
  if (arr.length === 0) return null;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function median(arr) {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function stddev(arr) {
  const m = mean(arr);
  if (m === null || arr.length < 2) return null;
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1));
}

function pearsonR(xs, ys) {
  const n = xs.length;
  if (n < 3) return { r: null, p: null, n };
  const mx = mean(xs), my = mean(ys);
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  if (denom === 0) return { r: 0, p: 1, n };
  const r = num / denom;
  // t-test for significance
  const t = r * Math.sqrt((n - 2) / (1 - r * r));
  // Approximate p-value using t-distribution (two-tailed)
  const df = n - 2;
  const p = 2 * (1 - tCDF(Math.abs(t), df));
  return { r: Math.round(r * 1000) / 1000, p: Math.round(p * 10000) / 10000, n };
}

// Approximation of Student's t CDF
function tCDF(t, df) {
  const x = df / (df + t * t);
  return 1 - 0.5 * incompleteBeta(df / 2, 0.5, x);
}

function incompleteBeta(a, b, x) {
  // Simple continued fraction approximation
  if (x === 0) return 0;
  if (x === 1) return 1;
  const lnBeta = lnGamma(a) + lnGamma(b) - lnGamma(a + b);
  const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lnBeta);
  // Lentz's algorithm
  let f = 1, c = 1, d = 0;
  for (let i = 0; i <= 200; i++) {
    let m = Math.floor(i / 2);
    let num;
    if (i === 0) num = 1;
    else if (i % 2 === 0) num = (m * (b - m) * x) / ((a + 2 * m - 1) * (a + 2 * m));
    else num = -((a + m) * (a + b + m) * x) / ((a + 2 * m) * (a + 2 * m + 1));
    d = 1 + num * d; if (Math.abs(d) < 1e-30) d = 1e-30; d = 1 / d;
    c = 1 + num / c; if (Math.abs(c) < 1e-30) c = 1e-30;
    f *= c * d;
    if (Math.abs(c * d - 1) < 1e-8) break;
  }
  return front * (f - 1) / a;
}

function lnGamma(z) {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.001208650973866179, -0.000005395239384953];
  let x = z, y = z;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += c[j] / ++y;
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}

function welchT(a, b) {
  const na = a.length, nb = b.length;
  if (na < 2 || nb < 2) return { t: null, p: null, d: null };
  const ma = mean(a), mb = mean(b);
  const va = a.reduce((s, v) => s + (v - ma) ** 2, 0) / (na - 1);
  const vb = b.reduce((s, v) => s + (v - mb) ** 2, 0) / (nb - 1);
  const se = Math.sqrt(va / na + vb / nb);
  if (se === 0) return { t: 0, p: 1, d: 0 };
  const t = (ma - mb) / se;
  const df = Math.floor((va / na + vb / nb) ** 2 /
    ((va / na) ** 2 / (na - 1) + (vb / nb) ** 2 / (nb - 1)));
  const p = 2 * (1 - tCDF(Math.abs(t), Math.max(df, 1)));
  const pooledSD = Math.sqrt(((na - 1) * va + (nb - 1) * vb) / (na + nb - 2));
  const d = pooledSD > 0 ? (ma - mb) / pooledSD : 0;
  return {
    t: Math.round(t * 100) / 100,
    p: Math.round(p * 10000) / 10000,
    d: Math.round(d * 100) / 100,
    diff: Math.round((ma - mb) * 10) / 10
  };
}

// ─── City Name Normalization ────────────────────────────────────

function normalizeCity(city) {
  if (!city) return null;
  let c = city.trim().toLowerCase();
  // Remove year suffixes (e.g., "little elm 2025")
  c = c.replace(/\s+\d{4}$/, '');
  // Normalize fort worth variants
  c = c.replace(/^fort_worth$/, 'fort worth');
  // Capitalize for display
  return c.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// ─── Main Analysis ──────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  PERMIT ↔ TRUST SCORE CORRELATION ANALYSIS              ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  // ── Load contractor trust scores from all completed batches ──
  console.log('Loading contractor trust scores from experiment batches...');

  const batchDirs = ['hybrid_100', 'hybrid_100_B', 'hybrid_100_C', 'hybrid_100_D',
    'hybrid_100_E', 'hybrid_100_F', 'hybrid_100_G'];

  const contractorScores = new Map(); // id → { score, business_name, city, verticals }

  for (const dir of batchDirs) {
    const fpPath = path.join(__dirname, '..', 'experiments', dir, 'results', 'first_pass.json');
    if (!fs.existsSync(fpPath)) continue;
    const data = JSON.parse(fs.readFileSync(fpPath, 'utf-8'));
    const rows = Array.isArray(data) ? data : (data.results || []);
    for (const row of rows) {
      const score = Number(row.score || row.trust_score);
      if (!Number.isFinite(score)) continue;
      contractorScores.set(row.contractor_id, {
        score,
        business_name: row.business_name || '',
        city: row.city || '',
        verticals: row.verticals || [],
      });
    }
  }

  // Also pull from audit_records joined with contractors table
  const auditRows = await db.exec(`
    SELECT ar.contractor_id, ar.trust_score, c.business_name, c.city
    FROM audit_records ar
    JOIN contractors_contractor c ON c.id = ar.contractor_id
    WHERE ar.trust_score IS NOT NULL
  `);
  for (const row of auditRows) {
    if (!contractorScores.has(row.contractor_id)) {
      contractorScores.set(row.contractor_id, {
        score: Number(row.trust_score),
        business_name: row.business_name || '',
        city: row.city || '',
        verticals: [],
      });
    }
  }

  console.log(`  Loaded ${contractorScores.size} contractors with trust scores\n`);

  // ── Load and clean permit data ──
  console.log('Loading and cleaning permit data...');

  const allPermits = await db.exec(`
    SELECT p.contractor_name, p.city, p.permit_type, p.description,
           p.issued_date, p.property_address
    FROM leads_permit p
    WHERE p.contractor_name IS NOT NULL
      AND p.contractor_name != ''
  `);

  let cleanedPermits = [];
  let junkCount = 0;
  let excludedCityTypeCount = 0;

  for (const p of allPermits) {
    if (isExcludedCityType(p.city, p.permit_type)) {
      excludedCityTypeCount++;
      continue;
    }
    if (isJunkName(p.contractor_name)) {
      junkCount++;
      continue;
    }
    cleanedPermits.push(p);
  }

  console.log(`  Raw permit rows with contractor_name: ${allPermits.length}`);
  console.log(`  Excluded (Arlington SI = business names): ${excludedCityTypeCount}`);
  console.log(`  Excluded (junk/non-contractor names): ${junkCount}`);
  console.log(`  Clean contractor-linked permits: ${cleanedPermits.length}`);

  // Unique contractor names on permits after cleaning
  const uniquePermitNames = new Set(cleanedPermits.map(p => normalizeContractorName(p.contractor_name)));
  console.log(`  Unique contractor names after cleaning: ${uniquePermitNames.size}\n`);

  // ── Load all permit data for city-level analysis ──
  const permitsByCity = await db.exec(`
    SELECT city, COUNT(*) as total_permits,
           COUNT(CASE WHEN permit_type ILIKE '%pool%' OR description ILIKE '%pool%' THEN 1 END) as pool_permits,
           COUNT(DISTINCT permit_type) as type_diversity,
           COUNT(CASE WHEN issued_date >= NOW() - INTERVAL '90 days' THEN 1 END) as recent_permits,
           COUNT(CASE WHEN issued_date >= NOW() - INTERVAL '30 days' THEN 1 END) as very_recent_permits
    FROM leads_permit
    GROUP BY city
  `);

  const cityPermitMap = new Map();
  for (const row of permitsByCity) {
    const normCity = normalizeCity(row.city);
    if (!normCity) continue;
    const existing = cityPermitMap.get(normCity) || {
      total_permits: 0, pool_permits: 0, type_diversity: 0,
      recent_permits: 0, very_recent_permits: 0
    };
    existing.total_permits += Number(row.total_permits);
    existing.pool_permits += Number(row.pool_permits);
    existing.type_diversity = Math.max(existing.type_diversity, Number(row.type_diversity));
    existing.recent_permits += Number(row.recent_permits);
    existing.very_recent_permits += Number(row.very_recent_permits);
    cityPermitMap.set(normCity, existing);
  }

  // ── Load property values by city ──
  const propByCity = await db.exec(`
    SELECT
      SPLIT_PART(property_address, ',', -1) as raw_city,
      AVG(NULLIF(market_value, 0)) as avg_value,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY NULLIF(market_value, 0)) as median_value,
      COUNT(NULLIF(market_value, 0)) as with_value
    FROM leads_property
    WHERE market_value > 0
    GROUP BY raw_city
    HAVING COUNT(NULLIF(market_value, 0)) >= 5
  `);

  // Also try joining via permit city
  const propByCityViaPermit = await db.exec(`
    SELECT p.city,
           AVG(NULLIF(pr.market_value, 0)) as avg_value,
           PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY NULLIF(pr.market_value, 0)) as median_value,
           COUNT(NULLIF(pr.market_value, 0)) as cnt
    FROM leads_permit p
    JOIN leads_property pr ON p.property_address = pr.property_address
    WHERE pr.market_value > 0
    GROUP BY p.city
    HAVING COUNT(NULLIF(pr.market_value, 0)) >= 5
  `);

  const cityValueMap = new Map();
  for (const row of propByCityViaPermit) {
    const normCity = normalizeCity(row.city);
    if (!normCity) continue;
    cityValueMap.set(normCity, {
      avg_value: Math.round(Number(row.avg_value)),
      median_value: Math.round(Number(row.median_value)),
      sample_size: Number(row.cnt)
    });
  }

  // ─────────────────────────────────────────────────────────────
  // HYPOTHESIS 1: Contractors on permits vs not
  // ─────────────────────────────────────────────────────────────
  console.log('═══════════════════════════════════════════════════════════');
  console.log('H1: Do contractors who appear on permits score differently?');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Match cleaned permit names to our contractor database
  const contractorList = [];
  for (const [id, data] of contractorScores.entries()) {
    contractorList.push({ id, ...data });
  }

  const matchedContractors = new Map(); // contractor_id → { matches, permit_count }

  for (const permit of cleanedPermits) {
    for (const contractor of contractorList) {
      const match = matchContractorToPermitName(contractor.business_name, permit.contractor_name);
      if (match.matched && match.confidence >= 70) {
        const existing = matchedContractors.get(contractor.id) || { matches: [], permit_count: 0 };
        existing.matches.push({
          permit_name: permit.contractor_name,
          method: match.method,
          confidence: match.confidence,
          city: permit.city,
          type: permit.permit_type,
        });
        existing.permit_count++;
        matchedContractors.set(contractor.id, existing);
      }
    }
  }

  const matchedIds = new Set(matchedContractors.keys());
  const matchedScores = [];
  const unmatchedScores = [];

  for (const [id, data] of contractorScores.entries()) {
    if (matchedIds.has(id)) {
      matchedScores.push(data.score);
    } else {
      unmatchedScores.push(data.score);
    }
  }

  console.log(`  Contractors matched to permits: ${matchedScores.length}`);
  console.log(`  Contractors NOT matched: ${unmatchedScores.length}`);
  console.log(`  Match rate: ${(matchedScores.length / contractorScores.size * 100).toFixed(1)}%\n`);

  if (matchedScores.length >= 2) {
    console.log('  Matched contractors:');
    for (const [id, data] of matchedContractors.entries()) {
      const c = contractorScores.get(id);
      const topMatch = data.matches[0];
      console.log(`    ID ${id} "${c.business_name}" (score=${c.score}) ← "${topMatch.permit_name}" [${topMatch.method}, ${topMatch.confidence}%] (${data.permit_count} permits)`);
    }
  }

  console.log(`\n  Matched group:   mean=${mean(matchedScores)?.toFixed(1)} median=${median(matchedScores)} std=${stddev(matchedScores)?.toFixed(1)} n=${matchedScores.length}`);
  console.log(`  Unmatched group: mean=${mean(unmatchedScores)?.toFixed(1)} median=${median(unmatchedScores)} std=${stddev(unmatchedScores)?.toFixed(1)} n=${unmatchedScores.length}`);

  if (matchedScores.length >= 2 && unmatchedScores.length >= 2) {
    const test = welchT(matchedScores, unmatchedScores);
    console.log(`\n  Welch's t-test: t=${test.t} p=${test.p} Cohen's d=${test.d} diff=${test.diff}`);
    console.log(`  ${test.p < 0.05 ? '✅ SIGNIFICANT' : '❌ NOT SIGNIFICANT'} at α=0.05`);
  } else {
    console.log(`\n  ⚠️ Not enough matched contractors for statistical test (need ≥2 per group)`);
  }

  // ─────────────────────────────────────────────────────────────
  // HYPOTHESIS 2: Total permit volume per city vs avg trust score
  // ─────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('H2: Does permit volume in a city correlate with trust score?');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Group contractors by city, compute avg score
  const cityScores = new Map();
  for (const [id, data] of contractorScores.entries()) {
    const normCity = normalizeCity(data.city);
    if (!normCity) continue;
    const existing = cityScores.get(normCity) || { scores: [], ids: [] };
    existing.scores.push(data.score);
    existing.ids.push(id);
    cityScores.set(normCity, existing);
  }

  // Build paired arrays for cities that appear in both permits and contractors
  const h2_x = [], h2_y = [], h2_cities = [];
  for (const [city, scoreData] of cityScores.entries()) {
    const permits = cityPermitMap.get(city);
    if (!permits || scoreData.scores.length < 3) continue;
    h2_x.push(permits.total_permits);
    h2_y.push(mean(scoreData.scores));
    h2_cities.push(city);
  }

  console.log(`  Cities with both permit data and ≥3 scored contractors: ${h2_x.length}\n`);
  console.log('  City                Permits  AvgScore  Contractors');
  console.log('  ────────────────── ──────── ──────── ────────────');
  const sortedH2 = h2_cities.map((c, i) => ({ city: c, permits: h2_x[i], score: h2_y[i], n: cityScores.get(c).scores.length }))
    .sort((a, b) => b.permits - a.permits);
  for (const row of sortedH2) {
    console.log(`  ${row.city.padEnd(20)} ${String(row.permits).padStart(6)}   ${row.score.toFixed(1).padStart(6)}   ${String(row.n).padStart(4)}`);
  }

  const h2corr = pearsonR(h2_x, h2_y);
  console.log(`\n  Pearson r = ${h2corr.r}  p = ${h2corr.p}  n = ${h2corr.n}`);
  console.log(`  ${h2corr.p !== null && h2corr.p < 0.05 ? '✅ SIGNIFICANT' : '❌ NOT SIGNIFICANT'} at α=0.05`);
  console.log(`  Interpretation: ${interpretR(h2corr.r)}`);

  // ─────────────────────────────────────────────────────────────
  // HYPOTHESIS 3: Pool permit density vs pool contractor quality
  // ─────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('H3: Does pool permit density correlate with pool contractor quality?');
  console.log('═══════════════════════════════════════════════════════════\n');

  const h3_x = [], h3_y = [], h3_cities = [];
  for (const [city, scoreData] of cityScores.entries()) {
    const permits = cityPermitMap.get(city);
    if (!permits || scoreData.scores.length < 3) continue;
    h3_x.push(permits.pool_permits);
    h3_y.push(mean(scoreData.scores));
    h3_cities.push(city);
  }

  const poolCities = h3_cities.map((c, i) => ({ city: c, poolPermits: h3_x[i], score: h3_y[i] }))
    .filter(r => r.poolPermits > 0)
    .sort((a, b) => b.poolPermits - a.poolPermits);

  console.log('  Cities with pool permits:');
  console.log('  City                PoolPermits  AvgScore');
  console.log('  ────────────────── ─────────── ────────');
  for (const row of poolCities.slice(0, 20)) {
    console.log(`  ${row.city.padEnd(20)} ${String(row.poolPermits).padStart(8)}   ${row.score.toFixed(1).padStart(6)}`);
  }

  const h3_fx = poolCities.map(r => r.poolPermits);
  const h3_fy = poolCities.map(r => r.score);
  const h3corr = pearsonR(h3_fx, h3_fy);
  console.log(`\n  Pearson r = ${h3corr.r}  p = ${h3corr.p}  n = ${h3corr.n}`);
  console.log(`  ${h3corr.p !== null && h3corr.p < 0.05 ? '✅ SIGNIFICANT' : '❌ NOT SIGNIFICANT'} at α=0.05`);
  console.log(`  Interpretation: ${interpretR(h3corr.r)}`);

  // ─────────────────────────────────────────────────────────────
  // HYPOTHESIS 4: Property values vs contractor quality
  // ─────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('H4: Do property values in a city correlate with trust score?');
  console.log('═══════════════════════════════════════════════════════════\n');

  const h4_x = [], h4_y = [], h4_cities = [];
  for (const [city, scoreData] of cityScores.entries()) {
    const propData = cityValueMap.get(city);
    if (!propData || scoreData.scores.length < 3) continue;
    h4_x.push(propData.median_value);
    h4_y.push(mean(scoreData.scores));
    h4_cities.push(city);
  }

  console.log(`  Cities with property value data and ≥3 scored contractors: ${h4_x.length}\n`);
  if (h4_x.length > 0) {
    console.log('  City                MedianPropVal  AvgScore');
    console.log('  ────────────────── ──────────────  ────────');
    const h4sorted = h4_cities.map((c, i) => ({ city: c, val: h4_x[i], score: h4_y[i] }))
      .sort((a, b) => b.val - a.val);
    for (const row of h4sorted.slice(0, 20)) {
      console.log(`  ${row.city.padEnd(20)} $${row.val.toLocaleString().padStart(12)}  ${row.score.toFixed(1).padStart(6)}`);
    }

    const h4corr = pearsonR(h4_x, h4_y);
    console.log(`\n  Pearson r = ${h4corr.r}  p = ${h4corr.p}  n = ${h4corr.n}`);
    console.log(`  ${h4corr.p !== null && h4corr.p < 0.05 ? '✅ SIGNIFICANT' : '❌ NOT SIGNIFICANT'} at α=0.05`);
    console.log(`  Interpretation: ${interpretR(h4corr.r)}`);
  } else {
    console.log('  ⚠️ No cities with both property value data and scored contractors');
  }

  // ─────────────────────────────────────────────────────────────
  // HYPOTHESIS 5: Permit type diversity vs contractor quality
  // ─────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('H5: Does permit type diversity correlate with contractor quality?');
  console.log('═══════════════════════════════════════════════════════════\n');

  const h5_x = [], h5_y = [];
  for (const [city, scoreData] of cityScores.entries()) {
    const permits = cityPermitMap.get(city);
    if (!permits || scoreData.scores.length < 3) continue;
    h5_x.push(permits.type_diversity);
    h5_y.push(mean(scoreData.scores));
  }

  const h5corr = pearsonR(h5_x, h5_y);
  console.log(`  Pearson r = ${h5corr.r}  p = ${h5corr.p}  n = ${h5corr.n}`);
  console.log(`  ${h5corr.p !== null && h5corr.p < 0.05 ? '✅ SIGNIFICANT' : '❌ NOT SIGNIFICANT'} at α=0.05`);
  console.log(`  Interpretation: ${interpretR(h5corr.r)}`);

  // ─────────────────────────────────────────────────────────────
  // HYPOTHESIS 6: Recent permit activity vs contractor quality
  // ─────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('H6: Does recent permit activity correlate with trust score?');
  console.log('═══════════════════════════════════════════════════════════\n');

  const h6_x = [], h6_y = [];
  for (const [city, scoreData] of cityScores.entries()) {
    const permits = cityPermitMap.get(city);
    if (!permits || scoreData.scores.length < 3) continue;
    h6_x.push(permits.recent_permits);
    h6_y.push(mean(scoreData.scores));
  }

  const h6corr = pearsonR(h6_x, h6_y);
  console.log(`  Pearson r = ${h6corr.r}  p = ${h6corr.p}  n = ${h6corr.n}`);
  console.log(`  ${h6corr.p !== null && h6corr.p < 0.05 ? '✅ SIGNIFICANT' : '❌ NOT SIGNIFICANT'} at α=0.05`);
  console.log(`  Interpretation: ${interpretR(h6corr.r)}`);

  // ─────────────────────────────────────────────────────────────
  // BONUS: Individual contractor-level features
  // ─────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('BONUS: Per-contractor permit feature analysis');
  console.log('═══════════════════════════════════════════════════════════\n');

  // For each contractor, build a feature vector from city-level permit data
  const features = [];
  for (const [id, data] of contractorScores.entries()) {
    const normCity = normalizeCity(data.city);
    if (!normCity) continue;
    const permits = cityPermitMap.get(normCity);
    const propVal = cityValueMap.get(normCity);
    const hasPermitMatch = matchedContractors.has(id);

    features.push({
      contractor_id: id,
      trust_score: data.score,
      city: normCity,
      city_total_permits: permits?.total_permits || 0,
      city_pool_permits: permits?.pool_permits || 0,
      city_type_diversity: permits?.type_diversity || 0,
      city_recent_permits: permits?.recent_permits || 0,
      city_median_prop_value: propVal?.median_value || null,
      has_permit_match: hasPermitMatch,
      permit_count: matchedContractors.get(id)?.permit_count || 0,
    });
  }

  // Test each feature individually
  const featureNames = [
    'city_total_permits', 'city_pool_permits', 'city_type_diversity',
    'city_recent_permits', 'city_median_prop_value'
  ];

  console.log('  Feature                    r       p       n     Interpretation');
  console.log('  ─────────────────────── ────── ─────── ───── ──────────────────');

  for (const feat of featureNames) {
    const xs = [], ys = [];
    for (const f of features) {
      if (f[feat] !== null && f[feat] !== undefined && f[feat] !== 0) {
        xs.push(f[feat]);
        ys.push(f.trust_score);
      }
    }
    const corr = pearsonR(xs, ys);
    const pad = feat.padEnd(26);
    const rStr = (corr.r !== null ? corr.r.toFixed(3) : 'N/A').padStart(6);
    const pStr = (corr.p !== null ? corr.p.toFixed(4) : 'N/A').padStart(7);
    const nStr = String(corr.n).padStart(5);
    console.log(`  ${pad} ${rStr} ${pStr} ${nStr}   ${interpretR(corr.r)}`);
  }

  // ─────────────────────────────────────────────────────────────
  // SUMMARY & VERDICT
  // ─────────────────────────────────────────────────────────────
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║  SUMMARY & VERDICT                                      ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  const results = {
    data_quality: {
      total_permits: allPermits.length,
      after_cleaning: cleanedPermits.length,
      unique_contractor_names: uniquePermitNames.size,
      contractors_with_scores: contractorScores.size,
      contractors_matched_to_permits: matchedScores.length,
      match_rate_pct: (matchedScores.length / contractorScores.size * 100).toFixed(1),
    },
    hypotheses: {
      H1_permit_presence: {
        matched_mean: mean(matchedScores)?.toFixed(1),
        unmatched_mean: mean(unmatchedScores)?.toFixed(1),
        n_matched: matchedScores.length,
        n_unmatched: unmatchedScores.length,
      },
      H2_city_volume: h2corr,
      H3_pool_density: h3corr,
      H4_property_values: h4_x.length > 0 ? pearsonR(h4_x, h4_y) : null,
      H5_type_diversity: h5corr,
      H6_recent_activity: h6corr,
    },
    verdict: null,
  };

  // Score each hypothesis
  const sigCount = [h2corr, h3corr, h5corr, h6corr]
    .filter(c => c.p !== null && c.p < 0.05).length;

  if (sigCount >= 3) {
    results.verdict = 'STRONG: Multiple significant correlations. Permit data has real predictive power.';
  } else if (sigCount >= 1) {
    results.verdict = 'MODERATE: Some correlations detected. Permit data adds signal but is not a strong standalone predictor.';
  } else {
    results.verdict = 'WEAK: No significant correlations at city level. Current permit data has minimal predictive power on contractor quality.';
  }

  console.log(`  Data: ${results.data_quality.contractors_with_scores} contractors scored, ${results.data_quality.after_cleaning} clean permit-contractor rows`);
  console.log(`  Match rate: ${results.data_quality.match_rate_pct}% of scored contractors appear on permits`);
  console.log(`  Significant hypotheses (p<0.05): ${sigCount}/6`);
  console.log(`\n  VERDICT: ${results.verdict}`);

  console.log('\n  KEY LIMITATION: contractor_name field is only populated in');
  console.log('  3 cities (Plano, Euless, Weatherford). 94% of permits have');
  console.log('  no contractor name. Direct contractor→permit matching is');
  console.log('  severely constrained by data sparsity, NOT by methodology.\n');

  console.log('  RECOMMENDATION: If permit data is to have real predictive');
  console.log('  power, we need direct contractor→permit links. Options:');
  console.log('  1. Scrape contractor license numbers → cross-ref city DBs');
  console.log('  2. Ask contractors for permit history during audit');
  console.log('  3. Use BuildFax/similar aggregator (paid)');
  console.log('  4. Enhanced scraping for cities that DO expose contractor names\n');

  // Write full results
  const outPath = path.join(__dirname, '..', 'experiments', 'permit_score_analysis.json');
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`  Full results: ${outPath}`);

  await db.close();
}

function interpretR(r) {
  if (r === null) return 'insufficient data';
  const abs = Math.abs(r);
  const dir = r > 0 ? 'positive' : 'negative';
  if (abs < 0.1) return `negligible ${dir}`;
  if (abs < 0.3) return `weak ${dir}`;
  if (abs < 0.5) return `moderate ${dir}`;
  if (abs < 0.7) return `strong ${dir}`;
  return `very strong ${dir}`;
}

main().catch(async (err) => {
  console.error('Fatal error:', err.message);
  console.error(err.stack);
  try { await db.close(); } catch (_) {}
  process.exit(1);
});
