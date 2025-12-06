const puppeteer = require('puppeteer');

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

async function extractWithDeepSeek(html, companyName) {
  const prompt = `Extract BBB information for "${companyName}" from this HTML.

Return ONLY valid JSON:
{
  "found": true or false,
  "company_name": "exact name from BBB",
  "bbb_rating": "A+, A, B, etc or null",
  "accredited": true or false,
  "location": "city, state",
  "category": "business type"
}

HTML content:
${html.substring(0, 35000)}`;

  const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: 'You extract BBB data. Return only valid JSON, no markdown.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.1,
      max_tokens: 400
    })
  });

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '{}';

  console.log('Raw DeepSeek response:', content);

  // Try to extract JSON
  let jsonStr = content.trim();
  if (jsonStr.includes('```')) {
    jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
  }

  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    const match = jsonStr.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    return { error: 'Failed to parse', raw: content };
  }
}

async function testBBB(companyName) {
  console.log('\n' + '='.repeat(60));
  console.log('Testing:', companyName);
  console.log('='.repeat(60));

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

  const searchUrl = 'https://www.bbb.org/search?find_text=' + encodeURIComponent(companyName) + '&find_country=USA&find_entity=Y';
  console.log('URL:', searchUrl);

  try {
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    const html = await page.content();
    console.log('HTML size:', Math.round(html.length/1024), 'KB');

    const result = await extractWithDeepSeek(html, companyName);
    console.log('\nExtracted data:');
    console.log(JSON.stringify(result, null, 2));

  } catch (err) {
    console.log('Error:', err.message);
  }

  await browser.close();
}

async function main() {
  if (!DEEPSEEK_API_KEY) {
    console.error('DEEPSEEK_API_KEY not set');
    process.exit(1);
  }

  await testBBB('SPF Screens and Awnings');
  await testBBB('Orange Elephant Roofing');
}

main().catch(console.error);
