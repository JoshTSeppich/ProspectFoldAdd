// app/api/intel/parse/route.ts - Parse intelligence package endpoint

import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { parseIntelligencePackage } from '@/lib/parser';

const prisma = new PrismaClient();

export async function POST(req: NextRequest) {
  try {
    const { markdown } = await req.json();

    if (!markdown) {
      return NextResponse.json(
        { error: 'Markdown content is required' },
        { status: 400 }
      );
    }

    // Parse the intelligence package using Claude
    const parsed = await parseIntelligencePackage(markdown);

    // Save to database
    const intelPackage = await prisma.intelligencePackage.create({
      data: {
        title: `Intelligence Package - ${new Date().toISOString().split('T')[0]}`,
        markdownContent: markdown,
        parsedData: parsed as any,
        prospectCount: parsed.namedProspects.length,
        processedAt: new Date(),
      },
    });

    // Create prospect records
    await Promise.all(
      parsed.namedProspects.map(async (namedProspect) => {
        await prisma.prospect.create({
          data: {
            intelPackageId: intelPackage.id,
            name: namedProspect.name,
            discoveryContext: namedProspect.context,
            urgencyLevel: namedProspect.urgencySignal || 'MEDIUM',
            isQualified: false,
          },
        });
      })
    );

    return NextResponse.json({
      packageId: intelPackage.id,
      prospectCount: parsed.namedProspects.length,
      salesAngles: parsed.salesAngles.map(a => a.name),
    });
  } catch (error: any) {
    console.error('Parse error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to parse intelligence package' },
      { status: 500 }
    );
  }
}
