/**
 * Review Analyzer
 *
 * Uses AI to analyze reviews for fake patterns, sentiment issues, and discrepancies.
 * Runs during collection and stores summary for audit agent.
 */

const DEEPSEEK_API_BASE = 'https://api.deepseek.com/v1';
const REVIEW_QUALITY_ENABLED = process.env.REVIEW_QUALITY_ENABLED !== 'false';
const REVIEW_QUALITY_BATCH_SIZE = parseInt(process.env.REVIEW_QUALITY_BATCH_SIZE || '10', 10);
const REVIEW_QUALITY_MAX_REVIEWS = parseInt(process.env.REVIEW_QUALITY_MAX_REVIEWS || '200', 10);
const REVIEW_QUALITY_TEXT_MAX_CHARS = parseInt(process.env.REVIEW_QUALITY_TEXT_MAX_CHARS || '0', 10);
const REVIEW_CONTEXT_MAX_REVIEWS = parseInt(process.env.REVIEW_CONTEXT_MAX_REVIEWS || '200', 10);
const REVIEW_CONTEXT_TEXT_MAX_CHARS = parseInt(process.env.REVIEW_CONTEXT_TEXT_MAX_CHARS || '0', 10);

/**
 * Extract JSON from LLM response that may contain markdown or extra text
 * Handles multiple formats:
 * - Direct JSON parse
 * - JSON inside markdown code blocks
 * - JSON object extracted from surrounding text
 * - Regex fallback for key fields (fake_review_score, confidence, recommendation)
 */
function extractJSON(text) {
  // Try 1: Direct parse
  try {
    return JSON.parse(text);
  } catch (e) {}

  // Try 2: Extract from markdown code block
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch (e) {}
  }

  // Try 3: Find JSON object in text
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch (e) {}
  }

  // Try 4: Regex extraction for key fields
  const result = {
    fake_review_score: null,
    confidence: null,
    recommendation: 'VERIFY_REVIEWS'
  };

  const scoreMatch = text.match(/["']?fake_review_score["']?\s*[:=]\s*(\d+)/i);
  if (scoreMatch) result.fake_review_score = parseInt(scoreMatch[1]);

  const confMatch = text.match(/["']?confidence["']?\s*[:=]\s*["']?(\w+)["']?/i);
  if (confMatch) result.confidence = confMatch[1];

  const recMatch = text.match(/["']?recommendation["']?\s*[:=]\s*["']?(TRUST_REVIEWS|VERIFY_REVIEWS|DISTRUST_REVIEWS)["']?/i);
  if (recMatch) result.recommendation = recMatch[1].toUpperCase();

  // Only return if we got at least the score
  if (result.fake_review_score !== null) {
    return result;
  }

  return null;
}

const ANALYSIS_PROMPT = `You are a review analyst with deep reasoning capabilities. Your job is to understand the TRUE story behind a contractor's reviews.

## YOUR MISSION
Use your reasoning to determine: Are these reviews authentic reflections of customer experience, or is something fishy?

## THINK DEEPLY ABOUT
1. **Review Authenticity** - Do these read like real customers? Look for:
   - Specific details (project types, timelines, crew names, specific outcomes)
   - Varied writing styles and perspectives
   - Mix of praise AND constructive feedback (even happy customers mention small issues)
   - Emotional authenticity vs corporate-sounding language

2. **Platform Consistency** - Do ratings tell a coherent story?
   - Major discrepancies (e.g., 4.8 Google vs 2.1 Yelp) warrant investigation
   - But remember: different platforms attract different customers
   - BBB ratings reflect complaint handling, not service quality

3. **Complaint Patterns** - What do unhappy customers say?
   - Same issue from multiple reviewers = real problem
   - Specific details (names, dates, amounts) = credible
   - How does the company respond? Defensive vs helpful?

4. **Red Flags in Content**
   - Deposits taken, work not completed
   - Ghosting, unresponsive after payment
   - Legal threats in owner responses
   - Owner arguing with reviewers
5. **Warranty & Guarantee Follow-Through**
   - Look for warranty or guarantee claims in reviews and BBB complaint responses
   - Positive: "came back and fixed it", "no charge", "stood behind their work"
   - Negative: "refused to honor warranty", "denied claim", "charged to fix defects"
   - Note patterns that indicate whether they stand behind their work

## IMPORTANT CONTEXT
- High review volume is NORMAL for established, quality contractors
- Popular contractors naturally get many reviews - this is a POSITIVE signal
- A 5.0 rating with hundreds of reviews CAN be legitimate for excellent contractors
- Focus on review CONTENT and AUTHENTICITY rather than raw numbers
- Some industries (pools, outdoor living) have passionate customers who leave detailed reviews

## USE YOUR REASONING
Think flexibly like an investigator:
- What's the story here?
- Do the reviews feel real?
- Is there evidence of manipulation, or evidence of genuine quality?
- Let the content guide your conclusions

OUTPUT FORMAT (JSON only, no markdown code blocks):
{
  "fake_review_score": 25,
  "confidence": "HIGH",
  "platform_ratings": {"google": 4.8, "yelp": null, "bbb": "F", "glassdoor": 3.2},
  "discrepancy_detected": false,
  "discrepancy_explanation": "Ratings are consistent across platforms",
  "complaint_patterns": ["Slow response times", "Pricing concerns"],
  "fake_signals": ["Multiple reviews posted same day"],
  "authentic_signals": ["Specific project details mentioned", "Varied writing styles"],
  "warranty_signals": {
    "mentions": ["warranty", "guarantee"],
    "positive_evidence": ["They came back and fixed the issue at no charge"],
    "negative_evidence": ["Refused to honor warranty claim"],
    "follow_through": "MIXED",
    "confidence": "MEDIUM"
  },
  "summary": "Reviews appear authentic with minor concerns about response times.",
  "recommendation": "TRUST_REVIEWS"
}

IMPORTANT:
- fake_review_score must be a NUMBER from 0-100 (higher = more likely fake)
- discrepancy_detected must be true or false (no quotes)
- Output ONLY valid JSON, no additional text or markdown
- Replace example values above with your actual analysis`;

const REVIEW_QUALITY_PROMPT = `You are a review quality grader. Read each review and score how credible and useful it is.

For EACH review, output:
- quality_score (0-100): usefulness + credibility of the review text
- specificity (0-100): concrete details (scope, timeline, price, materials, crew, outcomes)
- authenticity (0-100): reads like a real customer vs template/marketing
- sentiment (-1 to 1): overall sentiment
- severity (0-3): severity of negative issues (0 none, 3 severe)
- issue_tags: list of short tags (e.g., "no_show", "poor_quality", "price_overrun", "warranty", "communication", "timeliness", "safety")
- confidence (0-1)

Return JSON ONLY in this format:
{
  "reviews": [
    {
      "id": "review_1",
      "quality_score": 72,
      "specificity": 60,
      "authenticity": 80,
      "sentiment": 0.6,
      "severity": 0,
      "issue_tags": ["communication"],
      "confidence": 0.74
    }
  ]
}

Rules:
- Use the review text only; do not infer missing facts.
- If the review is too short or generic, lower quality_score and specificity.
- If review contains red-flag details (deposit taken, not finished, unsafe work), set higher severity and tag it.
- Output ONLY valid JSON, no markdown.`;

function collectReviewTexts(reviewData) {
  const reviews = [];
  if (!reviewData || typeof reviewData !== 'object') return reviews;

  const pushReview = (source, r, idx) => {
    if (!r || typeof r !== 'object') return;
    const text = (r.text || r.review_text || r.content || '').toString().trim();
    if (!text) return;
    reviews.push({
      id: `${source}_${idx}`,
      source,
      rating: r.rating ?? r.stars ?? null,
      date: r.date || r.review_date || null,
      author: r.author || r.reviewer_name || r.user || r.name || null,
      text
    });
  };

  const maybeAdd = (sourceKey, list) => {
    if (!Array.isArray(list)) return;
    list.forEach((r, i) => pushReview(sourceKey, r, i));
  };

  // Google Maps variants
  if (reviewData.google_maps?.reviews) {
    maybeAdd('google_maps', reviewData.google_maps.reviews);
  }
  if (reviewData.google_maps_local?.reviews) {
    maybeAdd('google_maps_local', reviewData.google_maps_local.reviews);
  }
  if (reviewData.google_maps_hq?.reviews) {
    maybeAdd('google_maps_hq', reviewData.google_maps_hq.reviews);
  }

  // Yelp (direct or Yahoo fallback)
  if (reviewData.yelp?.reviews) {
    maybeAdd('yelp', reviewData.yelp.reviews);
  }
  if (reviewData.yelp_yahoo?.reviews) {
    maybeAdd('yelp_yahoo', reviewData.yelp_yahoo.reviews);
  }

  // BBB (if reviews exist in structured data)
  if (reviewData.bbb?.reviews) {
    maybeAdd('bbb', reviewData.bbb.reviews);
  }

  // Other platforms
  if (reviewData.angi?.reviews) {
    maybeAdd('angi', reviewData.angi.reviews);
  }
  if (reviewData.houzz?.reviews) {
    maybeAdd('houzz', reviewData.houzz.reviews);
  }
  if (reviewData.trustpilot?.reviews) {
    maybeAdd('trustpilot', reviewData.trustpilot.reviews);
  }
  if (reviewData.porch?.reviews) {
    maybeAdd('porch', reviewData.porch.reviews);
  }
  if (reviewData.glassdoor?.reviews) {
    maybeAdd('glassdoor', reviewData.glassdoor.reviews);
  }

  const deduped = [];
  const seen = new Set();
  for (const review of reviews) {
    const key = [
      (review.source || '').toLowerCase(),
      (review.author || '').toLowerCase(),
      (review.date || '').toLowerCase(),
      (review.text || '').toLowerCase().replace(/\s+/g, ' ').trim()
    ].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(review);
  }
  return deduped;
}

function chunkReviews(reviews, size) {
  const chunks = [];
  for (let i = 0; i < reviews.length; i += size) {
    chunks.push(reviews.slice(i, i + size));
  }
  return chunks;
}

function summarizeReviewQuality(perReview) {
  if (!Array.isArray(perReview) || perReview.length === 0) {
    return {
      avg_quality: null,
      avg_specificity: null,
      avg_authenticity: null,
      avg_sentiment: null,
      quality_distribution: { high: 0, medium: 0, low: 0 },
      severity_counts: { 0: 0, 1: 0, 2: 0, 3: 0 },
      issue_tags: {}
    };
  }

  const sums = {
    quality: 0,
    specificity: 0,
    authenticity: 0,
    sentiment: 0
  };
  const dist = { high: 0, medium: 0, low: 0 };
  const severityCounts = { 0: 0, 1: 0, 2: 0, 3: 0 };
  const tags = {};

  for (const r of perReview) {
    const q = Number(r.quality_score) || 0;
    sums.quality += q;
    sums.specificity += Number(r.specificity) || 0;
    sums.authenticity += Number(r.authenticity) || 0;
    sums.sentiment += Number(r.sentiment) || 0;

    if (q >= 75) dist.high += 1;
    else if (q >= 45) dist.medium += 1;
    else dist.low += 1;

    const sev = Number.isFinite(r.severity) ? r.severity : 0;
    if (severityCounts[sev] !== undefined) severityCounts[sev] += 1;

    if (Array.isArray(r.issue_tags)) {
      for (const tag of r.issue_tags) {
        if (!tag) continue;
        tags[tag] = (tags[tag] || 0) + 1;
      }
    }
  }

  const n = perReview.length;
  return {
    avg_quality: Math.round((sums.quality / n) * 10) / 10,
    avg_specificity: Math.round((sums.specificity / n) * 10) / 10,
    avg_authenticity: Math.round((sums.authenticity / n) * 10) / 10,
    avg_sentiment: Math.round((sums.sentiment / n) * 100) / 100,
    quality_distribution: dist,
    severity_counts: severityCounts,
    issue_tags: tags
  };
}

async function analyzeReviewQuality(reviews) {
  if (!REVIEW_QUALITY_ENABLED) {
    return { skipped: true, reason: 'REVIEW_QUALITY_ENABLED=false' };
  }
  if (!process.env.DEEPSEEK_API_KEY) {
    return { skipped: true, reason: 'DEEPSEEK_API_KEY not set' };
  }
  if (!Array.isArray(reviews) || reviews.length === 0) {
    return { skipped: true, reason: 'No review text found' };
  }

  const limited = REVIEW_QUALITY_MAX_REVIEWS > 0 ? reviews.slice(0, REVIEW_QUALITY_MAX_REVIEWS) : reviews;
  const batches = chunkReviews(limited, REVIEW_QUALITY_BATCH_SIZE);
  const scored = [];
  const errors = [];
  let totalCost = 0;

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i].map(r => ({
      id: r.id,
      source: r.source,
      rating: r.rating ?? null,
      date: r.date ?? null,
      text: REVIEW_QUALITY_TEXT_MAX_CHARS > 0
        ? (r.text || '').slice(0, REVIEW_QUALITY_TEXT_MAX_CHARS)
        : (r.text || '')
    }));

    try {
      const response = await fetch(`${DEEPSEEK_API_BASE}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [
            { role: 'system', content: REVIEW_QUALITY_PROMPT },
            { role: 'user', content: JSON.stringify({ reviews: batch }) }
          ],
          temperature: 0,
          max_tokens: 2000
        })
      });

      if (!response.ok) {
        throw new Error(`DeepSeek error: ${response.status}`);
      }

      const result = await response.json();
      totalCost += estimateCost(result);
      const message = result.choices?.[0]?.message || {};
      const content = message.content || '';
      const parsed = extractJSON(content);

      if (!parsed || !Array.isArray(parsed.reviews)) {
        errors.push({ batch: i, error: 'Failed to parse JSON' });
        continue;
      }

      // Keep only expected fields
      for (const r of parsed.reviews) {
        if (!r || !r.id) continue;
        scored.push({
          id: r.id,
          quality_score: r.quality_score ?? null,
          specificity: r.specificity ?? null,
          authenticity: r.authenticity ?? null,
          sentiment: r.sentiment ?? null,
          severity: r.severity ?? 0,
          issue_tags: Array.isArray(r.issue_tags) ? r.issue_tags : [],
          confidence: r.confidence ?? null
        });
      }
    } catch (err) {
      errors.push({ batch: i, error: err.message || String(err) });
    }
  }

  const summary = summarizeReviewQuality(scored);
  return {
    total_reviews: reviews.length,
    analyzed_reviews: scored.length,
    max_reviews_limit: REVIEW_QUALITY_MAX_REVIEWS,
    batch_size: REVIEW_QUALITY_BATCH_SIZE,
    text_max_chars: REVIEW_QUALITY_TEXT_MAX_CHARS,
    avg_quality: summary.avg_quality,
    avg_specificity: summary.avg_specificity,
    avg_authenticity: summary.avg_authenticity,
    avg_sentiment: summary.avg_sentiment,
    quality_distribution: summary.quality_distribution,
    severity_counts: summary.severity_counts,
    issue_tags: summary.issue_tags,
    per_review: scored,
    errors,
    cost: Math.round(totalCost * 10000) / 10000
  };
}

async function analyzeReviews(contractorName, reviewData) {
  // Defensive check for missing data
  if (!reviewData || typeof reviewData !== 'object') {
    return {
      skipped: true,
      reason: 'No review data provided',
      platform_ratings: { google: null, bbb: null, glassdoor: null, yelp: null }
    };
  }

  if (!process.env.DEEPSEEK_API_KEY) {
    return { error: 'DEEPSEEK_API_KEY not set', skipped: true };
  }

  // Build the review context
  let context = `## CONTRACTOR: ${contractorName || 'Unknown'}\n\n`;

  // Add platform ratings summary
  context += `## PLATFORM RATINGS\n`;
  if (reviewData.google_maps?.rating) {
    context += `- Google Maps: ${reviewData.google_maps.rating}★ (${reviewData.google_maps.review_count} reviews)\n`;
  }
  if (reviewData.google_maps_local?.rating && !reviewData.google_maps) {
    context += `- Google Maps (Local/DFW): ${reviewData.google_maps_local.rating}★ (${reviewData.google_maps_local.review_count} reviews)\n`;
  }
  if (reviewData.google_maps_hq?.rating && !reviewData.google_maps) {
    context += `- Google Maps (HQ): ${reviewData.google_maps_hq.rating}★ (${reviewData.google_maps_hq.review_count} reviews)\n`;
  }
  if (reviewData.bbb?.rating) {
    context += `- BBB: ${reviewData.bbb.rating} rating, Accredited: ${reviewData.bbb.accredited}\n`;
  }
  if (reviewData.glassdoor?.rating) {
    context += `- Glassdoor (employee): ${reviewData.glassdoor.rating}★ (${reviewData.glassdoor.review_count} reviews)\n`;
  }
  if (reviewData.yelp?.rating) {
    context += `- Yelp: ${reviewData.yelp.rating}★ (${reviewData.yelp.review_count} reviews)\n`;
  }
  if (reviewData.yelp_yahoo?.rating) {
    context += `- Yelp (via Yahoo): ${reviewData.yelp_yahoo.rating}★ (${reviewData.yelp_yahoo.review_count} reviews)\n`;
  }
  if (reviewData.trustpilot?.rating) {
    context += `- Trustpilot: ${reviewData.trustpilot.rating}★ (${reviewData.trustpilot.review_count} reviews)\n`;
  }
  if (reviewData.angi?.rating) {
    context += `- Angi: ${reviewData.angi.rating}★ (${reviewData.angi.review_count} reviews)\n`;
  }
  if (reviewData.houzz?.rating) {
    context += `- Houzz: ${reviewData.houzz.rating}★ (${reviewData.houzz.review_count} reviews)\n`;
  }

  // Add raw review text from each source
  context += `\n## RAW REVIEW DATA\n`;

  for (const [source, data] of Object.entries(reviewData)) {
    // Skip if data is null/undefined or not an object
    if (!data || typeof data !== 'object') continue;

    // For Google Maps sources with structured reviews, include full stored corpus.
    if ((source === 'google_maps_local' || source === 'google_maps_hq' || source === 'google_maps') && data.reviews && Array.isArray(data.reviews)) {
      const reviews = data.reviews;
      const includeCount = REVIEW_CONTEXT_MAX_REVIEWS > 0
        ? Math.min(reviews.length, REVIEW_CONTEXT_MAX_REVIEWS)
        : reviews.length;

      context += `\n### ${source.toUpperCase()} (Full Corpus: ${includeCount}/${reviews.length} stored reviews)\n`;

      for (let i = 0; i < includeCount; i++) {
        const r = reviews[i] || {};
        const author = r.author || r.reviewer_name || r.name || 'Anonymous';
        const date = r.date || 'Unknown date';
        const rating = r.rating ?? r.stars ?? 'N/A';
        const rawText = (r.text || '').toString();
        const reviewText = REVIEW_CONTEXT_TEXT_MAX_CHARS > 0
          ? rawText.slice(0, REVIEW_CONTEXT_TEXT_MAX_CHARS)
          : rawText;
        context += `[${i + 1}] ${author} (${date}) ${rating}★: ${reviewText}\n\n`;
      }

      if (includeCount < reviews.length) {
        context += `[omitted ${reviews.length - includeCount} review(s) due to REVIEW_CONTEXT_MAX_REVIEWS]\n\n`;
      }
      continue;
    }

    const rawText = data.raw_text || '';
    if (rawText.length > 50) {
      // Increased truncation limit from 3000 to 20000
      const text = rawText.length > 20000
        ? rawText.substring(0, 20000) + '...[truncated]'
        : rawText;
      context += `\n### ${source.toUpperCase()}\n${text}\n`;
    }
  }

  // Skip if we don't have enough data
  if (context.length < 500) {
    return {
      skipped: true,
      reason: 'Insufficient review data to analyze',
      platform_ratings: extractRatings(reviewData)
    };
  }

  // Optional: per-review quality scoring (full-text)
  const reviewTexts = collectReviewTexts(reviewData);
  const reviewQuality = await analyzeReviewQuality(reviewTexts);

  if (!reviewQuality?.skipped) {
    const qualitySummary = {
      total_reviews: reviewQuality.total_reviews,
      analyzed_reviews: reviewQuality.analyzed_reviews,
      avg_quality: reviewQuality.avg_quality,
      avg_specificity: reviewQuality.avg_specificity,
      avg_authenticity: reviewQuality.avg_authenticity,
      avg_sentiment: reviewQuality.avg_sentiment,
      quality_distribution: reviewQuality.quality_distribution,
      severity_counts: reviewQuality.severity_counts,
      issue_tags: reviewQuality.issue_tags
    };
    context += `\n## FULL CORPUS LINGUISTIC/QUALITY SUMMARY\n${JSON.stringify(qualitySummary, null, 2)}\n`;
  }

  try {
    const response = await fetch(`${DEEPSEEK_API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',  // Use chat model, not reasoner (reasoner puts output in reasoning_content which breaks JSON extraction)
        messages: [
          { role: 'system', content: ANALYSIS_PROMPT },
          { role: 'user', content: context }
        ],
        temperature: 0,
        max_tokens: 1500
      })
    });

    if (!response.ok) {
      throw new Error(`DeepSeek error: ${response.status}`);
    }

    const result = await response.json();

    // deepseek-reasoner returns reasoning in reasoning_content field
    const message = result.choices?.[0]?.message || {};
    const content = message.content || '';
    const reasoningContent = message.reasoning_content || '';

    // Try to extract JSON from content first, then from reasoning_content (fallback for reasoner model)
    const textToExtract = content || reasoningContent;

    // First clean up common LLM JSON issues
    let cleanedText = textToExtract;
    cleanedText = cleanedText.replace(/<\d+-\d+>/g, '50');
    cleanedText = cleanedText.replace(/<true\|false>/gi, 'false');
    cleanedText = cleanedText.replace(/"?<HIGH\|MEDIUM\|LOW>"?/gi, '"MEDIUM"');
    cleanedText = cleanedText.replace(/"?<TRUST_REVIEWS\|VERIFY_REVIEWS\|DISTRUST_REVIEWS>"?/gi, '"VERIFY_REVIEWS"');
    cleanedText = cleanedText.replace(/"<[^>]+>"/g, '""');
    cleanedText = cleanedText.replace(/<[^>]+>/g, 'null');

    // Use robust extractJSON function
    const analysis = extractJSON(cleanedText);

    if (!analysis) {
      console.warn('[review_analyzer] Could not extract JSON from response');
      return {
        error: 'Failed to parse AI response - no JSON found',
        raw_response: textToExtract.substring(0, 500),
        fake_review_score: null,
        confidence: null,
        recommendation: 'VERIFY_REVIEWS'
      };
    }

    // Add metadata to successful parse
    analysis.analyzed_at = new Date().toISOString();
    analysis.cost = estimateCost(result);
    analysis.review_quality = reviewQuality;

    if (!analysis.warranty_signals || typeof analysis.warranty_signals !== 'object') {
      analysis.warranty_signals = {
        mentions: [],
        positive_evidence: [],
        negative_evidence: [],
        follow_through: 'NONE_FOUND',
        confidence: 'LOW'
      };
    }

    // Include reasoning if available (from deepseek-reasoner)
    if (reasoningContent) {
      analysis.reasoning_trace = reasoningContent.substring(0, 2000);
    }

    return analysis;

  } catch (err) {
    return {
      error: err.message,
      platform_ratings: extractRatings(reviewData),
      review_quality: reviewQuality
    };
  }
}

function extractRatings(reviewData) {
  // Defensive check for missing data
  if (!reviewData || typeof reviewData !== 'object') {
    return { google: null, google_local: null, google_hq: null, bbb: null, glassdoor: null, yelp: null };
  }

  return {
    google: reviewData.google_maps?.rating || null,
    google_local: reviewData.google_maps_local?.rating || null,
    google_hq: reviewData.google_maps_hq?.rating || null,
    bbb: reviewData.bbb?.rating || null,
    glassdoor: reviewData.glassdoor?.rating || null,
    yelp: reviewData.yelp?.rating || null
  };
}

function estimateCost(response) {
  const usage = response.usage || {};
  return ((usage.prompt_tokens || 0) * 0.00000014) + ((usage.completion_tokens || 0) * 0.00000028);
}

/**
 * Quick discrepancy check without AI (for when API unavailable)
 */
function quickDiscrepancyCheck(reviewData) {
  // Defensive check for missing data
  if (!reviewData || typeof reviewData !== 'object') {
    return { discrepancy: false, reason: 'No review data provided', flags: [] };
  }

  const ratings = [];

  // Use Google Maps data - prefer unified google_maps, fallback to local/hq
  const gMaps = reviewData.google_maps;
  const gLocal = reviewData.google_maps_local;
  const gHQ = reviewData.google_maps_hq;

  if (gMaps?.rating) {
    // Use the new unified Google Maps Python scraper data
    ratings.push({ source: 'google', rating: gMaps.rating, review_count: gMaps.review_count });
  } else if (gLocal?.rating && gHQ?.rating) {
    // If both exist, use the one with more reviews as primary
    const primary = (gLocal.review_count || 0) >= (gHQ.review_count || 0) ? gLocal : gHQ;
    ratings.push({ source: 'google', rating: primary.rating, review_count: primary.review_count });
  } else if (gLocal?.rating) {
    ratings.push({ source: 'google_local', rating: gLocal.rating, review_count: gLocal.review_count });
  } else if (gHQ?.rating) {
    ratings.push({ source: 'google_hq', rating: gHQ.rating, review_count: gHQ.review_count });
  }
  if (reviewData.glassdoor?.rating) ratings.push({ source: 'glassdoor', rating: reviewData.glassdoor.rating });
  if (reviewData.bbb?.rating) {
    // Convert BBB letter to number
    const bbbScores = { 'A+': 5, 'A': 4.5, 'A-': 4, 'B+': 3.5, 'B': 3, 'B-': 2.5, 'C+': 2, 'C': 1.5, 'C-': 1, 'D': 0.5, 'F': 0 };
    const score = bbbScores[reviewData.bbb.rating];
    if (score !== undefined) ratings.push({ source: 'bbb', rating: score, original: reviewData.bbb.rating });
  }

  if (ratings.length < 2) {
    return { discrepancy: false, reason: 'Not enough platforms to compare', flags: [] };
  }

  // Find max difference
  const values = ratings.map(r => r.rating);
  const maxDiff = Math.max(...values) - Math.min(...values);

  // Calculate total review count across distinct platforms
  // Use MAX of Google locations (they may be the same listing searched from different areas)
  const bestGoogleReviews = Math.max(
    gMaps?.review_count || 0,
    gLocal?.review_count || 0,
    gHQ?.review_count || 0
  );
  const yelpReviews = reviewData.yelp?.review_count || reviewData.yelp_yahoo?.review_count || 0;
  const angiReviews = reviewData.angi?.review_count || 0;
  const trustpilotReviews = reviewData.trustpilot?.review_count || 0;
  const houzzReviews = reviewData.houzz?.review_count || 0;

  const totalReviews = bestGoogleReviews + yelpReviews + angiReviews + trustpilotReviews + houzzReviews;

  const result = {
    discrepancy: maxDiff > 1.5,
    max_difference: maxDiff,
    ratings: ratings,
    total_reviews: totalReviews,
    insufficient_reviews: totalReviews < 20,
    flags: []
  };

  // Flag if insufficient reviews for pattern detection
  if (totalReviews < 20) {
    result.flags.push(`INSUFFICIENT_REVIEWS: Only ${totalReviews} total reviews found - pattern detection unreliable`);
  }

  // Specific flags
  // Use best Google rating for comparisons
  const bestGoogleRating = Math.max(
    reviewData.google_maps?.rating || 0,
    reviewData.google_maps_local?.rating || 0,
    reviewData.google_maps_hq?.rating || 0
  );

  if (reviewData.bbb?.rating === 'F' && bestGoogleRating >= 4.5) {
    result.flags.push('CRITICAL: BBB F rating vs high Google rating - likely fake reviews or complaint suppression');
  }

  if (reviewData.glassdoor?.rating && bestGoogleRating > 0) {
    const diff = bestGoogleRating - reviewData.glassdoor.rating;
    if (diff > 1.5) {
      result.flags.push(`Employee rating (${reviewData.glassdoor.rating}) much lower than customer rating (${bestGoogleRating}) - potential internal issues`);
    }
  }

  // Check for suspicious review count discrepancy between local and HQ
  const localReviews = gMaps?.review_count || gLocal?.review_count || 0;
  const hqReviews = gHQ?.review_count || 0;

  if (localReviews > 10 && hqReviews > 0 && hqReviews < 5) {
    result.flags.push(`SUSPICIOUS: HQ location has only ${hqReviews} review(s) vs ${localReviews} in local market - possible fake/new listing`);
  }

  // Check for very high rating with very few reviews (likely fake)
  if (bestGoogleRating >= 4.8) {
    const totalGoogleReviews = Math.max(
      gMaps?.review_count || 0,
      gLocal?.review_count || 0,
      gHQ?.review_count || 0
    );
    if (totalGoogleReviews < 5) {
      result.flags.push(`SUSPICIOUS: ${bestGoogleRating}★ rating with only ${totalGoogleReviews} review(s) - likely fake or self-reviews`);
    }
  }

  return result;
}

module.exports = { analyzeReviews, quickDiscrepancyCheck, extractRatings };
