---
description: Pull permits from MGO Connect (Irving, Lewisville, Denton, Cedar Hill)
---

# MGO Connect Permit Workflow

Interactive workflow to pull permits from My Government Online portal.

## Credentials
Login uses credentials from `.env`:
- `MGO_EMAIL=resultsandgoaloriented@gmail.com`
- `MGO_PASSWORD=SleepyPanda123!`

## Available Cities
| City | JID | URL |
|------|-----|-----|
| Irving | 320 | mgoconnect.org/cp?JID=320 |
| Lewisville | 325 | mgoconnect.org/cp?JID=325 |
| Denton | 285 | mgoconnect.org/cp?JID=285 |
| Cedar Hill | 305 | mgoconnect.org/cp?JID=305 |

## Steps

### 1. Open login page
Navigate to: `https://www.mgoconnect.org/cp/login`

### 2. Log in
- Enter email in the email field
- Enter password in the password field
- Click "Login" button
- Wait for redirect to home page

### 3. Select jurisdiction
- Open "Select a State" dropdown
- Type "Texas" and select it
- Wait for jurisdictions to load (2-3 seconds)
- Open jurisdiction dropdown
- Type city name (e.g., "Irving") and select it
- Click "Continue" button

### 4. Navigate to permit search
- Look for "Search Permits" or similar link
- OR navigate directly to search page

### 5. Set search filters (optional)
- Date range: last 30 days
- Permit type: filter as needed

### 6. Execute search
- Click "Search" button
- Wait for results to load

### 7. Extract results
For each page of results, extract:
- Permit ID
- Address
- Type
- Status
- Date
- Contractor (if shown)

### 8. Save to file
Save extracted permits to `{city}_permits.json`

## Notes
- Portal is Angular-based, uses PrimeNG components
- Dropdowns require typing to filter, then clicking option
- Results load via API, may take 3-5 seconds
- Be patient with page transitions
