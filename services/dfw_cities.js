/**
 * DFW Metro Area City Utilities
 *
 * Provides city lists, county mappings, and area code lookups
 * for the Dallas-Fort Worth metropolitan area.
 */

const DFW_CITIES = [
  // Dallas County
  'Dallas', 'Garland', 'Irving', 'Grand Prairie', 'Mesquite',
  'Carrollton', 'Richardson', 'Rowlett', 'DeSoto', 'Cedar Hill',
  'Lancaster', 'Duncanville', 'Balch Springs', 'Cockrell Hill',
  // Tarrant County
  'Fort Worth', 'Arlington', 'Mansfield', 'Grapevine', 'Keller',
  'Southlake', 'Colleyville', 'Bedford', 'Euless', 'Hurst',
  'North Richland Hills', 'Haltom City', 'Watauga', 'Richland Hills',
  // Collin County
  'Plano', 'Frisco', 'McKinney', 'Allen', 'Wylie', 'Murphy',
  'Prosper', 'Celina', 'Anna', 'Princeton', 'Lucas', 'Fairview',
  // Denton County
  'Denton', 'Lewisville', 'Flower Mound', 'The Colony', 'Little Elm',
  'Corinth', 'Highland Village', 'Argyle', 'Aubrey', 'Sanger',
  // Rockwall County
  'Rockwall', 'Royse City', 'Heath', 'Fate',
  // Kaufman County
  'Forney', 'Terrell', 'Kaufman',
  // Ellis County
  'Waxahachie', 'Midlothian', 'Red Oak', 'Ennis'
];

const COUNTY_SEATS = {
  'dallas': 'Dallas',
  'tarrant': 'Fort Worth',
  'collin': 'McKinney',
  'denton': 'Denton',
  'rockwall': 'Rockwall',
  'kaufman': 'Kaufman',
  'ellis': 'Waxahachie'
};

const DFW_AREA_CODES = {
  '214': 'Dallas',
  '469': 'Dallas',
  '972': 'Dallas',
  '817': 'Fort Worth',
  '682': 'Fort Worth',
  '940': 'Denton',
  '903': 'Dallas'  // Eastern suburbs
};

const DFW_MAJOR_CITIES = ['Dallas', 'Fort Worth', 'Plano', 'Arlington', 'Frisco'];

// City to county mapping
const CITY_TO_COUNTY = {
  // Dallas County
  'dallas': 'dallas', 'garland': 'dallas', 'irving': 'dallas',
  'grand prairie': 'dallas', 'mesquite': 'dallas', 'carrollton': 'dallas',
  'richardson': 'dallas', 'rowlett': 'dallas', 'desoto': 'dallas',
  'cedar hill': 'dallas', 'lancaster': 'dallas', 'duncanville': 'dallas',
  'balch springs': 'dallas', 'cockrell hill': 'dallas',
  // Tarrant County
  'fort worth': 'tarrant', 'arlington': 'tarrant', 'mansfield': 'tarrant',
  'grapevine': 'tarrant', 'keller': 'tarrant', 'southlake': 'tarrant',
  'colleyville': 'tarrant', 'bedford': 'tarrant', 'euless': 'tarrant',
  'hurst': 'tarrant', 'north richland hills': 'tarrant',
  'haltom city': 'tarrant', 'watauga': 'tarrant', 'richland hills': 'tarrant',
  // Collin County
  'plano': 'collin', 'frisco': 'collin', 'mckinney': 'collin',
  'allen': 'collin', 'wylie': 'collin', 'murphy': 'collin',
  'prosper': 'collin', 'celina': 'collin', 'anna': 'collin',
  'princeton': 'collin', 'lucas': 'collin', 'fairview': 'collin',
  // Denton County
  'denton': 'denton', 'lewisville': 'denton', 'flower mound': 'denton',
  'the colony': 'denton', 'little elm': 'denton', 'corinth': 'denton',
  'highland village': 'denton', 'argyle': 'denton', 'aubrey': 'denton',
  'sanger': 'denton',
  // Rockwall County
  'rockwall': 'rockwall', 'royse city': 'rockwall', 'heath': 'rockwall',
  'fate': 'rockwall',
  // Kaufman County
  'forney': 'kaufman', 'terrell': 'kaufman', 'kaufman': 'kaufman',
  // Ellis County
  'waxahachie': 'ellis', 'midlothian': 'ellis', 'red oak': 'ellis',
  'ennis': 'ellis'
};

/**
 * Check if a city is in the DFW metro area
 * @param {string} city - City name
 * @returns {boolean}
 */
function isDFWCity(city) {
  if (!city) return false;
  const normalized = city.toLowerCase().trim();
  return DFW_CITIES.some(c => c.toLowerCase() === normalized);
}

/**
 * Get the county for a DFW city
 * @param {string} city - City name
 * @returns {string|null} County name or null
 */
function getCountyForCity(city) {
  if (!city) return null;
  const normalized = city.toLowerCase().trim();
  return CITY_TO_COUNTY[normalized] || null;
}

/**
 * Get nearby cities for fallback search
 * @param {string} primaryCity - The contractor's primary city
 * @param {number} limit - Max cities to return
 * @returns {string[]} Array of nearby city names
 */
function getNearbyCities(primaryCity, limit = 3) {
  const county = getCountyForCity(primaryCity);
  if (!county) return DFW_MAJOR_CITIES.slice(0, limit);

  // Get other cities in same county
  const sameCounty = Object.entries(CITY_TO_COUNTY)
    .filter(([city, c]) => c === county && city !== primaryCity.toLowerCase())
    .map(([city]) => city.charAt(0).toUpperCase() + city.slice(1));

  // Add major cities from other counties
  const majorOther = DFW_MAJOR_CITIES.filter(c =>
    c.toLowerCase() !== primaryCity.toLowerCase() &&
    !sameCounty.map(s => s.toLowerCase()).includes(c.toLowerCase())
  );

  return [...sameCounty.slice(0, 2), ...majorOther.slice(0, 2)].slice(0, limit);
}

/**
 * Get city from area code
 * @param {string} areaCode - 3-digit area code
 * @returns {string|null} Primary city for that area code
 */
function getCityFromAreaCode(areaCode) {
  return DFW_AREA_CODES[areaCode] || null;
}

module.exports = {
  DFW_CITIES,
  COUNTY_SEATS,
  DFW_AREA_CODES,
  DFW_MAJOR_CITIES,
  CITY_TO_COUNTY,
  isDFWCity,
  getCountyForCity,
  getNearbyCities,
  getCityFromAreaCode
};
