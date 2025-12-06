/**
 * Cold Email Draft Factory
 *
 * Creates Gmail drafts for Texas construction leads.
 * Uses OAuth2 for authentication and users.drafts.create endpoint.
 *
 * CRITICAL: This script ONLY creates drafts. It does NOT send emails.
 */

const fs = require('fs').promises;
const path = require('path');
const { google } = require('googleapis');
const readline = require('readline');

// OAuth2 scopes - only requesting draft creation permission
const SCOPES = ['https://www.googleapis.com/auth/gmail.compose'];
const TOKEN_PATH = path.join(__dirname, 'token.json');
const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');
const LEADS_PATH = path.join(__dirname, 'leads.json');

// Sender info
const SENDER_NAME = 'Mike';
const SENDER_EMAIL = 'me'; // Gmail API uses 'me' to reference authenticated user

// DeepSeek API configuration
const DEEPSEEK_API_BASE = 'https://api.deepseek.com/v1';

// Personalities to randomly select from
const PERSONALITIES = [
  { name: 'Mike', style: 'blunt Texas guy, gets straight to the point, no BS' },
  { name: 'Sarah', style: 'friendly but busy, talks like texting a friend' },
  { name: 'Jake', style: 'laid-back surfer vibe, casual and chill' },
  { name: 'Marcus', style: 'former contractor himself, knows the hustle, speaks their language' },
  { name: 'Danny', style: 'fast-talking New Yorker energy, impatient but helpful' }
];

/**
 * Generates email subject and body using DeepSeek.
 * Randomly selects personality for variety.
 */
async function generateEmailBody(lead) {
  const { permit_type, address, city, count, contractor_email } = lead;
  const businessName = address;

  // Pick a random personality
  const persona = PERSONALITIES[Math.floor(Math.random() * PERSONALITIES.length)];

  const prompt = `You are ${persona.name}. Your personality: ${persona.style}

You work for a lead generation company. You have EXTRA leads you're trying to offload at a discount. These are verified, enriched, scored homeowner leads with permit data. Your sales team doesn't need them all - so you're reaching out to contractors directly to move the surplus.

Write a quick cold email to ${businessName} in ${city}. They're a contractor.

The vibe:
- You're not a slick salesman, you're just trying to move some leads you don't need
- Keep it SHORT (2-4 sentences)
- Be natural, let your personality come through
- Mention you'll give them a deal since these are extras
- End with something that invites a response

Don't be formal. Don't use corporate speak. Just talk like a human.

Return JSON only:
{"subject": "short subject line", "body": "the email"}`;

  try {
    const response = await fetch(`${DEEPSEEK_API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',  // Using chat model for reliable JSON output
        messages: [
          { role: 'user', content: prompt }
        ],
        temperature: 0.9,  // Higher temp for more variation
        max_tokens: 500
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`DeepSeek API error ${response.status}: ${errorText}`);
    }

    const responseText = await response.text();
    const data = JSON.parse(responseText);
    const content = data.choices?.[0]?.message?.content || '';

    if (!content) {
      throw new Error('Empty response from DeepSeek');
    }

    // Extract JSON from response (handle markdown code blocks)
    let jsonStr = content;
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    // Try to find JSON object in the response
    const objectMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      jsonStr = objectMatch[0];
    }

    const result = JSON.parse(jsonStr);

    // Log reasoning if present
    if (data.choices?.[0]?.message?.reasoning_content) {
      console.log(`  [DeepSeek reasoning]: ${data.choices[0].message.reasoning_content.substring(0, 100)}...`);
    }

    return {
      subject: result.subject,
      body: result.body
    };
  } catch (err) {
    console.error(`  [DeepSeek fallback]: ${err.message}`);
    // Fallback to simple template
    return {
      subject: `Leads in ${city}`,
      body: `Found some fresh permits in ${city} this week. I'm selling the list to one contractor. Want it?`
    };
  }
}

/**
 * Creates an RFC 822 formatted email message.
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

  // Base64url encode the message
  return Buffer.from(message)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Creates a draft in Gmail.
 * Uses users.drafts.create - does NOT send.
 */
async function createDraft(auth, lead) {
  const gmail = google.gmail({ version: 'v1', auth });

  const { subject, body } = await generateEmailBody(lead);
  const rawMessage = createRFC822Message(lead.contractor_email, subject, body);

  const response = await gmail.users.drafts.create({
    userId: 'me',
    requestBody: {
      message: {
        raw: rawMessage
      }
    }
  });

  return { subject, draftId: response.data.id };
}

/**
 * Delays execution for specified milliseconds.
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Loads saved credentials if they exist.
 */
async function loadSavedCredentials() {
  try {
    const content = await fs.readFile(TOKEN_PATH);
    const credentials = JSON.parse(content);
    return google.auth.fromJSON(credentials);
  } catch (err) {
    return null;
  }
}

/**
 * Saves credentials to file for future use.
 */
async function saveCredentials(client) {
  const content = await fs.readFile(CREDENTIALS_PATH);
  const keys = JSON.parse(content);
  const key = keys.installed || keys.web;

  const payload = JSON.stringify({
    type: 'authorized_user',
    client_id: key.client_id,
    client_secret: key.client_secret,
    refresh_token: client.credentials.refresh_token,
  });

  await fs.writeFile(TOKEN_PATH, payload);
}

/**
 * Prompts user for authorization code.
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
 * Authorizes with Google using OAuth2.
 */
async function authorize() {
  // Try to load existing credentials
  let client = await loadSavedCredentials();
  if (client) {
    console.log('Using saved credentials...');
    return client;
  }

  // Load client secrets
  const content = await fs.readFile(CREDENTIALS_PATH);
  const keys = JSON.parse(content);
  const key = keys.installed || keys.web;

  const oAuth2Client = new google.auth.OAuth2(
    key.client_id,
    key.client_secret,
    key.redirect_uris?.[0] || 'urn:ietf:wg:oauth:2.0:oob'
  );

  // Generate auth URL
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

  // Save credentials for next run
  await saveCredentials(oAuth2Client);
  console.log('Credentials saved to token.json\n');

  return oAuth2Client;
}

/**
 * Main execution function.
 */
async function main() {
  console.log('\n========================================');
  console.log('  COLD EMAIL DRAFT FACTORY');
  console.log('  Texas Construction Leads');
  console.log('========================================\n');

  // Check for credentials file
  try {
    await fs.access(CREDENTIALS_PATH);
  } catch {
    console.error('ERROR: credentials.json not found!');
    console.error('Please download it from Google Cloud Console.');
    console.error('See README.md for instructions.\n');
    process.exit(1);
  }

  // Authenticate
  console.log('Authenticating with Google...');
  const auth = await authorize();
  console.log('Authentication successful!\n');

  // Load leads
  console.log('Loading leads from leads.json...');
  const leadsContent = await fs.readFile(LEADS_PATH, 'utf8');
  const leads = JSON.parse(leadsContent);
  console.log(`Found ${leads.length} leads to process.\n`);

  // Process each lead
  console.log('Creating drafts...');
  console.log('----------------------------------------');

  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i];

    try {
      const { subject, draftId } = await createDraft(auth, lead);
      console.log(`Draft created for ${lead.contractor_email} - "${subject}"`);
      successCount++;
    } catch (err) {
      console.error(`ERROR creating draft for ${lead.contractor_email}: ${err.message}`);
      errorCount++;
    }

    // Rate limiting - 1 second delay between requests
    if (i < leads.length - 1) {
      await delay(1000);
    }
  }

  // Summary
  console.log('----------------------------------------');
  console.log(`\nComplete! ${successCount} drafts created, ${errorCount} errors.`);
  console.log('Check your Gmail Drafts folder to review and send.\n');
}

// Run the script
main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
