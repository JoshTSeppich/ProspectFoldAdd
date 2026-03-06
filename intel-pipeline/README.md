# Intelligence Package → Prospect Pipeline

Transform market intelligence documents into researched, qualified prospects with personalized outreach.

## 🎯 What It Does

1. **Upload** a markdown intelligence package (market research)
2. **Parse** to extract prospects, ICP criteria, sales angles
3. **Research** each prospect using Claude API (web_search) + Apollo API
4. **Display** prospect cards with fit scores and buying signals
5. **Generate** personalized cold emails with one click

## 📋 Prerequisites

- Node.js 18+ and npm
- PostgreSQL database
- Anthropic API key (Claude)
- Apollo.io API key

## 🚀 Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Set Up Environment Variables

Create `.env` file:

```env
DATABASE_URL="postgresql://user:password@localhost:5432/intel_pipeline"
ANTHROPIC_API_KEY="sk-ant-your-key-here"
APOLLO_API_KEY="your-apollo-key-here"
```

### 3. Initialize Database

```bash
npm run prisma:migrate
npm run prisma:generate
```

### 4. Run Development Server

```bash
npm run dev
```

Visit `http://localhost:3000`

## 📁 Project Structure

```
intel-prospect-pipeline/
├── app/                      # Next.js app directory
│   ├── page.tsx             # Main application page
│   ├── layout.tsx           # Root layout
│   └── api/                 # API routes
│       ├── intel/
│       │   ├── parse/       # Parse intelligence packages
│       │   └── [id]/
│       │       └── research-stream/  # Stream research progress
│       └── prospects/
│           └── [id]/
│               └── draft-email/      # Generate outreach emails
├── components/              # React components
│   ├── UploadIntelPackage.tsx
│   ├── ResearchProgress.tsx
│   ├── ProspectCard.tsx
│   └── DraftModal.tsx
├── lib/                     # Core business logic
│   ├── types.ts            # TypeScript interfaces
│   ├── parser.ts           # Intelligence package parser
│   ├── researcher.ts       # Prospect research pipeline
│   ├── apollo.ts           # Apollo API integration
│   └── outreach.ts         # Email generation
└── prisma/
    └── schema.prisma       # Database schema
```

## 🔄 Pipeline Flow

### Stage 1: Parse Intelligence Package

```typescript
Intelligence Package (Markdown)
    ↓
Claude API parses structure
    ↓
Extract: ICP, Sales Angles, Named Prospects, Qualification Criteria
    ↓
Store in PostgreSQL
```

### Stage 2: Research Prospects

```typescript
For each prospect:
    ↓
Claude API with web_search
    - Recent news
    - LMS in use
    - AI policies
    - Decision makers
    - Buying signals
    ↓
Apollo API
    - Organization validation
    - Contact search (Provost, VP, CIO, etc.)
    - Email enrichment
    ↓
Calculate fit score (0-100)
    ↓
Store enriched data
```

### Stage 3: Generate Outreach

```typescript
User clicks "Reach Out"
    ↓
Claude API generates personalized email
    - Uses prospect's specific situation
    - Applies relevant sales angle
    - Includes 3-5 personalization hooks
    ↓
User copies or edits draft
```

## 📊 Database Schema

Key tables:

- `intelligence_packages` - Uploaded intel docs
- `prospects` - Extracted companies to research
- `contacts` - Decision makers from Apollo
- `outreach_messages` - Drafted/sent emails

## 🔑 API Keys Setup

### Anthropic (Claude)

1. Get API key from https://console.anthropic.com
2. Add to `.env` as `ANTHROPIC_API_KEY`
3. Ensure you have credits/billing enabled

### Apollo.io

1. Get API key from Apollo.io account settings
2. Add to `.env` as `APOLLO_API_KEY`
3. Note: Free tier has rate limits

## 🎨 Customization

### Modify Qualification Criteria

Edit `lib/researcher.ts` → `calculateFitScore()` to adjust weights:

```typescript
const weights = {
  hasLMS: 15,
  budgetAuthorityIdentified: 20,
  // ...adjust as needed
};
```

### Add New Sales Angles

Intelligence packages define sales angles. Example format:

```markdown
## Sales Angles

### Credential Credibility Crisis
**Hypothesis:** Small colleges can't afford integrity scandal
**Hook:** 86% of students use AI - protect degree value
```

### Change Contact Title Search

Edit `lib/apollo.ts` → `searchApolloPeople()`:

```typescript
titles: string[] = [
  'Provost',
  'VP Academic Affairs',
  // ...add your target titles
]
```

## 🧪 Testing with Sample Data

Use the provided Higher Education intelligence package:

1. Create a file `sample-intel.md` with the Higher Ed AI detection market intel
2. Upload through the UI
3. Watch research progress stream
4. Review qualified prospects
5. Generate draft emails

## 🐛 Troubleshooting

**Parsing fails:**
- Check ANTHROPIC_API_KEY is valid
- Ensure markdown has clear section headers

**Research hangs:**
- Check Claude API rate limits
- Verify web_search tool is available in your API tier

**Apollo returns no contacts:**
- Verify APOLLO_API_KEY is valid
- Check organization name spelling
- Try broader title searches

**Database connection fails:**
- Verify PostgreSQL is running
- Check DATABASE_URL format
- Run `npm run prisma:migrate`

## 📝 Intelligence Package Format

Expected markdown structure:

```markdown
# Market Intelligence Title

## Summary
Brief overview of the market/sector

## ICP Profile
**Company Types:** [types]
**Company Sizes:** [sizes]
**Qualifying Criteria:**
- Criterion 1
- Criterion 2

## Sales Angles
### Angle Name
**Hypothesis:** [hypothesis]
**Hook:** [hook]

## Named Prospects
- Company Name 1 (Location) - context
- Company Name 2 (Location) - context

## Qualification Checklist
- [ ] Criterion to verify
- [ ] Another criterion

## Red Flags
- Disqualification criterion 1
- Disqualification criterion 2
```

## 🚀 Production Deployment

1. Set up PostgreSQL database (e.g., Railway, Supabase)
2. Configure environment variables in hosting platform
3. Deploy to Vercel/Railway/your platform
4. Run `npm run prisma:migrate` on production DB
5. Monitor Claude API usage and costs

## 📊 Success Metrics

- **Prospects extracted:** 20-50 per intel package
- **Qualification accuracy:** >85% (no false positives)
- **Research time:** <2 min per prospect
- **Apollo contact match:** >70%
- **Email personalization:** 3+ hooks per email

## 🔐 Security Notes

- Never commit `.env` file
- Rotate API keys regularly
- Use environment-specific keys
- Rate limit API routes in production

## 📚 Learn More

- [Anthropic Claude API Docs](https://docs.anthropic.com)
- [Apollo.io API Docs](https://apolloio.github.io/apollo-api-docs/)
- [Next.js Documentation](https://nextjs.org/docs)
- [Prisma Documentation](https://www.prisma.io/docs)

---

Built with Claude Sonnet 4.5, Next.js 15, and Prisma
