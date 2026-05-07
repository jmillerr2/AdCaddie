# AdCaddie

Ad upload portal and JSON sequence generator for LPGA video boards.

## Project Structure

```
adcaddie/
├── lib/
│   ├── supabase.js       # Supabase client
│   └── generator.js      # JSON generation logic
├── pages/
│   ├── index.js          # Redirects to /admin
│   ├── _app.js           # Global app wrapper
│   ├── admin/
│   │   ├── index.js      # Admin dashboard
│   │   └── admin.module.css
│   ├── upload/
│   │   ├── [token].js    # Tournament upload portal
│   │   └── upload.module.css
│   └── api/
│       ├── auth.js       # Admin password check
│       ├── upload/
│       │   └── [token].js  # File upload handler
│       └── delete/
│           └── [id].js     # File delete handler
├── styles/
│   └── globals.css
├── next.config.js
└── package.json
```

## Environment Variables

Set these in Vercel → Project Settings → Environment Variables:

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Your Supabase anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Your Supabase service role key (for server-side uploads) |
| `ADMIN_PASSWORD` | Password to access the admin panel |

## Ad Size Requirements

| Sequence | Dimensions | Accepted |
|---|---|---|
| MainContent | 960 × 540 | Images + Videos |
| RightRail | 320 × 540 | Images + Videos |
| Header | 1280 × 120 | Images only |
| Ticker | 1280 × 60 | Images only |

## How It Works

1. Admin creates a tournament → unique upload link is generated
2. Tournament visits their link, drops ad files
3. Server detects image dimensions → assigns correct sequence type
4. Files are renamed automatically (01, R-01, H-01, T-01…)
5. Admin exports `elements.json` + `sequences.json` per tournament

## Local Development

```bash
npm install
# Create .env.local with your environment variables
npm run dev
```
