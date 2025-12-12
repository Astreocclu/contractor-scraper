#!/usr/bin/env node
/**
 * External API Sources for Forensic Audit
 *
 * Handles API-based data sources that don't require Puppeteer.
 * Includes: CourtListener, OpenCorporates, etc.
 */

/**
 * Search CourtListener for federal court cases
 * Requires API key from https://www.courtlistener.com/api/
 */
async function searchCourtListener(businessName, apiKey) {
  if (!apiKey) {
    return { found: false, error: 'COURTLISTENER_API_KEY not set', cases: [] };
  }

  const result = {
    found: false,
    cases: [],
    total: 0,
    error: null
  };

  try {
    const url = `https://www.courtlistener.com/api/rest/v3/search/?q=${encodeURIComponent(businessName)}&type=o&order_by=score%20desc`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Token ${apiKey}`,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      result.error = `API error: ${response.status}`;
      return result;
    }

    const data = await response.json();

    if (data.count > 0 && data.results?.length > 0) {
      result.found = true;
      result.total = data.count;
      result.cases = data.results.slice(0, 10).map(c => ({
        case_name: c.caseName || c.case_name,
        court: c.court || c.court_id,
        date_filed: c.dateFiled || c.date_filed,
        docket_number: c.docketNumber || c.docket_number,
        snippet: c.snippet,
        url: c.absolute_url ? `https://www.courtlistener.com${c.absolute_url}` : null
      }));
    }

    return result;

  } catch (err) {
    result.error = err.message;
    return result;
  }
}

/**
 * Search OpenCorporates for company information
 * Free tier available, no API key required for basic searches
 */
async function searchOpenCorporates(businessName, state = 'TX') {
  const result = {
    found: false,
    companies: [],
    error: null
  };

  try {
    const jurisdiction = state.toLowerCase() === 'tx' ? 'us_tx' : `us_${state.toLowerCase()}`;
    const url = `https://api.opencorporates.com/v0.4/companies/search?q=${encodeURIComponent(businessName)}&jurisdiction_code=${jurisdiction}`;

    const response = await fetch(url);

    if (!response.ok) {
      result.error = `API error: ${response.status}`;
      return result;
    }

    const data = await response.json();

    if (data.results?.companies?.length > 0) {
      result.found = true;
      result.companies = data.results.companies.slice(0, 5).map(c => ({
        name: c.company.name,
        company_number: c.company.company_number,
        jurisdiction: c.company.jurisdiction_code,
        status: c.company.current_status,
        incorporation_date: c.company.incorporation_date,
        company_type: c.company.company_type,
        registered_address: c.company.registered_address_in_full,
        opencorporates_url: c.company.opencorporates_url
      }));
    }

    return result;

  } catch (err) {
    result.error = err.message;
    return result;
  }
}

/**
 * Check PPP loan data
 * Note: This uses a static dataset, not a live API
 * You would need to download and query locally
 */
async function checkPPPLoan(businessName, state = 'TX') {
  // PPP data is available at https://data.sba.gov/dataset/ppp-foia
  // This would require downloading the CSV and querying locally
  // For now, return a placeholder

  return {
    found: false,
    note: 'PPP loan lookup requires local dataset. Download from https://data.sba.gov/dataset/ppp-foia',
    error: null
  };
}

/**
 * Search FEMA contractor debarment list
 */
async function checkFEMADebarment(businessName) {
  const result = {
    found: false,
    debarred: false,
    entries: [],
    error: null
  };

  try {
    // SAM.gov exclusions API (requires registration)
    // For now, use a Google search approach
    const url = `https://www.google.com/search?q=site:sam.gov+"${encodeURIComponent(businessName)}"+exclusion+OR+debarment`;

    // This is a placeholder - actual implementation would use SAM.gov API
    result.note = 'Full debarment check requires SAM.gov API access';

    return result;

  } catch (err) {
    result.error = err.message;
    return result;
  }
}

/**
 * Check Texas Franchise Tax Status via API
 */
async function checkTXFranchiseTax(businessName) {
  const result = {
    found: false,
    status: null,
    taxpayer_number: null,
    error: null
  };

  try {
    const url = `https://comptroller.texas.gov/data-search/franchise-tax?name=${encodeURIComponent(businessName)}`;

    const response = await fetch(url);

    if (!response.ok) {
      result.error = `API error: ${response.status}`;
      return result;
    }

    const data = await response.json();

    if (data.success && data.data?.length > 0) {
      result.found = true;
      const match = data.data[0]; // Best match
      result.taxpayer_number = match.taxpayerId;
      result.legal_name = match.name;
      result.status = match.rightToTransactTX;
    }

    return result;

  } catch (err) {
    result.error = err.message;
    return result;
  }
}

/**
 * Fetch all API-based sources for a contractor
 */
async function fetchAPISources(businessName, state = 'TX', options = {}) {
  const results = {
    court_listener: null,
    open_corporates: null,
    tx_franchise: null,
    errors: []
  };

  // Run API calls in parallel
  const promises = [];

  // CourtListener (if API key available)
  if (options.courtListenerApiKey) {
    promises.push(
      searchCourtListener(businessName, options.courtListenerApiKey)
        .then(r => { results.court_listener = r; })
        .catch(e => { results.errors.push({ source: 'court_listener', error: e.message }); })
    );
  }

  // OpenCorporates (no key required)
  promises.push(
    searchOpenCorporates(businessName, state)
      .then(r => { results.open_corporates = r; })
      .catch(e => { results.errors.push({ source: 'open_corporates', error: e.message }); })
  );

  // TX Franchise Tax (if Texas)
  if (state.toUpperCase() === 'TX') {
    promises.push(
      checkTXFranchiseTax(businessName)
        .then(r => { results.tx_franchise = r; })
        .catch(e => { results.errors.push({ source: 'tx_franchise', error: e.message }); })
    );
  }

  await Promise.all(promises);

  return results;
}

module.exports = {
  searchCourtListener,
  searchOpenCorporates,
  checkPPPLoan,
  checkFEMADebarment,
  checkTXFranchiseTax,
  fetchAPISources
};
