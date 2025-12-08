/**
 * Cold Email Draft Factory - Dumb Executor
 *
 * Reads enriched JSON from matcher.py and creates Gmail drafts.
 * Uses DeepSeek for personalized email generation.
 *
 * CRITICAL: This script ONLY creates drafts. It does NOT send emails.
 *
 * Usage:
 *   1. Run: python tools/matcher.py --trade pool --limit 20
 *   2. Run: node index.js
 *   3. Review drafts in Gmail before sending
 */

const fs = require('fs').promises;
const path = require('path');
const { google } = require('googleapis');
const readline = require('readline');

// Paths
const TOKEN_PATH = path.join(__dirname, 'token.json');
const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');
const LEADS_PATH = path.join(__dirname, 'leads_enriched.json');
const SENT_HISTORY_PATH = path.join(__dirname, 'sent_history.json');

// OAuth2 scopes
const SCOPES = ['https://www.googleapis.com/auth/gmail.compose'];

// DeepSeek API configuration
const DEEPSEEK_API_BASE = 'https://api.deepseek.com/v1';

// Personalities for variety
const PERSONALITIES = [
  { name: 'Reid', style: 'direct Texas guy, gets straight to the point, no BS' },
  { name: 'Reid', style: 'casual and friendly, talks like texting a buddy' },
  { name: 'Reid', style: 'data-driven, mentions specific numbers, analytical but personable' },
  { name: 'Reid', style: 'knows the grind, talks about beating competition and winning jobs' },
  { name: 'Reid', style: 'laid-back advisor, gives helpful tips, sounds like a friend with good leads' }
];

/**
 * Formats currency for display
 */
function formatMoney(value) {
  if (!value) return '$0';
  return '$' + value.toLocaleString();
}

/**
 * Generates email using DeepSeek with dynamic stats from enriched JSON
 */
async function generateEmailBody(contractor) {
  const { business_name, city, trade, stats, sample_leads } = contractor;

  // Format sample leads for the prompt
  const leadHook = sample_leads.map(l =>
    `- ${l.address} (Value: ${formatMoney(l.value)}, Permit: ${l.permit_date || 'recent'})`
  ).join('\n');

  // Pick a random personality
  const persona = PERSONALITIES[Math.floor(Math.random() * PERSONALITIES.length)];

  const prompt = `You're Reid, a lead data analyst. Write a short cold email to ${business_name}, a ${trade} contractor in ${city}.

You have ${stats.overall_lead_count} homeowner leads in DFW who are starting ${trade} projects. ${stats.overall_hot_count} are from the last 30 days. Average home value: ${formatMoney(stats.avg_value)}.

Sample properties you could mention:
${leadHook}

Keep it short and natural. Sign off as "Reid - Lead Data Analyst".

Return JSON: {"subject": "...", "body": "..."}`;

  try {
    const response = await fetch(`${DEEPSEEK_API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.9,
        max_tokens: 500
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`DeepSeek API error ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    if (!content) {
      throw new Error('Empty response from DeepSeek');
    }

    // Extract JSON from response
    let jsonStr = content;
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }
    const objectMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      jsonStr = objectMatch[0];
    }

    return JSON.parse(jsonStr);
  } catch (err) {
    console.error(`  [DeepSeek fallback]: ${err.message}`);
    // Fallback to simple template
    return {
      subject: `${city} ${trade} leads?`,
      body: `Hey,

I've got a list of ${stats.overall_lead_count} homeowners in DFW actively starting ${trade} projects. Average home value around ${formatMoney(stats.avg_value)}.

Want me to send over a few samples?

Reid
Lead Data Analyst`
    };
  }
}

/**
 * Creates an RFC 822 formatted email message
 */
function createRFC822Message(to, subject, body) {
  const messageParts = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    body
  ];

  const message = messageParts.join('\r\n');

  return Buffer.from(message)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Creates a draft in Gmail (does NOT send)
 */
async function createDraft(auth, contractor) {
  const gmail = google.gmail({ version: 'v1', auth });

  const { subject, body } = await generateEmailBody(contractor);
  const rawMessage = createRFC822Message(contractor.contractor_email, subject, body);

  const response = await gmail.users.drafts.create({
    userId: 'me',
    requestBody: {
      message: { raw: rawMessage }
    }
  });

  return { subject, body, draftId: response.data.id };
}

/**
 * Load sent history
 */
async function loadSentHistory() {
  try {
    const content = await fs.readFile(SENT_HISTORY_PATH, 'utf8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

/**
 * Save sent history
 */
async function saveSentHistory(history) {
  await fs.writeFile(SENT_HISTORY_PATH, JSON.stringify(history, null, 2));
}

/**
 * Delay helper
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Load saved credentials
 */
async function loadSavedCredentials() {
  try {
    const content = await fs.readFile(TOKEN_PATH);
    return google.auth.fromJSON(JSON.parse(content));
  } catch {
    return null;
  }
}

/**
 * Save credentials
 */
async function saveCredentials(client) {
  const content = await fs.readFile(CREDENTIALS_PATH);
  const keys = JSON.parse(content);
  const key = keys.installed || keys.web;

  await fs.writeFile(TOKEN_PATH, JSON.stringify({
    type: 'authorized_user',
    client_id: key.client_id,
    client_secret: key.client_secret,
    refresh_token: client.credentials.refresh_token,
  }));
}

/**
 * Prompt for auth code
 */
function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise(resolve => rl.question(query, ans => {
    rl.close();
    resolve(ans);
  }));
}

/**
 * Authorize with Google
 */
async function authorize() {
  let client = await loadSavedCredentials();
  if (client) {
    console.log('Using saved credentials...');
    return client;
  }

  const content = await fs.readFile(CREDENTIALS_PATH);
  const keys = JSON.parse(content);
  const key = keys.installed || keys.web;

  const oAuth2Client = new google.auth.OAuth2(
    key.client_id,
    key.client_secret,
    key.redirect_uris?.[0] || 'urn:ietf:wg:oauth:2.0:oob'
  );

  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
  });

  console.log('\n===========================================');
  console.log('AUTHORIZATION REQUIRED');
  console.log('===========================================');
  console.log('Open this URL in your browser:\n');
  console.log(authUrl);
  console.log('\n===========================================\n');

  const code = await askQuestion('Enter the authorization code: ');
  const { tokens } = await oAuth2Client.getToken(code);
  oAuth2Client.setCredentials(tokens);

  await saveCredentials(oAuth2Client);
  console.log('Credentials saved to token.json\n');

  return oAuth2Client;
}

/**
 * Main execution
 */
async function main() {
  console.log('\n========================================');
  console.log('  COLD EMAIL DRAFT FACTORY');
  console.log('  Dumb Executor Mode');
  console.log('========================================\n');

  // Check for credentials
  try {
    await fs.access(CREDENTIALS_PATH);
  } catch {
    console.error('ERROR: credentials.json not found!');
    console.error('See README.md for setup instructions.\n');
    process.exit(1);
  }

  // Check for enriched leads
  try {
    await fs.access(LEADS_PATH);
  } catch {
    console.error('ERROR: leads_enriched.json not found!');
    console.error('Run: python tools/matcher.py --trade pool --limit 20\n');
    process.exit(1);
  }

  // Authenticate
  console.log('Authenticating with Google...');
  const auth = await authorize();
  console.log('Authentication successful!\n');

  // Load enriched leads
  console.log('Loading enriched leads...');
  const leadsContent = await fs.readFile(LEADS_PATH, 'utf8');
  const contractors = JSON.parse(leadsContent);
  console.log(`Found ${contractors.length} contractors to process.\n`);

  if (contractors.length === 0) {
    console.log('No contractors in leads_enriched.json. Nothing to do.');
    return;
  }

  // Load sent history
  const sentHistory = await loadSentHistory();

  // Process contractors
  console.log('Creating drafts...');
  console.log('----------------------------------------');

  let successCount = 0;
  let errorCount = 0;
  let skippedCount = 0;

  for (let i = 0; i < contractors.length; i++) {
    const contractor = contractors[i];
    const email = contractor.contractor_email;

    // Check if already sent
    if (sentHistory[email]) {
      console.log(`[${i + 1}/${contractors.length}] SKIP: ${email} (already drafted)`);
      skippedCount++;
      continue;
    }

    try {
      console.log(`[${i + 1}/${contractors.length}] ${contractor.business_name}`);
      console.log(`  Email: ${email}`);
      console.log(`  City: ${contractor.city} (${contractor.cluster})`);
      console.log(`  Leads: ${contractor.stats.lead_count} matched, ${contractor.stats.overall_lead_count} total`);

      const { subject, draftId } = await createDraft(auth, contractor);

      console.log(`  Subject: "${subject}"`);
      console.log(`  Draft ID: ${draftId}`);
      console.log('  Status: DRAFT CREATED\n');

      // Update sent history
      sentHistory[email] = {
        drafted_at: new Date().toISOString(),
        trade: contractor.trade,
        leads_pitched: contractor.sample_leads.map(l => l.lead_id)
      };

      successCount++;
    } catch (err) {
      console.error(`  ERROR: ${err.message}\n`);
      errorCount++;
    }

    // Rate limiting - 60 second delay between drafts
    if (i < contractors.length - 1) {
      console.log('  Waiting 60 seconds before next draft...');
      await delay(60000);
    }
  }

  // Save sent history
  await saveSentHistory(sentHistory);

  // Summary
  console.log('----------------------------------------');
  console.log(`\nComplete!`);
  console.log(`  Drafts created: ${successCount}`);
  console.log(`  Skipped (already drafted): ${skippedCount}`);
  console.log(`  Errors: ${errorCount}`);
  console.log(`\nCheck your Gmail Drafts folder to review and send.\n`);
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
