# Municipalities Requiring Credentials

## Last Updated: Dec 7, 2025

This document lists all permit portals that require login credentials to scrape.

---

## Currently Configured (Have Credentials)

| City | Portal | Env Vars | Status |
|------|--------|----------|--------|
| Irving | MGO Connect | `MGO_EMAIL`, `MGO_PASSWORD` | Working |
| Lewisville | MGO Connect | `MGO_EMAIL`, `MGO_PASSWORD` | Working |
| Denton | MGO Connect | `MGO_EMAIL`, `MGO_PASSWORD` | Working |
| Cedar Hill | MGO Connect | `MGO_EMAIL`, `MGO_PASSWORD` | Working |
| Duncanville | MGO Connect | `MGO_EMAIL`, `MGO_PASSWORD` | Working |

---

## Need Credentials (High Priority)

### 1. Plano - eTRAKiT
- **URL**: https://trakit.plano.gov/etrakit_prod/
- **Portal**: eTRAKiT (CentralSquare)
- **Type**: Contractor login required
- **Priority**: HIGH - $100k+ median income market
- **Env Vars Needed**: `PLANO_ETRAKIT_USER`, `PLANO_ETRAKIT_PASS`
- **How to Get**: Register as contractor at https://trakit.plano.gov/etrakit_prod/

### 2. Rowlett - MyGov
- **URL**: https://web.mygov.us
- **Portal**: MyGov V5
- **Type**: "Collaborator" login required
- **Priority**: MEDIUM
- **Env Vars Needed**: `MYGOV_EMAIL`, `MYGOV_PASSWORD`
- **How to Get**: Register at web.mygov.us, select "Collaborator" option

### 3. Grapevine - MyGov
- **URL**: https://public.mygov.us/grapevine_tx/
- **Portal**: MyGov
- **Type**: Login required for permit search
- **Priority**: MEDIUM
- **Env Vars Needed**: `MYGOV_EMAIL`, `MYGOV_PASSWORD` (same as Rowlett if shared)
- **How to Get**: Register at public.mygov.us

### 4. Lancaster - MyGov
- **URL**: https://public.mygov.us/lancaster_tx/
- **Portal**: MyGov
- **Type**: Login required for permit search
- **Priority**: MEDIUM
- **Env Vars Needed**: `MYGOV_EMAIL`, `MYGOV_PASSWORD`
- **How to Get**: Register at public.mygov.us

---

## No Public Search Available

These cities have permit systems but NO public search capability:

| City | System | Notes |
|------|--------|-------|
| Garland | Paper/Email only | Call 972-205-2300 for records |
| Balch Springs | Paper/Email only | Contact city directly |
| Sachse | SmartGov (new July 2025) | May not have public search yet |

---

## Public Access (No Credentials Needed)

For reference, these work WITHOUT login:

| Scraper | Cities | Notes |
|---------|--------|-------|
| `energov.py` | Southlake, Grand Prairie, McKinney, Allen, Colleyville, DeSoto, Farmers Branch, Princeton | Public search |
| `accela.py` | Fort Worth, Dallas, Grand Prairie | Public search |
| `etrakit.py` | Frisco, Keller | Public search |
| `dfw_big4_socrata.py` | Arlington | API-based, no auth |

---

## Registration Instructions

### MGO Connect (Irving, Lewisville, etc.)
1. Go to https://www.mgoconnect.org/cp/login
2. Click "Create Account"
3. Select your jurisdiction (Texas -> City)
4. Complete registration as "Public User" or "Contractor"
5. Store credentials in `.env`:
   ```
   MGO_EMAIL=your_email@example.com
   MGO_PASSWORD=your_password
   ```

### MyGov (Rowlett, Grapevine, Lancaster)
1. Go to https://web.mygov.us (or public.mygov.us)
2. Click "Collaborator" login option
3. Register for an account
4. Store credentials in `.env`:
   ```
   MYGOV_EMAIL=your_email@example.com
   MYGOV_PASSWORD=your_password
   ```

### Plano eTRAKiT
1. Go to https://trakit.plano.gov/etrakit_prod/
2. Look for "Register" or "Create Account"
3. May require contractor license verification
4. Store credentials in `.env`:
   ```
   PLANO_ETRAKIT_USER=your_username
   PLANO_ETRAKIT_PASS=your_password
   ```

---

## Notes

- MGO Connect uses the SAME credentials for all MGO cities (Irving, Lewisville, Denton, Cedar Hill, Duncanville)
- MyGov MAY share credentials across cities (needs verification)
- Always test credentials manually before running scrapers
- Some systems may require re-authentication after 30-90 days
