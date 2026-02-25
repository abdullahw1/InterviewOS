# InterviewOS

A comprehensive interview preparation platform that helps you practice interviews, drill on your own codebase, track LeetCode problems with spaced repetition, and manage your job hunt—all powered by AI.

## Features

### 🎤 Interview Practice
- Record your interview answers using browser audio
- Get AI-powered feedback with structured rubrics
- Receive improved answer suggestions and follow-up questions
- Track your progress over time with session history
- Resume gap analysis to identify missing signals

### 📁 Project Drills
- Index your own repositories for personalized quizzes
- AI-generated questions based on your actual code
- Retrieval-augmented generation using pgvector
- Track weak areas and improve your codebase knowledge

### 💻 LeetCode Tracker
- Track problems with SM-2 spaced repetition algorithm
- Organize by patterns and difficulty
- Daily review reminders
- Streak tracking for consistency

### 💼 Job Hunt Manager
- Kanban-style pipeline view (Applied → Phone Screen → Technical → Onsite → Offer)
- AI-generated follow-up email templates
- Follow-up reminders and daily counters
- CSV export for external tracking

### 💰 Cost Tracker
- Monitor OpenAI API usage in real-time
- Breakdown by feature and model
- Token usage tracking
- Estimated cost calculations

## Tech Stack

- **Framework**: Next.js 15+ (App Router)
- **Language**: TypeScript
- **Database**: PostgreSQL with pgvector extension
- **ORM**: Prisma with pg adapter
- **Authentication**: NextAuth.js (Credentials provider)
- **AI**: OpenAI API (GPT-4o, GPT-4o-mini, text-embedding-3-small)
- **UI**: Tailwind CSS + shadcn/ui components
- **Audio**: MediaRecorder API + Web Speech API

## Prerequisites

- Node.js 18+ and npm
- PostgreSQL 14+ with pgvector extension
- OpenAI API key

## Local Development Setup

### 1. Clone and Install

```bash
cd InterviewOS
npm install
```

### 2. Set Up PostgreSQL with pgvector

Install PostgreSQL and the pgvector extension:

```bash
# macOS (using Homebrew)
brew install postgresql@14
brew install pgvector

# Start PostgreSQL
brew services start postgresql@14

# Create database
createdb interviewos
```

Enable pgvector extension:

```bash
psql interviewos
CREATE EXTENSION vector;
\q
```

### 3. Configure Environment Variables

Copy the example environment file:

```bash
cp .env.example .env
```

Edit `.env` with your values:

```env
DATABASE_URL="postgresql://user:password@localhost:5432/interviewos?schema=public"
NEXTAUTH_SECRET="generate-with-openssl-rand-base64-32"
NEXTAUTH_URL="http://localhost:3000"
ADMIN_EMAIL="admin@interviewos.com"
ADMIN_PASSWORD="your-secure-password"
OPENAI_API_KEY="sk-your-openai-api-key"
REPO_PATHS="/path/to/your/repo1,/path/to/your/repo2"
```

Generate a secure `NEXTAUTH_SECRET`:

```bash
openssl rand -base64 32
```

### 4. Run Database Migrations

```bash
npx prisma migrate deploy
npx prisma generate
```

### 5. Seed the Database

```bash
npm run seed
```

This creates the admin user and sample interview questions.

### 6. Start the Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and log in with your admin credentials.

## Railway Deployment

### 1. Create Railway Project

1. Sign up at [Railway.app](https://railway.app)
2. Create a new project
3. Add a PostgreSQL database service

### 2. Enable pgvector Extension

In Railway's PostgreSQL service:

1. Connect to the database using the provided connection string
2. Run: `CREATE EXTENSION IF NOT EXISTS vector;`

### 3. Configure Environment Variables

In your Railway project settings, add all environment variables from `.env.example`:

```
DATABASE_URL=<provided-by-railway-postgres>
NEXTAUTH_SECRET=<generate-secure-secret>
NEXTAUTH_URL=<your-railway-app-url>
ADMIN_EMAIL=admin@interviewos.com
ADMIN_PASSWORD=<secure-password>
OPENAI_API_KEY=<your-openai-key>
REPO_PATHS=<comma-separated-paths>
```

### 4. Deploy from GitHub

1. Connect your GitHub repository to Railway
2. Railway will automatically detect Next.js and deploy
3. Build command: `npm run build`
4. Start command: `npm start`

### 5. Run Migrations

After first deployment, run migrations in Railway's terminal:

```bash
npx prisma migrate deploy
npx prisma generate
npm run seed
```

### 6. Access Your App

Your app will be available at `https://your-app.railway.app`

## Environment Variables Reference

| Variable | Required | Description | Default |
|----------|----------|-------------|---------|
| `DATABASE_URL` | Yes | PostgreSQL connection string with pgvector | - |
| `NEXTAUTH_SECRET` | Yes | Secret for NextAuth.js session encryption | - |
| `NEXTAUTH_URL` | Yes | Full URL of your application | `http://localhost:3000` |
| `ADMIN_EMAIL` | Yes | Admin user email for login | - |
| `ADMIN_PASSWORD` | Yes | Admin user password | - |
| `OPENAI_API_KEY` | Yes | OpenAI API key for AI features | - |
| `REPO_PATHS` | Yes | Comma-separated paths to repos for indexing | - |
| `EMBEDDING_MODEL` | No | OpenAI embedding model | `text-embedding-3-small` |
| `TRANSCRIPTION_MODEL` | No | OpenAI transcription model | `gpt-4o-mini-transcribe` |
| `ANALYSIS_MODEL` | No | OpenAI analysis model | `gpt-4o-mini` |
| `ANALYSIS_PREMIUM_MODEL` | No | OpenAI premium model | `gpt-4o` |

## API Endpoints

### Authentication
- `POST /api/auth/signin` - Sign in with credentials
- `POST /api/auth/signout` - Sign out

### Interview Practice
- `POST /api/interview/transcribe` - Transcribe audio to text
- `POST /api/interview/grade` - Grade interview answer with AI feedback

### Project Drills
- `POST /api/index` - Index repositories
- `GET /api/index` - Get indexing status
- `POST /api/projects/quiz` - Generate or grade quiz questions

### LeetCode Tracker
- `GET /api/leetcode` - List LeetCode problems
- `POST /api/leetcode` - Create new problem
- `PUT /api/leetcode/[id]` - Update problem
- `DELETE /api/leetcode/[id]` - Delete problem

### Job Hunt
- `GET /api/jobs` - List job applications
- `POST /api/jobs` - Create new application
- `PUT /api/jobs/[id]` - Update application
- `DELETE /api/jobs/[id]` - Delete application
- `POST /api/jobs/follow-up` - Generate AI follow-up messages
- `GET /api/jobs/export` - Export applications as CSV

### Settings
- `GET /api/resume` - Get resume text
- `PUT /api/resume` - Update resume text

## Project Structure

```
InterviewOS/
├── prisma/
│   ├── schema.prisma          # Database schema with pgvector
│   ├── seed.ts                # Database seeding script
│   └── migrations/            # Database migrations
├── src/
│   ├── app/
│   │   ├── (auth)/           # Authentication pages
│   │   ├── (dashboard)/      # Protected dashboard pages
│   │   └── api/              # API routes
│   ├── components/
│   │   └── ui/               # shadcn/ui components
│   ├── hooks/
│   │   └── useRecorder.ts    # Audio recording hook
│   ├── lib/
│   │   ├── auth.ts           # NextAuth configuration
│   │   ├── config/           # Model configuration
│   │   └── services/         # Business logic services
│   └── middleware.ts         # Auth middleware
├── .env.example              # Environment variables template
└── package.json
```

## Development Commands

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build

# Start production server
npm start

# Run database migrations
npx prisma migrate dev

# Generate Prisma client
npx prisma generate

# Seed database
npm run seed

# Open Prisma Studio (database GUI)
npx prisma studio
```

## Troubleshooting

### pgvector Extension Not Found

If you see errors about the `vector` type:

```bash
psql your_database
CREATE EXTENSION IF NOT EXISTS vector;
```

### Prisma Client Issues

If you encounter Prisma client errors:

```bash
npx prisma generate
npm run build
```

### Audio Recording Not Working

- Ensure you're using HTTPS (or localhost)
- Grant microphone permissions in your browser
- Check browser compatibility (Chrome/Edge recommended)

### OpenAI API Errors

- Verify your API key is valid
- Check your OpenAI account has credits
- Review rate limits in the OpenAI dashboard

## License

MIT

## Support

For issues and questions, please open an issue on GitHub.
