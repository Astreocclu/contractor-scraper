/**
 * Location Resolver
 *
 * Resolves contractor location to a searchable address.
 * Handles: missing addresses, PO boxes, unincorporated areas.
 *
 * Priority order:
 * 1. Direct city (if in DFW)
 * 2. ZIP code mapping
 * 3. License registration county
 * 4. Phone area code
 * 5. Default to Dallas with fallbacks
 */

const {
  DFW_CITIES,
  COUNTY_SEATS,
  DFW_AREA_CODES,
  DFW_MAJOR_CITIES,
  isDFWCity,
  getNearbyCities
} = require('./dfw_cities');

// ZIP code to city mapping for DFW area
const ZIP_TO_CITY = {
  // Addison/North Dallas area
  '75001': 'Addison', '75244': 'Dallas',
  // Allen/Plano
  '75002': 'Allen', '75013': 'Allen',
  // Carrollton
  '75006': 'Carrollton', '75007': 'Carrollton', '75010': 'Carrollton',
  // Coppell
  '75019': 'Coppell',
  // Plano
  '75023': 'Plano', '75024': 'Plano', '75025': 'Plano',
  '75074': 'Plano', '75075': 'Plano', '75093': 'Plano', '75094': 'Plano',
  // Frisco
  '75033': 'Frisco', '75034': 'Frisco', '75035': 'Frisco',
  // Irving
  '75038': 'Irving', '75039': 'Irving', '75060': 'Irving',
  '75061': 'Irving', '75062': 'Irving', '75063': 'Irving',
  // Garland
  '75040': 'Garland', '75041': 'Garland', '75042': 'Garland',
  '75043': 'Garland', '75044': 'Garland', '75045': 'Garland',
  // Sachse
  '75048': 'Sachse',
  // Grand Prairie
  '75050': 'Grand Prairie', '75051': 'Grand Prairie', '75052': 'Grand Prairie', '75054': 'Grand Prairie',
  // The Colony
  '75056': 'The Colony',
  // Lewisville
  '75057': 'Lewisville', '75067': 'Lewisville', '75077': 'Lewisville',
  // Little Elm
  '75068': 'Little Elm',
  // McKinney
  '75069': 'McKinney', '75070': 'McKinney', '75071': 'McKinney', '75072': 'McKinney',
  // Richardson
  '75080': 'Richardson', '75081': 'Richardson', '75082': 'Richardson', '75083': 'Richardson',
  // Rockwall
  '75087': 'Rockwall',
  // Rowlett
  '75088': 'Rowlett', '75089': 'Rowlett',
  // Wylie
  '75098': 'Wylie',
  // Dallas proper (75201-75254)
  '75201': 'Dallas', '75202': 'Dallas', '75203': 'Dallas', '75204': 'Dallas',
  '75205': 'Dallas', '75206': 'Dallas', '75207': 'Dallas', '75208': 'Dallas',
  '75209': 'Dallas', '75210': 'Dallas', '75211': 'Dallas', '75212': 'Dallas',
  '75214': 'Dallas', '75215': 'Dallas', '75216': 'Dallas', '75217': 'Dallas',
  '75218': 'Dallas', '75219': 'Dallas', '75220': 'Dallas', '75223': 'Dallas',
  '75224': 'Dallas', '75225': 'Dallas', '75226': 'Dallas', '75227': 'Dallas',
  '75228': 'Dallas', '75229': 'Dallas', '75230': 'Dallas', '75231': 'Dallas',
  '75232': 'Dallas', '75233': 'Dallas', '75234': 'Dallas', '75235': 'Dallas',
  '75236': 'Dallas', '75237': 'Dallas', '75238': 'Dallas', '75240': 'Dallas',
  '75243': 'Dallas', '75246': 'Dallas', '75247': 'Dallas', '75248': 'Dallas',
  '75249': 'Dallas', '75251': 'Dallas', '75252': 'Dallas', '75253': 'Dallas',
  '75254': 'Dallas',
  // Mesquite
  '75149': 'Mesquite', '75150': 'Mesquite', '75181': 'Mesquite', '75182': 'Mesquite',
  // DeSoto
  '75115': 'DeSoto',
  // Cedar Hill
  '75104': 'Cedar Hill',
  // Lancaster
  '75134': 'Lancaster', '75146': 'Lancaster',
  // Duncanville
  '75116': 'Duncanville', '75137': 'Duncanville',
  // Arlington (76001-76019)
  '76001': 'Arlington', '76002': 'Arlington', '76006': 'Arlington',
  '76010': 'Arlington', '76011': 'Arlington', '76012': 'Arlington',
  '76013': 'Arlington', '76014': 'Arlington', '76015': 'Arlington',
  '76016': 'Arlington', '76017': 'Arlington', '76018': 'Arlington',
  '76019': 'Arlington',
  // Bedford
  '76021': 'Bedford', '76022': 'Bedford',
  // Colleyville
  '76034': 'Colleyville',
  // Euless
  '76039': 'Euless', '76040': 'Euless',
  // Grapevine
  '76051': 'Grapevine',
  // Haslet
  '76052': 'Haslet',
  // Hurst
  '76053': 'Hurst', '76054': 'Hurst',
  // Southlake
  '76092': 'Southlake',
  // Fort Worth (76101-76199)
  '76102': 'Fort Worth', '76103': 'Fort Worth', '76104': 'Fort Worth',
  '76105': 'Fort Worth', '76106': 'Fort Worth', '76107': 'Fort Worth',
  '76108': 'Fort Worth', '76109': 'Fort Worth', '76110': 'Fort Worth',
  '76111': 'Fort Worth', '76112': 'Fort Worth', '76114': 'Fort Worth',
  '76115': 'Fort Worth', '76116': 'Fort Worth', '76117': 'Fort Worth',
  '76118': 'Fort Worth', '76119': 'Fort Worth', '76120': 'Fort Worth',
  '76123': 'Fort Worth', '76126': 'Fort Worth', '76131': 'Fort Worth',
  '76132': 'Fort Worth', '76133': 'Fort Worth', '76134': 'Fort Worth',
  '76135': 'Fort Worth', '76137': 'Fort Worth', '76140': 'Fort Worth',
  '76148': 'Fort Worth', '76155': 'Fort Worth', '76177': 'Fort Worth',
  '76179': 'Fort Worth',
  // Haltom City
  '76117': 'Haltom City',
  // North Richland Hills
  '76180': 'North Richland Hills', '76182': 'North Richland Hills',
  // Keller
  '76244': 'Keller', '76248': 'Keller',
  // Roanoke
  '76262': 'Roanoke',
  // Denton
  '76201': 'Denton', '76205': 'Denton', '76207': 'Denton', '76208': 'Denton', '76209': 'Denton', '76210': 'Denton',
  // Flower Mound
  '75022': 'Flower Mound', '75028': 'Flower Mound',
  // Mansfield
  '76063': 'Mansfield',
  // Midlothian
  '76065': 'Midlothian',
  // Waxahachie
  '75165': 'Waxahachie', '75167': 'Waxahachie',
  // Forney
  '75126': 'Forney'
};

class LocationResolver {
  /**
   * Resolve contractor to a searchable location
   * @param {Object} contractor - DB contractor record
   * @returns {Object} { city, state, source, fallbackRequired, fallbackLocations }
   */
  resolve(contractor) {
    // Priority 1: Direct city if in DFW
    if (contractor.city && isDFWCity(contractor.city)) {
      return {
        city: contractor.city,
        state: contractor.state || 'TX',
        source: 'direct',
        fallbackRequired: false,
        fallbackLocations: getNearbyCities(contractor.city)
      };
    }

    // Priority 2: ZIP code mapping
    if (contractor.zip) {
      const normalizedZip = String(contractor.zip).trim().substring(0, 5);
      const city = ZIP_TO_CITY[normalizedZip];
      if (city) {
        return {
          city,
          state: 'TX',
          source: 'zip_lookup',
          fallbackRequired: false,
          fallbackLocations: getNearbyCities(city)
        };
      }
    }

    // Priority 3: License registration county
    if (contractor.license_county) {
      const county = contractor.license_county.toLowerCase().trim();
      const city = COUNTY_SEATS[county];
      if (city) {
        return {
          city,
          state: 'TX',
          source: 'license_county',
          fallbackRequired: true,
          fallbackLocations: getNearbyCities(city)
        };
      }
    }

    // Priority 4: Phone area code
    if (contractor.phone) {
      const areaCode = contractor.phone.replace(/\D/g, '').substring(0, 3);
      const city = DFW_AREA_CODES[areaCode];
      if (city) {
        return {
          city,
          state: 'TX',
          source: 'phone_area',
          fallbackRequired: true,
          fallbackLocations: getNearbyCities(city)
        };
      }
    }

    // Priority 5: Default to Dallas with all fallbacks
    return {
      city: 'Dallas',
      state: 'TX',
      source: 'default',
      fallbackRequired: true,
      fallbackLocations: ['Fort Worth', 'Plano', 'Arlington', 'Frisco']
    };
  }

  /**
   * Get search location string
   * @param {Object} contractor - DB contractor record
   * @returns {string} e.g., "Plano, TX"
   */
  getSearchLocation(contractor) {
    const resolved = this.resolve(contractor);
    return `${resolved.city}, ${resolved.state}`;
  }
}

module.exports = { LocationResolver, ZIP_TO_CITY };
