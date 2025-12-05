/**
 * Review Analyzer
 *
 * Uses AI to analyze reviews for fake patterns, sentiment issues, and discrepancies.
 * Runs during collection and stores summary for audit agent.
 */

const DEEPSEEK_API_BASE = 'https://api.deepseek.com/v1';

const ANALYSIS_PROMPT = `You are a review fraud analyst. Analyze these contractor reviews for signs of manipulation.

CHECK FOR:
1. **Fake Review Patterns**
   - Generic language ("Great service!", "Highly recommend!")
   - Timing clusters (many reviews in short period)
   - Similar writing style across reviews
   - Reviewer has only 1 review (shill accounts)
   - Overly detailed 5-star vs vague complaints

2. **Rating Manipulation**
   - Platform discrepancy (4.8 Google vs 2.1 Yelp = red flag)
   - Rating doesn't match review text sentiment
   - Sudden rating jumps after bad press

3. **Legitimate Complaint Patterns**
   - Same issue mentioned by multiple reviewers
   - Specific details (names, dates, amounts)
   - Company response patterns (defensive vs helpful)

4. **Red Flags**
   - Mentions of: deposits taken, work not completed, damage, ghosting
   - Legal threats in responses
   - Owner arguing with reviewers

OUTPUT FORMAT (JSON only):
{
  "fake_review_score": <0-100, higher = more likely fake>,
  "confidence": "<HIGH|MEDIUM|LOW>",
  "platform_ratings": {"google": 4.8, "yelp": null, "bbb": "F", "glassdoor": 3.2},
  "discrepancy_detected": <true|false>,
  "discrepancy_explanation": "<why ratings don't match>",
  "complaint_patterns": ["<pattern 1>", "<pattern 2>"],
  "fake_signals": ["<signal 1>", "<signal 2>"],
  "legitimate_signals": ["<signal 1>"],
  "summary": "<2-3 sentence summary for audit agent>",
  "recommendation": "<TRUST_REVIEWS|VERIFY_REVIEWS|DISTRUST_REVIEWS>"
}`;

async function analyzeReviews(contractorName, reviewData) {
  if (!process.env.DEEPSEEK_API_KEY) {
    return { error: 'DEEPSEEK_API_KEY not set', skipped: true };
  }

  // Build the review context
  let context = `## CONTRACTOR: ${contractorName}\n\n`;

  // Add platform ratings summary
  context += `## PLATFORM RATINGS\n`;
  if (reviewData.google_maps?.rating) {
    context += `- Google Maps: ${reviewData.google_maps.rating}★ (${reviewData.google_maps.review_count} reviews)\n`;
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

  // Add raw review text from each source
  context += `\n## RAW REVIEW DATA\n`;

  for (const [source, data] of Object.entries(reviewData)) {
    if (data.raw_text && data.raw_text.length > 50) {
      // Truncate to reasonable size
      const text = data.raw_text.length > 3000
        ? data.raw_text.substring(0, 3000) + '...[truncated]'
        : data.raw_text;
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
        model: 'deepseek-chat',
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
    const content = result.choices?.[0]?.message?.content || '';

    // Parse JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const analysis = JSON.parse(jsonMatch[0]);
      analysis.analyzed_at = new Date().toISOString();
      analysis.cost = estimateCost(result);
      return analysis;
    }

    return {
      error: 'Failed to parse AI response',
      raw_response: content.substring(0, 500)
    };

  } catch (err) {
    return {
      error: err.message,
      platform_ratings: extractRatings(reviewData)
    };
  }
}

function extractRatings(reviewData) {
  return {
    google: reviewData.google_maps?.rating || null,
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
  const ratings = [];

  if (reviewData.google_maps?.rating) ratings.push({ source: 'google', rating: reviewData.google_maps.rating });
  if (reviewData.glassdoor?.rating) ratings.push({ source: 'glassdoor', rating: reviewData.glassdoor.rating });
  if (reviewData.bbb?.rating) {
    // Convert BBB letter to number
    const bbbScores = { 'A+': 5, 'A': 4.5, 'A-': 4, 'B+': 3.5, 'B': 3, 'B-': 2.5, 'C+': 2, 'C': 1.5, 'C-': 1, 'D': 0.5, 'F': 0 };
    const score = bbbScores[reviewData.bbb.rating];
    if (score !== undefined) ratings.push({ source: 'bbb', rating: score, original: reviewData.bbb.rating });
  }

  if (ratings.length < 2) {
    return { discrepancy: false, reason: 'Not enough platforms to compare' };
  }

  // Find max difference
  const values = ratings.map(r => r.rating);
  const maxDiff = Math.max(...values) - Math.min(...values);

  const result = {
    discrepancy: maxDiff > 1.5,
    max_difference: maxDiff,
    ratings: ratings,
    flags: []
  };

  // Specific flags
  if (reviewData.bbb?.rating === 'F' && reviewData.google_maps?.rating >= 4.5) {
    result.flags.push('CRITICAL: BBB F rating vs high Google rating - likely fake reviews or complaint suppression');
  }

  if (reviewData.glassdoor?.rating && reviewData.google_maps?.rating) {
    const diff = reviewData.google_maps.rating - reviewData.glassdoor.rating;
    if (diff > 1.5) {
      result.flags.push(`Employee rating (${reviewData.glassdoor.rating}) much lower than customer rating (${reviewData.google_maps.rating}) - potential internal issues`);
    }
  }

  return result;
}

module.exports = { analyzeReviews, quickDiscrepancyCheck, extractRatings };
