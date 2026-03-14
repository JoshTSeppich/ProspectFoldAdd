// app/api/finalfold/route.ts
// Parses an intel pack's Apollo Search Queries section and returns enriched contacts

import { NextRequest, NextResponse } from 'next/server';

interface ApolloQuery {
  label: string;
  filters: Record<string, unknown>;
}

interface ContactResult {
  id: string;
  name: string;
  title: string;
  company: string;
  companyDomain?: string;
  companySize?: number;
  industry?: string;
  location?: string;
  email?: string;
  emailStatus?: string;
  linkedinUrl?: string;
  twitterUrl?: string;
  photoUrl?: string;
}

// Extract JSON query objects from the ## Apollo Search Queries section
function parseApolloQueries(markdown: string): ApolloQuery[] {
  const queries: ApolloQuery[] = [];

  // Find the Apollo Search Queries section
  const sectionMatch = markdown.match(/##\s+Apollo Search Queries([\s\S]*?)(?=\n##\s|\n# |\z)/);
  if (!sectionMatch) return queries;

  const section = sectionMatch[1];

  // Match each line: - **Label**: `{...json...}`
  const linePattern = /[-*]\s+\*\*([^*]+)\*\*[^`]*`(\{[^`]+\})`/g;
  let match;

  while ((match = linePattern.exec(section)) !== null) {
    const label = match[1].trim();
    const jsonStr = match[2].trim();

    try {
      const filters = JSON.parse(jsonStr);
      queries.push({ label, filters });
    } catch {
      // Skip malformed JSON
    }
  }

  return queries;
}

// Extract target person titles from the ICP section
function extractTargetTitles(markdown: string): string[] {
  const defaults = [
    'CTO', 'Chief Technology Officer',
    'Co-Founder', 'Founder', 'CEO',
    'VP Engineering', 'VP of Engineering',
    'Head of Platform', 'Head of Infrastructure', 'Head of Engineering',
    'Director of Engineering', 'Principal Engineer',
  ];

  // Look for title hints in the ICP / Qualifying section
  const inIcp = markdown.match(/person_titles["\s:]+\[([^\]]+)\]/i);
  if (inIcp) {
    try {
      const parsed = JSON.parse(`[${inIcp[1]}]`);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch { /* fall through */ }
  }

  return defaults;
}

async function searchApolloPeople(
  filters: Record<string, unknown>,
  personTitles: string[],
  apiKey: string,
  page = 1,
  perPage = 25,
): Promise<{ people: ContactResult[]; total: number }> {
  const body: Record<string, unknown> = {
    ...filters,
    person_titles: personTitles,
    page,
    per_page: perPage,
    contact_email_status_v2: ['verified', 'likely to engage', 'guessed'],
  };

  const res = await fetch('https://api.apollo.io/v1/mixed_people/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'X-Api-Key': apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error('Apollo people search error:', res.status, text);
    return { people: [], total: 0 };
  }

  const data = await res.json();
  const people = (data.people || []).map((p: any): ContactResult => ({
    id: p.id,
    name: p.name,
    title: p.title || '',
    company: p.organization?.name || p.employment_history?.[0]?.organization_name || '',
    companyDomain: p.organization?.primary_domain || undefined,
    companySize: p.organization?.estimated_num_employees || undefined,
    industry: p.organization?.industry || undefined,
    location: [p.city, p.state, p.country].filter(Boolean).join(', ') || undefined,
    email: p.email || undefined,
    emailStatus: p.email_status || undefined,
    linkedinUrl: p.linkedin_url || undefined,
    twitterUrl: p.twitter_url || undefined,
    photoUrl: p.photo_url || undefined,
  }));

  return { people, total: data.pagination?.total_entries || people.length };
}

export async function POST(req: NextRequest) {
  try {
    const { markdown } = await req.json();

    if (!markdown?.trim()) {
      return NextResponse.json({ error: 'Intel pack markdown is required' }, { status: 400 });
    }

    const apiKey = process.env.APOLLO_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'APOLLO_API_KEY not configured' }, { status: 500 });
    }

    const queries = parseApolloQueries(markdown);
    if (queries.length === 0) {
      return NextResponse.json(
        { error: 'No Apollo Search Queries section found in the intel pack' },
        { status: 422 }
      );
    }

    const personTitles = extractTargetTitles(markdown);

    // Run up to 4 queries concurrently (to stay within rate limits)
    const queryCap = Math.min(queries.length, 4);
    const results = await Promise.all(
      queries.slice(0, queryCap).map(q =>
        searchApolloPeople(q.filters, personTitles, apiKey).then(r => ({
          ...r,
          label: q.label,
        }))
      )
    );

    // Deduplicate by person id, prefer entries with email
    const seen = new Map<string, ContactResult>();
    for (const batch of results) {
      for (const person of batch.people) {
        const existing = seen.get(person.id);
        if (!existing || (!existing.email && person.email)) {
          seen.set(person.id, person);
        }
      }
    }

    const contacts = Array.from(seen.values()).sort((a, b) => {
      // Verified email first, then guessed, then none
      const emailScore = (c: ContactResult) => {
        if (!c.email) return 0;
        if (c.emailStatus === 'verified') return 3;
        if (c.emailStatus === 'likely to engage') return 2;
        return 1;
      };
      return emailScore(b) - emailScore(a);
    });

    return NextResponse.json({
      contacts,
      queriesRun: results.map(r => ({ label: r.label, total: r.total })),
      totalContacts: contacts.length,
    });
  } catch (error: any) {
    console.error('FinalFold error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
