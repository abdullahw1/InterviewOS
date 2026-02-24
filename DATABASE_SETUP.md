# Database Setup Guide

## Getting Railway Database Connection Details

1. Go to your Railway project dashboard
2. Click on your PostgreSQL service
3. Go to the "Connect" tab
4. Look for these variables:
   - `RAILWAY_TCP_PROXY_DOMAIN` (e.g., `monorail.proxy.rlwy.net`)
   - `RAILWAY_TCP_PROXY_PORT` (e.g., `12345`)

## Update .env File

Replace the placeholders in your `.env` file:

```env
DATABASE_URL="postgresql://postgres:UOypFWJPcbyNgWWGIMGbofjiaHjXnqhL@[RAILWAY_TCP_PROXY_DOMAIN]:[RAILWAY_TCP_PROXY_PORT]/railway?schema=public"
```

Example:
```env
DATABASE_URL="postgresql://postgres:UOypFWJPcbyNgWWGIMGbofjiaHjXnqhL@monorail.proxy.rlwy.net:12345/railway?schema=public"
```

## Enable pgvector Extension

Before running migrations, you need to enable the pgvector extension in your Railway PostgreSQL database.

### Option 1: Using Railway Dashboard
1. Go to your PostgreSQL service in Railway
2. Click on "Data" tab
3. Open the Query tab
4. Run: `CREATE EXTENSION IF NOT EXISTS vector;`

### Option 2: Using psql CLI
```bash
# Connect to your database
psql "postgresql://postgres:UOypFWJPcbyNgWWGIMGbofjiaHjXnqhL@[RAILWAY_TCP_PROXY_DOMAIN]:[RAILWAY_TCP_PROXY_PORT]/railway"

# Enable extension
CREATE EXTENSION IF NOT EXISTS vector;

# Verify
\dx
```

## Run Migrations and Seed

Once the extension is enabled and DATABASE_URL is updated:

```bash
# Generate Prisma client
npm run db:generate

# Run migrations
npm run db:migrate

# Seed the database
npm run db:seed

# Or do everything at once
npm run db:setup
```

## Verify Setup

After seeding, you should have:
- 1 admin user (check ADMIN_EMAIL in .env)
- 5 sample interview questions

## Troubleshooting

### Can't reach database server
- Make sure you're using the TCP proxy domain and port, not `railway.internal`
- Verify your Railway PostgreSQL service is running

### pgvector extension not found
- Make sure you enabled the extension before running migrations
- Railway PostgreSQL should support pgvector by default

### Authentication failed
- Double-check the password in your .env matches Railway's POSTGRES_PASSWORD
