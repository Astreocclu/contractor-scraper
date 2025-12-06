const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();

  console.log('Loading search page...');
  await page.goto('https://energov.cityofsouthlake.com/EnerGov_Prod/SelfService#/search?m=2&ps=10&pn=1&em=true',
    { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 5000));

  // Click search first
  console.log('Clicking search...');
  const searchBtn = await page.$('#button-Search');
  if (searchBtn) await searchBtn.click();
  await new Promise(r => setTimeout(r, 5000));

  // Find sort dropdown and its options
  console.log('Finding sort options...');
  const sortInfo = await page.evaluate(() => {
    const select = document.querySelector('#PermitCriteria_SortBy');
    if (!select) return { error: 'Sort dropdown not found' };

    const options = [...select.options].map(o => ({ value: o.value, text: o.text }));
    const current = select.value;
    return { current, options };
  });

  console.log('Current sort:', sortInfo.current);
  console.log('Available options:', JSON.stringify(sortInfo.options, null, 2));

  // Change to FinalDate (Finalized Date) and Descending
  console.log('\nChanging sort to Finalized Date + Descending...');
  await page.select('#PermitCriteria_SortBy', 'string:FinalDate');
  await new Promise(r => setTimeout(r, 1000));

  // Set Descending order
  await page.select('#SortAscending', 'boolean:false');
  await new Promise(r => setTimeout(r, 4000));

  // Check first permit after sort change
  const afterSort = await page.evaluate(() => {
    const permits = [...document.querySelectorAll('[id^="entityRecordDiv"]')].slice(0,3);
    return permits.map(el => {
      const text = el.innerText;
      const lines = text.split('\n').filter(l => l.trim());
      return lines.slice(0,5).join(' | ');
    });
  });

  console.log('After sort change:');
  afterSort.forEach((p, i) => console.log(' ', i+1, p));

  await browser.close();
})();
