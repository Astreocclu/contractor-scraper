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

OUTPUT FORMAT (JSON only):
{
  "fake_review_score": <0-100, higher = more likely fake>,
  "confidence": "<HIGH|MEDIUM|LOW>",
  "platform_ratings": {"google": 4.8, "yelp": null, "bbb": "F", "glassdoor": 3.2},
  "discrepancy_detected": <true|false>,
  "discrepancy_explanation": "<why ratings don't match, if applicable>",
  "complaint_patterns": ["<pattern 1>", "<pattern 2>"],
  "fake_signals": ["<signal 1>", "<signal 2>"],
  "authentic_signals": ["<evidence of real reviews>"],
  "summary": "<2-3 sentence summary - what's the real story?>",
  "recommendation": "<TRUST_REVIEWS|VERIFY_REVIEWS|DISTRUST_REVIEWS>"
}`;

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
    const textToSearch = content || reasoningContent;

    // Parse JSON from response
    const jsonMatch = textToSearch.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const analysis = JSON.parse(jsonMatch[0]);
      analysis.analyzed_at = new Date().toISOString();
      analysis.cost = estimateCost(result);
      // Include reasoning if available (from deepseek-reasoner)
      if (reasoningContent && !content) {
        analysis.reasoning_trace = reasoningContent.substring(0, 2000);
      }
      return analysis;
    }

    return {
      error: 'Failed to parse AI response',
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
    return { google: null, bbb: null, glassdoor: null, yelp: null };
  }

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
  // Defensive check for missing data
  if (!reviewData || typeof reviewData !== 'object') {
    return { discrepancy: false, reason: 'No review data provided', flags: [] };
  }

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
    return { discrepancy: false, reason: 'Not enough platforms to compare', flags: [] };
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
