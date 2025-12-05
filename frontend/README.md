# Contractor Scraper - Command Center UI

A modern React dashboard for managing contractor leads and trust scores.

## Features

- **Dashboard**: Overview metrics, tier distribution chart, quick actions
- **Lead Grid**: High-density data table with sorting, filtering, search
- **Forensic Reports**: Detailed contractor analysis with score breakdowns
- **Dark Mode**: Default slate dark theme optimized for data processing

## Tech Stack

- **Framework**: React 19 + Vite
- **Styling**: Tailwind CSS + shadcn/ui components
- **Data**: TanStack Query (React Query) + Axios
- **Charts**: Recharts
- **Tables**: TanStack Table
- **Icons**: Lucide React

## Quick Start

```bash
# Install dependencies
npm install

# Start development server (runs on port 3000)
npm run dev

# Build for production
npm run build
```

## Backend Requirements

The UI expects the Django backend running on http://localhost:8002.

```bash
# In the contractors directory
source venv/bin/activate
python manage.py runserver 8002
```

## API Endpoints Used

- GET /api/contractors/ - List contractors
- GET /api/contractors/{slug}/ - Contractor detail
- GET /api/contractors/stats/ - Dashboard stats
- GET /api/verticals/ - Available verticals

## Score Color Coding

- Green (80+): Gold tier, qualified leads
- Yellow (50-79): Silver/Bronze tier, needs review
- Red (<50): Unqualified, significant red flags
