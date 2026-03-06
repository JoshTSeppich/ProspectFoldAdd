// lib/apollo.ts - Apollo API integration for org and contact enrichment

import { ApolloOrganization, ApolloPerson } from './types';

export async function searchApolloOrganization(
  companyName: string
): Promise<ApolloOrganization | null> {
  const response = await fetch('https://api.apollo.io/v1/organizations/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': process.env.APOLLO_API_KEY!,
    },
    body: JSON.stringify({
      q_organization_name: companyName,
      page: 1,
      per_page: 1,
    }),
  });

  if (!response.ok) {
    console.error('Apollo org search failed:', await response.text());
    return null;
  }

  const data = await response.json();
  const org = data.organizations?.[0];

  if (!org) {
    return null;
  }

  return {
    id: org.id,
    name: org.name,
    domain: org.primary_domain,
    employeeCount: org.estimated_num_employees || 0,
    industry: org.industry || 'Unknown',
    location: `${org.city || ''}, ${org.state || ''}, ${org.country || ''}`.trim(),
    linkedinUrl: org.linkedin_url,
  };
}

export async function searchApolloPeople(
  apolloOrgId: string,
  titles: string[] = [
    'Provost',
    'Vice President of Academic Affairs',
    'VP Academic Affairs',
    'Chief Academic Officer',
    'Dean',
    'Academic Dean',
    'CIO',
    'Director of Academic Integrity',
    'Director of Instructional Technology',
  ]
): Promise<ApolloPerson[]> {
  const response = await fetch('https://api.apollo.io/v1/mixed_people/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': process.env.APOLLO_API_KEY!,
    },
    body: JSON.stringify({
      organization_ids: [apolloOrgId],
      person_titles: titles,
      page: 1,
      per_page: 10,
    }),
  });

  if (!response.ok) {
    console.error('Apollo people search failed:', await response.text());
    return [];
  }

  const data = await response.json();
  const people = data.people || [];

  return people.map((person: any) => ({
    id: person.id,
    name: person.name,
    title: person.title,
    email: person.email,
    linkedinUrl: person.linkedin_url,
    department: person.departments?.[0] || null,
  }));
}

export async function rankContacts(
  contacts: ApolloPerson[],
  recommendedSalesAngle: string,
  currentSituation: string
): Promise<ApolloPerson | null> {
  if (contacts.length === 0) return null;
  if (contacts.length === 1) return contacts[0];

  const prompt = `Given these contacts from Apollo:
${JSON.stringify(contacts, null, 2)}

And this context:
- Recommended sales angle: ${recommendedSalesAngle}
- Current situation: ${currentSituation}

Which contact should we reach out to first?
Consider decision-making authority for academic integrity/EdTech purchases.

Return ONLY valid JSON (no preamble):
{
  "primaryContactId": "...",
  "rationale": "..."
}`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    // If ranking fails, just return first contact
    return contacts[0];
  }

  const data = await response.json();
  const content = data.content[0].text;
  const cleaned = content
    .replace(/```json\n?/g, '')
    .replace(/```\n?/g, '')
    .trim();

  const result = JSON.parse(cleaned);
  const primaryContact = contacts.find(c => c.id === result.primaryContactId);
  
  return primaryContact || contacts[0];
}
