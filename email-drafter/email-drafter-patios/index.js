/**
 * Cold Email Draft Factory - PATIOS
 *
 * Creates Gmail drafts for patio/outdoor living contractors in Fort Worth area.
 * Uses OAuth2 for authentication and users.drafts.create endpoint.
 *
 * CRITICAL: This script ONLY creates drafts. It does NOT send emails.
 */

const fs = require('fs').promises;
const path = require('path');
const { google } = require('googleapis');
const readline = require('readline');

const SCOPES = ['https://www.googleapis.com/auth/gmail.compose'];
const TOKEN_PATH = path.join(__dirname, 'token.json');
const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');
const LEADS_PATH = path.join(__dirname, 'leads.json');

const SENDER_NAME = 'Mike';
const SENDER_EMAIL = 'me';

const DEEPSEEK_API_BASE = 'https://api.deepseek.com/v1';

const PERSONALITIES = [
  { name: 'Mike', style: 'blunt Texas guy, gets straight to the point, no BS' },
  { name: 'Sarah', style: 'friendly but busy, talks like texting a friend' },
  { name: 'Jake', style: 'laid-back surfer vibe, casual and chill' },
  { name: 'Marcus', style: 'former contractor himself, knows the hustle, speaks their language' },
  { name: 'Danny', style: 'fast-talking New Yorker energy, impatient but helpful' }
];

async function generateEmailBody(lead) {
  const { permit_type, address, city, count, contractor_email } = lead;
  const businessName = lead.business_name || address;

  const persona = PERSONALITIES[Math.floor(Math.random() * PERSONALITIES.length)];

  const prompt = `You are ${persona.name}. Your personality: ${persona.style}

You have 111 verified OUTDOOR STRUCTURE permit leads in Fort Worth area from the last 60 days. These are homeowners who just pulled permits for patios, pergolas, outdoor kitchens, covered porches - they need contractors NOW.

The data:
- 20 are HOT (permits filed in last 30 days)
- 37 are WARM (30-60 days old)
- Mostly Fort Worth, Grapevine, Keller area
- Each lead includes: address, owner name, property value, permit date

Pricing: $40/hot lead, $20/warm lead, or $2,500 for all 111

Write a quick cold email to ${businessName} in ${city}. They build patios and outdoor structures.

The vibe:
- You're not a slick salesman, you're just trying to move some leads
- Keep it SHORT (2-4 sentences)
- Be natural, let your personality come through
- Offer 2-3 FREE SAMPLES to prove quality
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

    const responseText = await response.text();
    const data = JSON.parse(responseText);
    const content = data.choices?.[0]?.message?.content || '';

    if (!content) throw new Error('Empty response from DeepSeek');

    let jsonStr = content;
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) jsonStr = jsonMatch[1].trim();

    const objectMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (objectMatch) jsonStr = objectMatch[0];

    const result = JSON.parse(jsonStr);
    return { subject: result.subject, body: result.body };
  } catch (err) {
    console.error(`  [DeepSeek fallback]: ${err.message}`);
    return {
      subject: `Fort Worth patio permits - samples?`,
      body: `Got 111 fresh outdoor structure permits in Fort Worth area. Homeowners building patios, pergolas, outdoor kitchens - they need contractors now. Want 2-3 free samples?`
    };
  }
}

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

async function createDraft(auth, lead) {
  const gmail = google.gmail({ version: 'v1', auth });
  const { subject, body } = await generateEmailBody(lead);
  const rawMessage = createRFC822Message(lead.contractor_email, subject, body);

  const response = await gmail.users.drafts.create({
    userId: 'me',
    requestBody: { message: { raw: rawMessage } }
  });

  return { subject, draftId: response.data.id };
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function loadSavedCredentials() {
  try {
    const content = await fs.readFile(TOKEN_PATH);
    const credentials = JSON.parse(content);
    return google.auth.fromJSON(credentials);
  } catch (err) {
    return null;
  }
}

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

function askQuestion(query) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(query, ans => { rl.close(); resolve(ans); }));
}

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

  const authUrl = oAuth2Client.generateAuthUrl({ access_type: 'offline', scope: SCOPES });

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

async function main() {
  console.log('\n========================================');
  console.log('  PATIO CONTRACTOR EMAIL DRAFTS');
  console.log('  Fort Worth Area - 111 Leads');
  console.log('========================================\n');

  try {
    await fs.access(CREDENTIALS_PATH);
  } catch {
    console.error('ERROR: credentials.json not found!');
    process.exit(1);
  }

  console.log('Authenticating with Google...');
  const auth = await authorize();
  console.log('Authentication successful!\n');

  console.log('Loading leads from leads.json...');
  const leadsContent = await fs.readFile(LEADS_PATH, 'utf8');
  const leads = JSON.parse(leadsContent);
  console.log(`Found ${leads.length} contractors to process.\n`);

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
    if (i < leads.length - 1) await delay(1000);
  }

  console.log('----------------------------------------');
  console.log(`\nComplete! ${successCount} drafts created, ${errorCount} errors.`);
  console.log('Check your Gmail Drafts folder to review and send.\n');
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
