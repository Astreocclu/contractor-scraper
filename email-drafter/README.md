# Cold Email Draft Factory

Creates Gmail drafts for Texas construction leads. **Does NOT send emails** - only populates your Drafts folder for manual review.

## Quick Start

```bash
cd email-drafter
npm install
node index.js
```

## Setup: Get Your credentials.json

### Step 1: Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click the project dropdown (top left) → **New Project**
3. Name it something like "Email Drafter"
4. Click **Create**

### Step 2: Enable the Gmail API

1. In your new project, go to **APIs & Services** → **Library**
2. Search for "Gmail API"
3. Click **Gmail API** → **Enable**

### Step 3: Configure OAuth Consent Screen

1. Go to **APIs & Services** → **OAuth consent screen**
2. Select **External** → **Create**
3. Fill in required fields:
   - App name: "Email Drafter"
   - User support email: Your email
   - Developer contact: Your email
4. Click **Save and Continue**
5. On Scopes page, click **Add or Remove Scopes**
   - Find and check: `https://www.googleapis.com/auth/gmail.compose`
   - Click **Update** → **Save and Continue**
6. On Test Users page, click **Add Users**
   - Add your Gmail address
   - Click **Save and Continue**
7. Click **Back to Dashboard**

### Step 4: Create OAuth Credentials

1. Go to **APIs & Services** → **Credentials**
2. Click **Create Credentials** → **OAuth client ID**
3. Application type: **Desktop app**
4. Name: "Email Drafter CLI"
5. Click **Create**
6. Click **Download JSON**
7. Rename the downloaded file to `credentials.json`
8. Move it to this `email-drafter` folder

## File Structure

```
email-drafter/
├── index.js          # Main script
├── package.json      # Dependencies
├── leads.json        # Your leads (edit this)
├── credentials.json  # OAuth credentials (you create this)
├── token.json        # Auto-generated after first auth
└── README.md         # This file
```

## leads.json Format

```json
[
  {
    "contractor_email": "contractor@example.com",
    "permit_type": "New In-Ground Pool",
    "address": "123 Main St",
    "city": "Dallas",
    "count": 15
  }
]
```

### Permit Type Logic

| Permit Contains | Subject | Email Template |
|-----------------|---------|----------------|
| "Pool" or "Spa" | `{Address} - Pool Permit` | Pool fence/landscaping leads pitch |
| "Roof" or "Hail" | `{City} Roofing Leads` | Roof replacement permits pitch |
| "Commercial" or "Finish-Out" | `Finish-Out at {Address}` | Commercial GC leads pitch |
| Anything else | `Permits in {City}` | Generic construction permits pitch |

## Running the Script

### First Run (Authorization Required)

```bash
node index.js
```

1. The script will print an authorization URL
2. Open it in your browser
3. Sign in with your Google account
4. Grant permission to create drafts
5. Copy the authorization code
6. Paste it back in the terminal

Your credentials are saved to `token.json` for future runs.

### Subsequent Runs

```bash
node index.js
```

No authorization needed - uses saved token.

## Rate Limiting

The script adds a 1-second delay between each draft creation to respect Gmail API rate limits.

## Troubleshooting

### "credentials.json not found"

Download OAuth credentials from Google Cloud Console (Step 4 above).

### "Error: invalid_grant"

Your token expired. Delete `token.json` and run again to re-authorize.

### "Error: access_denied"

Make sure your email is added as a Test User in the OAuth consent screen.

### "Error: insufficient_permission"

The OAuth consent screen needs the `gmail.compose` scope added.

## Security Notes

- `credentials.json` contains your OAuth client secrets - don't commit to git
- `token.json` contains your access token - don't commit to git
- Add both to `.gitignore`:

```
credentials.json
token.json
```
