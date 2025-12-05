#!/usr/bin/env node
/**
 * Forensic Data Gatherer for Contractors
 *
 * Uses Puppeteer to scrape multiple data sources, then DeepSeek
 * to extract structured forensic data about a contractor.
 *
 * Usage:
 *   node forensic_audit_puppeteer.js --name "Company Name" --city "City" --state "TX"
 *   node forensic_audit_puppeteer.js --id 123  (lookup by contractor ID)
 *   node forensic_audit_puppeteer.js --id 123 --dry-run
 */

const initSqlJs = require('sql.js');
const fs = require('fs');
const puppeteer = require('puppeteer');
const path = require('path');

// Config
const DB_PATH = path.join(__dirname, 'db.sqlite3');
const DEEPSEEK_API_BASE = 'https://api.deepseek.com/v1';
const DEEPSEEK_MODEL = 'deepseek-chat';
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const MAX_HTML_CHARS = 60000;

// Parse CLI args
const args = process.argv.slice(2);
const getArg = (name) => {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return null;
  if (['dry-run', 'verbose'].includes(name)) return true;
  return args[idx + 1];
};

const NAME = getArg('name');
const CITY = getArg('city');
const STATE = getArg('state');
const CONTRACTOR_ID = getArg('id') ? parseInt(getArg('id')) : null;
const DRY_RUN = getArg('dry-run') || false;
const VERBOSE = getArg('verbose') || false;

// Logging helpers
const log = (msg) => console.log(msg);
const success = (msg) => console.log(`\x1b[32m${msg}\x1b[0m`);
const warn = (msg) => console.log(`\x1b[33m${msg}\x1b[0m`);
const error = (msg) => console.log(`\x1b[31m${msg}\x1b[0m`);
const debug = (msg) => VERBOSE && console.log(`\x1b[90m${msg}\x1b[0m`);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Convert name to URL-friendly slug
 */
function toSlug(name) {
  return name.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

/**
 * Build URLs for a contractor
 */
function buildUrls(name, city, state, website, zip) {
  const encodedName = encodeURIComponent(name);
  const encodedCity = encodeURIComponent(city);
  const encodedState = encodeURIComponent(state);
  const location = `${encodedCity},%20${encodedState}`;
  const nameSlug = toSlug(name);
  const citySlug = toSlug(city);
  const stateLower = state.toLowerCase();

  const urls = {
    // Original sources
    bbb: `https://www.bbb.org/search?find_text=${encodedName}&find_loc=${location}`,
    yelp: `https://www.yelp.com/search?find_desc=${encodedName}&find_loc=${encodedCity},%20${encodedState}`,
    google_maps: `https://www.google.com/maps/search/${encodedName}+${encodedCity}+${encodedState}`,
    google_news: `https://www.google.com/search?q=${encodedName}+${encodedCity}+lawsuit+OR+complaint&tbm=nws`,

    // New sources
    angi: `https://www.angi.com/search?query=${encodedName}&location=${encodedCity},%20${encodedState}`,
    houzz: `https://www.houzz.com/search/professionals/query/${encodedName}/location/${citySlug}--${stateLower}`,
    thumbtack: zip
      ? `https://www.thumbtack.com/search?query=${encodedName}&zip=${zip}`
      : `https://www.thumbtack.com/search?query=${encodedName}&location=${encodedCity},%20${encodedState}`,
    indeed: `https://www.indeed.com/cmp/${nameSlug}/reviews`,
    glassdoor: `https://www.glassdoor.com/Search/results.htm?keyword=${encodedName}`,
    facebook: `https://www.facebook.com/search/pages?q=${encodedName}%20${encodedCity}`
  };

  if (website) {
    let normalizedUrl = website.trim();
    if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
      normalizedUrl = 'https://' + normalizedUrl;
    }
    urls.website = normalizedUrl;
  }

  return urls;
}

/**
 * Strip HTML tags and extract meaningful text content
 */
function extractTextContent(html) {
  if (!html) return '';

  // Remove script and style content
  let text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '');

  // Convert common elements to readable format
  text = text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n\n');

  // Remove remaining HTML tags
  text = text.replace(/<[^>]+>/g, ' ');

  // Decode HTML entities
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–');

  // Clean up whitespace
  text = text
    .replace(/\s+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return text;
}

/**
 * Fetch a page with Puppeteer
 */
async function fetchPage(browser, url, source, timeout = 20000) {
  const page = await browser.newPage();

  try {
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    log(`  Fetching ${source}...`);
    debug(`    URL: ${url}`);

    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout
    });

    // Extra wait for JS-heavy sites
    await sleep(1500);

    const html = await page.content();
    const text = extractTextContent(html);
    const htmlSize = Math.round(html.length / 1024);
    const textSize = Math.round(text.length / 1024);
    success(`    ${source}: ${htmlSize}KB HTML -> ${textSize}KB text`);

    return {
      source,
      url,
      status: 'success',
      html: text  // Store extracted text instead of raw HTML
    };
  } catch (err) {
    warn(`    ${source}: ${err.message.split('\n')[0]}`);
    return {
      source,
      url,
      status: 'error',
      error: err.message,
      html: null
    };
  } finally {
    await page.close();
  }
}

/**
 * Fetch all sources for a contractor
 */
async function fetchAllSources(browser, name, city, state, website, zip) {
  const urls = buildUrls(name, city, state, website, zip);
  const results = [];

  log('\nFetching data sources...');
  log(`Sources to check: ${Object.keys(urls).length}`);

  // Fetch each source sequentially to be polite
  for (const [source, url] of Object.entries(urls)) {
    const result = await fetchPage(browser, url, source);
    results.push(result);
    await sleep(1000); // Delay between requests
  }

  return results;
}

/**
 * Concatenate text content from all sources
 */
function concatenateContent(results) {
  let combined = '';

  for (const result of results) {
    if (result.html) {
      combined += `\n\n========== SOURCE: ${result.source.toUpperCase()} ==========\n`;
      combined += `URL: ${result.url}\n\n`;
      combined += result.html;
    } else {
      combined += `\n\n========== SOURCE: ${result.source.toUpperCase()} ==========\n`;
      combined += `STATUS: NOT FOUND / ERROR: ${result.error || 'unknown'}\n`;
    }
  }

  // Truncate if needed
  if (combined.length > MAX_HTML_CHARS) {
    log(`\nTruncating content from ${Math.round(combined.length/1024)}KB to ${Math.round(MAX_HTML_CHARS/1024)}KB`);
    combined = combined.substring(0, MAX_HTML_CHARS) + '\n[TRUNCATED]';
  }

  return combined;
}

/**
 * Build the extraction prompt for DeepSeek
 */
function buildExtractionPrompt(contractorName, city, state, sourceSummary) {
  return `Analyze the following HTML data collected from multiple sources about the contractor "${contractorName}" in ${city}, ${state}.

SOURCES CHECKED:
${sourceSummary}

Extract ALL available information and return ONLY valid JSON (no markdown, no explanation) in this exact structure:

{
  "contractor_name": "${contractorName}",
  "location": "${city}, ${state}",

  "bbb": {
    "found": true/false,
    "grade": "A+, A, B, C, D, F, or null",
    "accredited": true/false/null,
    "years_in_business": number or null,
    "complaint_count": number or null,
    "complaint_details": "brief summary of complaints if any",
    "owner_names": ["name1", "name2"] or [],
    "profile_url": "url or null"
  },

  "yelp": {
    "found": true/false,
    "rating": number (1-5) or null,
    "review_count": number or null,
    "complaint_themes": ["theme1", "theme2"],
    "positive_themes": ["theme1", "theme2"],
    "fake_review_indicators": ["indicator1"] or [],
    "profile_url": "url or null"
  },

  "google": {
    "found": true/false,
    "rating": number (1-5) or null,
    "review_count": number or null,
    "negative_themes": ["theme1", "theme2"],
    "positive_themes": ["theme1", "theme2"]
  },

  "news": {
    "found": true/false,
    "lawsuits": ["brief description1"],
    "investigations": ["brief description1"],
    "complaints": ["brief description1"],
    "positive_coverage": ["brief description1"]
  },

  "website": {
    "found": true/false,
    "claimed_years_in_business": number or null,
    "portfolio_exists": true/false/null,
    "owner_names": ["name1"] or [],
    "certifications_claimed": ["cert1"] or [],
    "contact_info_complete": true/false
  },

  "angi": {
    "found": true/false,
    "rating": number (1-5) or null,
    "review_count": number or null,
    "badges": ["badge1", "badge2"] or [],
    "verified": true/false/null,
    "source_url": "url or null"
  },

  "houzz": {
    "found": true/false,
    "rating": number (1-5) or null,
    "review_count": number or null,
    "complaint_narratives": ["narrative describing complaint"] or [],
    "has_portfolio": true/false/null,
    "badges": ["badge1"] or [],
    "source_url": "url or null"
  },

  "thumbtack": {
    "found": true/false,
    "rating": number (1-5) or null,
    "review_count": number or null,
    "hire_rate": "percentage or null",
    "response_time": "description or null",
    "source_url": "url or null"
  },

  "indeed_reviews": {
    "found": true/false,
    "rating": number (1-5) or null,
    "review_count": number or null,
    "management_rating": number (1-5) or null,
    "turnover_signals": ["signal1", "signal2"] or [],
    "commission_only_mentions": true/false,
    "source_url": "url or null"
  },

  "glassdoor": {
    "found": true/false,
    "rating": number (1-5) or null,
    "review_count": number or null,
    "ceo_approval": "percentage or null",
    "recommend_to_friend": "percentage or null",
    "source_url": "url or null"
  },

  "facebook": {
    "found": true/false,
    "rating": number (1-5) or null,
    "recommendation_count": number or null,
    "response_time": "description or null",
    "page_likes": number or null,
    "source_url": "url or null"
  },

  "red_flags": [
    {
      "severity": "high/medium/low",
      "category": "rating_conflict/name_mismatch/complaint_pattern/legal/review_fraud/employee_turnover/deposit_abandonment/no_presence/other",
      "description": "Clear description of the issue",
      "evidence": "What data supports this flag"
    }
  ],

  "trust_assessment": {
    "overall_score": 0-100,
    "confidence": "high/medium/low",
    "recommendation": "recommended/caution/avoid",
    "summary": "2-3 sentence assessment"
  },

  "sources_checked": ["bbb", "yelp", "google_maps", "google_news", "website", "angi", "houzz", "thumbtack", "indeed", "glassdoor", "facebook"],
  "sources_found": ["list of sources where data was found"],
  "data_quality": "high/medium/low"
}

RED FLAG DETECTION RULES (apply these):
1. Houzz complaints mentioning deposits taken then work abandoned = SEVERITY: HIGH, CATEGORY: deposit_abandonment
2. Indeed/Glassdoor reviews mentioning high turnover or commission-only pay = SEVERITY: MEDIUM, CATEGORY: employee_turnover
3. Rating conflicts: If Angi vs Yelp vs Google ratings differ by >1 star = SEVERITY: MEDIUM, CATEGORY: rating_conflict (potential manipulation)
4. No presence on ANY review platform for an established business = SEVERITY: MEDIUM, CATEGORY: no_presence (suspicious)
5. BBB grade F or D with high ratings elsewhere = SEVERITY: HIGH, CATEGORY: rating_conflict
6. Multiple platforms showing deposit/abandonment complaints = SEVERITY: HIGH, CATEGORY: deposit_abandonment

IMPORTANT:
- Look for rating conflicts across ALL platforms (BBB, Yelp, Google, Angi, Houzz, Thumbtack, Facebook)
- Check for name mismatches across sources
- Identify complaint patterns especially around deposits and project abandonment
- Note any lawsuits, investigations, or news coverage
- Flag fake review indicators (unusual patterns, generic text, suspiciously perfect scores)
- Employee review sites (Indeed, Glassdoor) can reveal internal problems
- If BBB shows complaints or bad rating, this is significant

HTML DATA:
`;
}

/**
 * Call DeepSeek API for extraction
 */
async function extractWithDeepSeek(html, contractorName, city, state, results) {
  if (!DEEPSEEK_API_KEY) {
    throw new Error('DEEPSEEK_API_KEY environment variable not set');
  }

  // Build source summary
  const sourceSummary = results.map(r =>
    `- ${r.source}: ${r.status === 'success' ? 'LOADED' : 'NOT FOUND/ERROR'}`
  ).join('\n');

  const prompt = buildExtractionPrompt(contractorName, city, state, sourceSummary);
  const fullPrompt = prompt + html;

  log('\nSending to DeepSeek for analysis...');
  debug(`  Prompt size: ${Math.round(fullPrompt.length/1024)}KB`);

  const response = await fetch(`${DEEPSEEK_API_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages: [
        {
          role: 'system',
          content: 'You are a forensic data analyst specializing in contractor verification. Extract structured data from HTML and identify red flags. Return only valid JSON, never markdown code blocks.'
        },
        {
          role: 'user',
          content: fullPrompt
        }
      ],
      temperature: 0.1,
      max_tokens: 4000
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`DeepSeek API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('Empty response from DeepSeek');
  }

  debug(`  Response length: ${content.length} chars`);

  // Parse JSON from response
  let jsonStr = content.trim();
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
  }

  try {
    return JSON.parse(jsonStr);
  } catch (err) {
    // Try to extract JSON from response
    const match = jsonStr.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]);
    }
    throw new Error(`Failed to parse DeepSeek response: ${content.substring(0, 500)}`);
  }
}

/**
 * Save audit results to database
 */
async function saveAuditResults(db, contractorId, auditData) {
  const now = new Date().toISOString();

  // Calculate scores from audit data
  const trustScore = auditData.trust_assessment?.overall_score || 50;
  const confidence = auditData.trust_assessment?.confidence || 'low';
  const recommendation = auditData.trust_assessment?.recommendation || 'caution';

  // Insert into contractors_contractoraudit
  db.run(`
    INSERT INTO contractors_contractoraudit (
      contractor_id, audit_date, total_score, sentiment_score, ai_summary,
      score_breakdown, base_score, credibility_score, data_confidence,
      data_gaps, financial_score, homeowner_guidance, multiplier_applied,
      multiplier_reason, narrative_summary, normalized_score,
      perplexity_data, recommendation, red_flag_score, reputation_score,
      risk_level, sources_used, synthesis_data, trust_score, verification_score
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    contractorId,
    now,
    trustScore,
    0, // sentiment_score
    auditData.trust_assessment?.summary || '',
    JSON.stringify({
      bbb: auditData.bbb,
      yelp: auditData.yelp,
      google: auditData.google
    }),
    trustScore,
    auditData.bbb?.found ? 20 : 0,
    confidence,
    JSON.stringify(auditData.sources_checked?.filter(s => !auditData.sources_found?.includes(s)) || []),
    0,
    JSON.stringify([]),
    1.0,
    '',
    auditData.trust_assessment?.summary || '',
    trustScore,
    null,
    recommendation,
    auditData.red_flags?.length || 0,
    (auditData.google?.rating || 0) * 20,
    recommendation === 'avoid' ? 'high' : (recommendation === 'caution' ? 'medium' : 'low'),
    JSON.stringify(auditData.sources_found || []),
    JSON.stringify(auditData),
    trustScore,
    auditData.website?.found ? 20 : 0
  ]);

  // Get the audit ID we just created
  const auditIdResult = db.exec('SELECT last_insert_rowid()');
  const auditId = auditIdResult[0].values[0][0];

  // Insert red flags
  if (auditData.red_flags && auditData.red_flags.length > 0) {
    for (const flag of auditData.red_flags) {
      db.run(`
        INSERT INTO contractors_redflag (
          audit_id, severity, category, description, evidence, source, source_url
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [
        auditId,
        flag.severity || 'medium',
        flag.category || 'other',
        flag.description || '',
        flag.evidence || '',
        'forensic_audit',
        ''
      ]);
    }
  }

  // Update the contractor's last_audited_at and ai fields
  db.run(`
    UPDATE contractors_contractor SET
      last_audited_at = ?,
      ai_summary = ?,
      ai_red_flags = ?,
      bbb_rating = COALESCE(?, bbb_rating),
      bbb_complaint_count = COALESCE(?, bbb_complaint_count),
      bbb_years_in_business = COALESCE(?, bbb_years_in_business),
      google_rating = COALESCE(?, google_rating),
      google_review_count = COALESCE(?, google_review_count),
      yelp_rating = COALESCE(?, yelp_rating),
      yelp_review_count = COALESCE(?, yelp_review_count)
    WHERE id = ?
  `, [
    now,
    auditData.trust_assessment?.summary || '',
    JSON.stringify(auditData.red_flags || []),
    auditData.bbb?.grade || null,
    auditData.bbb?.complaint_count || null,
    auditData.bbb?.years_in_business || null,
    auditData.google?.rating || null,
    auditData.google?.review_count || null,
    auditData.yelp?.rating || null,
    auditData.yelp?.review_count || null,
    contractorId
  ]);

  return auditId;
}

/**
 * Print audit summary
 */
function printAuditSummary(auditData) {
  log('\n' + '='.repeat(60));
  log('FORENSIC AUDIT RESULTS');
  log('='.repeat(60));

  log(`\nContractor: ${auditData.contractor_name}`);
  log(`Location: ${auditData.location}`);

  log('\n--- DATA SOURCES ---');
  log(`Checked: ${auditData.sources_checked?.join(', ') || 'unknown'}`);
  log(`Found: ${auditData.sources_found?.join(', ') || 'none'}`);
  log(`Data Quality: ${auditData.data_quality || 'unknown'}`);

  if (auditData.bbb?.found) {
    log('\n--- BBB ---');
    log(`  Grade: ${auditData.bbb.grade || 'N/A'}`);
    log(`  Accredited: ${auditData.bbb.accredited ? 'Yes' : 'No'}`);
    log(`  Years in Business: ${auditData.bbb.years_in_business || 'N/A'}`);
    log(`  Complaints: ${auditData.bbb.complaint_count || 0}`);
    if (auditData.bbb.complaint_details) {
      log(`  Details: ${auditData.bbb.complaint_details}`);
    }
  }

  if (auditData.yelp?.found) {
    log('\n--- YELP ---');
    log(`  Rating: ${auditData.yelp.rating || 'N/A'}/5`);
    log(`  Reviews: ${auditData.yelp.review_count || 0}`);
    if (auditData.yelp.complaint_themes?.length) {
      warn(`  Complaint Themes: ${auditData.yelp.complaint_themes.join(', ')}`);
    }
    if (auditData.yelp.fake_review_indicators?.length) {
      error(`  Fake Review Indicators: ${auditData.yelp.fake_review_indicators.join(', ')}`);
    }
  }

  if (auditData.google?.found) {
    log('\n--- GOOGLE ---');
    log(`  Rating: ${auditData.google.rating || 'N/A'}/5`);
    log(`  Reviews: ${auditData.google.review_count || 0}`);
    if (auditData.google.negative_themes?.length) {
      warn(`  Negative Themes: ${auditData.google.negative_themes.join(', ')}`);
    }
  }

  if (auditData.angi?.found) {
    log('\n--- ANGI ---');
    log(`  Rating: ${auditData.angi.rating || 'N/A'}/5`);
    log(`  Reviews: ${auditData.angi.review_count || 0}`);
    if (auditData.angi.verified) {
      success(`  Verified: Yes`);
    }
    if (auditData.angi.badges?.length) {
      log(`  Badges: ${auditData.angi.badges.join(', ')}`);
    }
  }

  if (auditData.houzz?.found) {
    log('\n--- HOUZZ ---');
    log(`  Rating: ${auditData.houzz.rating || 'N/A'}/5`);
    log(`  Reviews: ${auditData.houzz.review_count || 0}`);
    log(`  Has Portfolio: ${auditData.houzz.has_portfolio ? 'Yes' : 'No'}`);
    if (auditData.houzz.complaint_narratives?.length) {
      error(`  Complaint Narratives: ${auditData.houzz.complaint_narratives.join('; ')}`);
    }
    if (auditData.houzz.badges?.length) {
      log(`  Badges: ${auditData.houzz.badges.join(', ')}`);
    }
  }

  if (auditData.thumbtack?.found) {
    log('\n--- THUMBTACK ---');
    log(`  Rating: ${auditData.thumbtack.rating || 'N/A'}/5`);
    log(`  Reviews: ${auditData.thumbtack.review_count || 0}`);
    if (auditData.thumbtack.hire_rate) {
      log(`  Hire Rate: ${auditData.thumbtack.hire_rate}`);
    }
    if (auditData.thumbtack.response_time) {
      log(`  Response Time: ${auditData.thumbtack.response_time}`);
    }
  }

  if (auditData.indeed_reviews?.found) {
    log('\n--- INDEED (Employee Reviews) ---');
    log(`  Rating: ${auditData.indeed_reviews.rating || 'N/A'}/5`);
    log(`  Reviews: ${auditData.indeed_reviews.review_count || 0}`);
    if (auditData.indeed_reviews.management_rating) {
      log(`  Management Rating: ${auditData.indeed_reviews.management_rating}/5`);
    }
    if (auditData.indeed_reviews.turnover_signals?.length) {
      warn(`  Turnover Signals: ${auditData.indeed_reviews.turnover_signals.join(', ')}`);
    }
    if (auditData.indeed_reviews.commission_only_mentions) {
      warn(`  Commission-Only Mentions: Yes`);
    }
  }

  if (auditData.glassdoor?.found) {
    log('\n--- GLASSDOOR ---');
    log(`  Rating: ${auditData.glassdoor.rating || 'N/A'}/5`);
    log(`  Reviews: ${auditData.glassdoor.review_count || 0}`);
    if (auditData.glassdoor.ceo_approval) {
      log(`  CEO Approval: ${auditData.glassdoor.ceo_approval}`);
    }
    if (auditData.glassdoor.recommend_to_friend) {
      log(`  Recommend to Friend: ${auditData.glassdoor.recommend_to_friend}`);
    }
  }

  if (auditData.facebook?.found) {
    log('\n--- FACEBOOK ---');
    log(`  Rating: ${auditData.facebook.rating || 'N/A'}/5`);
    log(`  Recommendations: ${auditData.facebook.recommendation_count || 0}`);
    if (auditData.facebook.page_likes) {
      log(`  Page Likes: ${auditData.facebook.page_likes}`);
    }
    if (auditData.facebook.response_time) {
      log(`  Response Time: ${auditData.facebook.response_time}`);
    }
  }

  if (auditData.news?.found) {
    log('\n--- NEWS/LEGAL ---');
    if (auditData.news.lawsuits?.length) {
      error(`  Lawsuits: ${auditData.news.lawsuits.join('; ')}`);
    }
    if (auditData.news.investigations?.length) {
      error(`  Investigations: ${auditData.news.investigations.join('; ')}`);
    }
    if (auditData.news.complaints?.length) {
      warn(`  Complaints: ${auditData.news.complaints.join('; ')}`);
    }
    if (auditData.news.positive_coverage?.length) {
      success(`  Positive Coverage: ${auditData.news.positive_coverage.join('; ')}`);
    }
  }

  if (auditData.red_flags?.length) {
    log('\n--- RED FLAGS ---');
    for (const flag of auditData.red_flags) {
      const color = flag.severity === 'high' ? error : warn;
      color(`  [${flag.severity.toUpperCase()}] ${flag.category}: ${flag.description}`);
      if (flag.evidence) {
        log(`    Evidence: ${flag.evidence}`);
      }
    }
  }

  log('\n--- TRUST ASSESSMENT ---');
  const score = auditData.trust_assessment?.overall_score;
  const scoreColor = score >= 70 ? success : (score >= 40 ? warn : error);
  scoreColor(`  Score: ${score}/100`);
  log(`  Confidence: ${auditData.trust_assessment?.confidence || 'unknown'}`);
  const rec = auditData.trust_assessment?.recommendation;
  const recColor = rec === 'recommended' ? success : (rec === 'caution' ? warn : error);
  recColor(`  Recommendation: ${rec?.toUpperCase() || 'UNKNOWN'}`);
  log(`  Summary: ${auditData.trust_assessment?.summary || 'N/A'}`);

  log('\n' + '='.repeat(60));
}

/**
 * Main function
 */
async function main() {
  log('=== FORENSIC CONTRACTOR AUDIT ===\n');

  if (!DEEPSEEK_API_KEY) {
    error('ERROR: DEEPSEEK_API_KEY environment variable not set');
    error('Set it with: export DEEPSEEK_API_KEY=your_key_here');
    process.exit(1);
  }

  // Validate args
  if (!CONTRACTOR_ID && (!NAME || !CITY || !STATE)) {
    error('Usage:');
    error('  node forensic_audit_puppeteer.js --name "Company" --city "City" --state "TX"');
    error('  node forensic_audit_puppeteer.js --id 123');
    error('\nOptions:');
    error('  --dry-run    Do not save to database');
    error('  --verbose    Show debug output');
    process.exit(1);
  }

  if (DRY_RUN) {
    warn('DRY RUN MODE - not saving to database\n');
  }

  // Open database
  const SQL = await initSqlJs();
  const dbBuffer = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(dbBuffer);

  let contractorName, city, state, website, contractorId, zip;

  // Look up contractor
  if (CONTRACTOR_ID) {
    const result = db.exec(`
      SELECT id, business_name, city, state, website, zip_code
      FROM contractors_contractor
      WHERE id = ?
    `, [CONTRACTOR_ID]);

    if (!result.length || !result[0].values.length) {
      error(`Contractor with ID ${CONTRACTOR_ID} not found`);
      db.close();
      process.exit(1);
    }

    const row = result[0].values[0];
    contractorId = row[0];
    contractorName = row[1];
    city = row[2];
    state = row[3];
    website = row[4];
    zip = row[5];
  } else {
    contractorName = NAME;
    city = CITY;
    state = STATE;

    // Try to find existing contractor
    const result = db.exec(`
      SELECT id, website, zip_code
      FROM contractors_contractor
      WHERE LOWER(business_name) LIKE LOWER(?)
        AND LOWER(city) LIKE LOWER(?)
        AND state = ?
      LIMIT 1
    `, [`%${contractorName}%`, `%${city}%`, state.toUpperCase()]);

    if (result.length && result[0].values.length) {
      contractorId = result[0].values[0][0];
      website = result[0].values[0][1];
      zip = result[0].values[0][2];
      log(`Found existing contractor ID: ${contractorId}`);
    } else {
      contractorId = null;
      website = null;
      zip = null;
      log('Contractor not in database - will audit without saving');
    }
  }

  log(`\nAuditing: ${contractorName}`);
  log(`Location: ${city}, ${state}`);
  if (website) log(`Website: ${website}`);
  if (zip) log(`Zip: ${zip}`);

  // Launch browser
  log('\nLaunching browser...');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    // Fetch all sources
    const results = await fetchAllSources(browser, contractorName, city, state, website, zip);

    // Summarize what we got
    const successCount = results.filter(r => r.status === 'success').length;
    log(`\nFetched ${successCount}/${results.length} sources successfully`);

    // Concatenate text content
    const combinedContent = concatenateContent(results);
    log(`Combined content: ${Math.round(combinedContent.length/1024)}KB`);

    // Extract with DeepSeek
    const auditData = await extractWithDeepSeek(combinedContent, contractorName, city, state, results);

    // Print summary
    printAuditSummary(auditData);

    // Save to database
    if (!DRY_RUN && contractorId) {
      log('\nSaving to database...');
      const auditId = await saveAuditResults(db, contractorId, auditData);
      success(`Audit saved with ID: ${auditId}`);

      // Save database
      const data = db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(DB_PATH, buffer);
      success('Database saved.');
    } else if (!contractorId) {
      warn('\nContractor not in database - results not saved');
      warn('Add contractor first or use --id with existing contractor');
    } else {
      warn('\nDRY RUN - results not saved');
    }

    // Return audit data for programmatic use
    return auditData;

  } finally {
    await browser.close();
    db.close();
  }
}

// Run
main().catch(err => {
  error(`Fatal error: ${err.message}`);
  if (VERBOSE) {
    console.error(err.stack);
  }
  process.exit(1);
});
