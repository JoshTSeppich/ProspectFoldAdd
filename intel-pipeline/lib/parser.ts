// lib/parser.ts - Parse intelligence packages using Claude API

import { IntelligencePackage } from './types';

export async function parseIntelligencePackage(
  markdown: string
): Promise<IntelligencePackage> {
  const prompt = `You are parsing a market intelligence package. Extract the following information and return ONLY valid JSON (no preamble, no markdown code fences):

1. Summary (brief overview of the market/sector)
2. ICP (Ideal Customer Profile):
   - companyTypes: array of company types mentioned
   - companySizes: array of company size ranges
   - qualifyingCriteria: array of criteria that qualify a prospect
   - signals: array of buying signals to look for
3. salesAngles: array of objects with {name, hypothesis, hook}
4. qualificationChecklist: array of objects with {criterion, howToVerify}
5. redFlags: array of disqualification criteria
6. namedProspects: array of objects with {name, context, urgencySignal}
   - Extract ALL named companies/institutions mentioned in the document
   - Include context about why they're mentioned
   - Assign urgencySignal: CRITICAL, HIGH, MEDIUM, or LOW based on their situation

Return this exact JSON structure:
{
  "summary": "...",
  "icp": {
    "companyTypes": ["...", "..."],
    "companySizes": ["...", "..."],
    "qualifyingCriteria": ["...", "..."],
    "signals": ["...", "..."]
  },
  "salesAngles": [
    {"name": "...", "hypothesis": "...", "hook": "..."}
  ],
  "qualificationChecklist": [
    {"criterion": "...", "howToVerify": "..."}
  ],
  "redFlags": ["...", "..."],
  "namedProspects": [
    {"name": "...", "context": "...", "urgencySignal": "HIGH"}
  ]
}

Here is the intelligence package to parse:

${markdown}`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8000,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Claude API error: ${error}`);
  }

  const data = await response.json();
  const content = data.content[0].text;

  // Parse the JSON response
  // Remove any potential markdown code fences
  const cleanedContent = content
    .replace(/```json\n?/g, '')
    .replace(/```\n?/g, '')
    .trim();

  const parsed: IntelligencePackage = JSON.parse(cleanedContent);
  
  return parsed;
}
