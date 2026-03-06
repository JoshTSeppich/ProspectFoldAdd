// lib/outreach.ts - Generate personalized cold emails using Claude API

import { EnrichedProspect, DraftedOutreach } from './types';

export async function generateOutreachEmail(
  prospect: EnrichedProspect,
  salesAngleHypothesis: string,
  salesAngleHook: string
): Promise<{ subject: string; body: string }> {
  const prompt = `Draft a cold outreach email for B2B sales.

PROSPECT CONTEXT:
- Company: ${prospect.name}
- Contact: ${prospect.primaryContact?.name}, ${prospect.primaryContact?.title}
- Current situation: ${JSON.stringify(prospect.currentSituation)}
- Buying signals: ${prospect.buyingSignals.map(s => s.signal).join(', ')}

SALES ANGLE: ${prospect.recommendedSalesAngle}
- Hypothesis: ${salesAngleHypothesis}
- Hook: ${salesAngleHook}

PERSONALIZATION HOOKS:
${prospect.personalizationHooks.join('\n')}

Write a concise email (150-200 words) that:
1. Opens with a personalized reference to their specific situation (use personalization hooks)
2. Connects to the sales angle hook naturally
3. Offers concrete value (not generic benefits)
4. Includes clear CTA (suggest 15-min call)

Tone: Senior professional, helpful not salesy, human not AI-generated.

Return ONLY valid JSON (no preamble):
{
  "subject": "...",
  "body": "..."
}

Subject line should:
- Reference their specific situation
- Be under 60 characters
- NOT be generic or salesy`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
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
  const cleaned = content
    .replace(/```json\n?/g, '')
    .replace(/```\n?/g, '')
    .trim();

  return JSON.parse(cleaned);
}
