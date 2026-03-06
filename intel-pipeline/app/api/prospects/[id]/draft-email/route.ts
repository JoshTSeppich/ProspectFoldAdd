// app/api/prospects/[id]/draft-email/route.ts - Generate personalized outreach email

import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { generateOutreachEmail } from '@/lib/outreach';

const prisma = new PrismaClient();

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const prospectId = params.id;

    // Get prospect with intel package data
    const prospect = await prisma.prospect.findUnique({
      where: { id: prospectId },
      include: {
        intelPackage: true,
        contacts: {
          where: { isPrimary: true },
        },
      },
    });

    if (!prospect) {
      return NextResponse.json(
        { error: 'Prospect not found' },
        { status: 404 }
      );
    }

    const primaryContact = prospect.contacts[0];
    if (!primaryContact) {
      return NextResponse.json(
        { error: 'No primary contact found' },
        { status: 404 }
      );
    }

    // Get sales angle details from intel package
    const parsed = prospect.intelPackage.parsedData as any;
    const salesAngle = parsed.salesAngles.find(
      (a: any) => a.name === prospect.recommendedSalesAngle
    );

    if (!salesAngle) {
      return NextResponse.json(
        { error: 'Sales angle not found' },
        { status: 404 }
      );
    }

    // Build enriched prospect object
    const enrichedProspect = {
      id: prospect.id,
      name: prospect.name,
      primaryContact: {
        name: primaryContact.name,
        title: primaryContact.title,
        email: primaryContact.email || 'No email',
      },
      currentSituation: (prospect.researchData as any)?.currentSituation || {},
      buyingSignals: (prospect.researchData as any)?.buyingSignals || [],
      recommendedSalesAngle: prospect.recommendedSalesAngle || '',
      personalizationHooks: prospect.personalizationHooks || [],
    };

    // Generate email
    const draft = await generateOutreachEmail(
      enrichedProspect as any,
      salesAngle.hypothesis,
      salesAngle.hook
    );

    // Save draft to database
    await prisma.outreachMessage.create({
      data: {
        prospectId: prospect.id,
        contactId: primaryContact.id,
        subject: draft.subject,
        body: draft.body,
        salesAngleUsed: prospect.recommendedSalesAngle || null,
        personalizationHooksUsed: prospect.personalizationHooks,
        status: 'DRAFTED',
      },
    });

    return NextResponse.json(draft);
  } catch (error: any) {
    console.error('Draft generation error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to generate draft' },
      { status: 500 }
    );
  }
}
