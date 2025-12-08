/**
 * Review Analyzer
 *
 * Uses AI to analyze reviews for fake patterns, sentiment issues, and discrepancies.
 * Runs during collection and stores summary for audit agent.
 */

const DEEPSEEK_API_BASE = 'https://api.deepseek.com/v1';

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
  "summary": "Reviews appear authentic with minor concerns about response times.",
  "recommendation": "TRUST_REVIEWS"
}

IMPORTANT:
- fake_review_score must be a NUMBER from 0-100 (higher = more likely fake)
- discrepancy_detected must be true or false (no quotes)
- Output ONLY valid JSON, no additional text or markdown
- Replace example values above with your actual analysis`;

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

    const rawText = data.raw_text || '';
    if (rawText.length > 50) {
      // Truncate to reasonable size
      const text = rawText.length > 3000
        ? rawText.substring(0, 3000) + '...[truncated]'
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

  try {
    const response = await fetch(`${DEEPSEEK_API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify({
        model: 'deepseek-reasoner',
        messages: [
          { role: 'system', content: ANALYSIS_PROMPT },
          { role: 'user', content: context }
        ],
        temperature: 0.1,
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

    // Try to find JSON in content first, then in reasoning_content
    let jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch && reasoningContent) {
      jsonMatch = reasoningContent.match(/\{[\s\S]*\}/);
    }

    if (jsonMatch) {
      try {
        // Clean up common LLM JSON issues before parsing
        let jsonStr = jsonMatch[0];
        // Remove markdown code block markers if present
        jsonStr = jsonStr.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '');
        // Fix template placeholders that weren't replaced
        jsonStr = jsonStr.replace(/<0-100[^>]*>/g, '50');
        jsonStr = jsonStr.replace(/<true\|false>/g, 'false');
        jsonStr = jsonStr.replace(/<HIGH\|MEDIUM\|LOW>/g, '"MEDIUM"');
        jsonStr = jsonStr.replace(/<TRUST_REVIEWS\|VERIFY_REVIEWS\|DISTRUST_REVIEWS>/g, '"VERIFY_REVIEWS"');
        // Fix unquoted template strings
        jsonStr = jsonStr.replace(/<[^>]+>/g, '""');

        const analysis = JSON.parse(jsonStr);
        analysis.analyzed_at = new Date().toISOString();
        analysis.cost = estimateCost(result);
        // Include reasoning if available (from deepseek-reasoner)
        if (reasoningContent) {
          analysis.reasoning_trace = reasoningContent.substring(0, 2000);
        }
        return analysis;
      } catch (parseErr) {
        // JSON found but failed to parse
        return {
          error: `JSON parse error: ${parseErr.message}`,
          raw_response: jsonMatch[0].substring(0, 500)
        };
      }
    }

    return {
      error: 'Failed to parse AI response - no JSON found',
      raw_response: (content || reasoningContent).substring(0, 500)
    };

  } catch (err) {
    return {
      error: err.message,
      platform_ratings: extractRatings(reviewData)
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
