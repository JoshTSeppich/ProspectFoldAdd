// lib/researcher.ts - Research prospects using Claude API with web_search

import { ProspectResearch, IntelligencePackage } from './types';

export async function researchProspect(
  prospectName: string,
  intelPackage: IntelligencePackage
): Promise<ProspectResearch> {
  const prompt = `You are researching "${prospectName}" for B2B outreach qualification.

ICP CRITERIA TO VALIDATE:
${intelPackage.qualificationChecklist.map(q => `- ${q.criterion}`).join('\n')}

RED FLAGS TO CHECK FOR:
${intelPackage.redFlags.map(r => `- ${r}`).join('\n')}

BUYING SIGNALS TO LOOK FOR:
${intelPackage.icp.signals.map(s => `- ${s}`).join('\n')}

SALES ANGLES AVAILABLE:
${intelPackage.salesAngles.map(a => `- ${a.name}: ${a.hook}`).join('\n')}

Use web_search to find:
1. Recent news about ${prospectName} (enrollment trends, financial health, leadership changes)
2. Check if they have an LMS (Canvas, Blackboard, Moodle, Brightspace)
3. Search for academic integrity or AI usage policies
4. Find decision-maker names and titles (Provost, VP Academic Affairs, CIO, Dean, Academic Integrity Officer)
5. Look for buying signals: RFPs, policy updates, faculty discussions about AI
6. Check for red flags: closure announcements, recent vendor contracts

Return ONLY valid JSON (no preamble, no markdown code fences):
{
  "prospectName": "${prospectName}",
  "currentSituation": {
    "enrollmentTrends": "...",
    "financialHealth": "...",
    "recentNews": ["...", "..."],
    "leadershipChanges": "..."
  },
  "qualificationScore": {
    "hasLMS": true/false/null,
    "hasAcademicIntegrityPolicy": true/false/null,
    "hasAIPolicy": true/false/null,
    "hasOnlinePrograms": true/false/null,
    "hasWritingIntensivePrograms": true/false/null,
    "budgetAuthorityIdentified": true/false/null,
    "underEnrollmentPressure": true/false/null,
    "hasAccreditationReview": true/false/null
  },
  "redFlagsDetected": ["...", "..."],
  "isDisqualified": false,
  "disqualificationReason": null,
  "buyingSignals": [
    {"signal": "...", "source": "...", "date": "..."}
  ],
  "decisionMakers": [
    {"name": "...", "title": "...", "source": "..."}
  ],
  "recommendedSalesAngle": "...",
  "personalizationHooks": ["...", "...", "..."]
}

Use null for boolean values if you can't find evidence either way.
For recommendedSalesAngle, choose the most relevant sales angle from the list above based on the prospect's situation.
For personalizationHooks, include 3-5 specific facts about ${prospectName} that can be used in outreach.`;

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
      tools: [
        {
          type: 'web_search_20250305',
          name: 'web_search',
        },
      ],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Claude API error: ${error}`);
  }

  const data = await response.json();
  
  // Extract text content from response
  let textContent = '';
  for (const block of data.content) {
    if (block.type === 'text') {
      textContent += block.text;
    }
  }

  // Parse JSON response
  const cleanedContent = textContent
    .replace(/```json\n?/g, '')
    .replace(/```\n?/g, '')
    .trim();

  const research: ProspectResearch = JSON.parse(cleanedContent);
  
  return research;
}

export function calculateFitScore(qualificationScore: ProspectResearch['qualificationScore']): number {
  const weights = {
    hasLMS: 15,
    hasAcademicIntegrityPolicy: 15,
    hasAIPolicy: 15,
    hasOnlinePrograms: 10,
    hasWritingIntensivePrograms: 10,
    budgetAuthorityIdentified: 20,
    underEnrollmentPressure: 10,
    hasAccreditationReview: 5,
  };

  let totalScore = 0;
  let maxPossible = 0;

  for (const [key, weight] of Object.entries(weights)) {
    const value = qualificationScore[key as keyof typeof qualificationScore];
    maxPossible += weight;
    if (value === true) {
      totalScore += weight;
    } else if (value === false) {
      // Explicitly false scores 0
      totalScore += 0;
    } else {
      // null means unknown - give 50% credit
      totalScore += weight * 0.5;
    }
  }

  return Math.round((totalScore / maxPossible) * 100);
}
