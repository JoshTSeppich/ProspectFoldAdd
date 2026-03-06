// app/api/intel/[id]/research-stream/route.ts - Stream research progress via SSE

import { NextRequest } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { researchProspect, calculateFitScore } from '@/lib/researcher';
import { searchApolloOrganization, searchApolloPeople, rankContacts } from '@/lib/apollo';

const prisma = new PrismaClient();

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const packageId = params.id;

  // Create a TransformStream for Server-Sent Events
  const encoder = new TextEncoder();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();

  // Start research in background
  (async () => {
    try {
      // Get intelligence package
      const intelPackage = await prisma.intelligencePackage.findUnique({
        where: { id: packageId },
      });

      if (!intelPackage) {
        await writer.write(
          encoder.encode(`data: ${JSON.stringify({ type: 'error', message: 'Package not found' })}\n\n`)
        );
        await writer.close();
        return;
      }

      const parsed = intelPackage.parsedData as any;

      // Get prospects to research
      const prospects = await prisma.prospect.findMany({
        where: { intelPackageId: packageId },
      });

      // Research each prospect
      for (let i = 0; i < prospects.length; i++) {
        const prospect = prospects[i];

        // Send progress update
        await writer.write(
          encoder.encode(`data: ${JSON.stringify({
            type: 'progress',
            data: {
              current: i + 1,
              total: prospects.length,
              currentProspect: prospect.name,
              status: 'Searching web for information...',
            },
          })}\n\n`)
        );

        try {
          // Step 1: Research with Claude (web_search)
          const research = await researchProspect(prospect.name, parsed);
          
          await writer.write(
            encoder.encode(`data: ${JSON.stringify({
              type: 'progress',
              data: {
                current: i + 1,
                total: prospects.length,
                currentProspect: prospect.name,
                status: 'Validating with Apollo...',
              },
            })}\n\n`)
          );

          // Step 2: Validate with Apollo
          const apolloOrg = await searchApolloOrganization(prospect.name);
          let apolloContacts: any[] = [];
          let primaryContact = null;

          if (apolloOrg) {
            apolloContacts = await searchApolloPeople(apolloOrg.id);
            if (apolloContacts.length > 0) {
              const ranked = await rankContacts(
                apolloContacts,
                research.recommendedSalesAngle,
                JSON.stringify(research.currentSituation)
              );
              if (ranked) {
                primaryContact = ranked;
                
                // Create contact in database
                const contactRecord = await prisma.contact.create({
                  data: {
                    prospectId: prospect.id,
                    apolloPersonId: ranked.id,
                    name: ranked.name,
                    title: ranked.title,
                    email: ranked.email || null,
                    linkedinUrl: ranked.linkedinUrl || null,
                    isPrimary: true,
                    selectionRationale: 'Highest ranking contact for decision-making',
                  },
                });

                // Update prospect with primary contact
                await prisma.prospect.update({
                  where: { id: prospect.id },
                  data: { primaryContactId: contactRecord.id },
                });
              }
            }
          }

          // Calculate fit score
          const fitScore = calculateFitScore(research.qualificationScore);

          // Update prospect in database
          await prisma.prospect.update({
            where: { id: prospect.id },
            data: {
              apolloOrgId: apolloOrg?.id,
              apolloData: apolloOrg as any,
              researchData: research as any,
              qualificationScore: research.qualificationScore as any,
              fitScore,
              isQualified: fitScore >= 60 && !research.isDisqualified,
              disqualificationReason: research.disqualificationReason,
              recommendedSalesAngle: research.recommendedSalesAngle,
              personalizationHooks: research.personalizationHooks,
              researchedAt: new Date(),
            },
          });

          // Send progress with fit score
          await writer.write(
            encoder.encode(`data: ${JSON.stringify({
              type: 'progress',
              data: {
                current: i + 1,
                total: prospects.length,
                currentProspect: prospect.name,
                status: 'Complete',
                fitScore,
              },
            })}\n\n`)
          );

        } catch (error: any) {
          console.error(`Error researching ${prospect.name}:`, error);
          
          // Send error but continue
          await writer.write(
            encoder.encode(`data: ${JSON.stringify({
              type: 'progress',
              data: {
                current: i + 1,
                total: prospects.length,
                currentProspect: prospect.name,
                status: `Error: ${error.message}`,
              },
            })}\n\n`)
          );
        }
      }

      // Get all enriched prospects
      const enrichedProspects = await prisma.prospect.findMany({
        where: { intelPackageId: packageId },
        include: {
          contacts: {
            where: { isPrimary: true },
          },
        },
      });

      // Send completion event
      await writer.write(
        encoder.encode(`data: ${JSON.stringify({
          type: 'complete',
          prospects: enrichedProspects.map(p => ({
            ...p,
            primaryContact: p.contacts[0] || null,
            alternateContacts: [],
          })),
        })}\n\n`)
      );

    } catch (error: any) {
      console.error('Research stream error:', error);
      await writer.write(
        encoder.encode(`data: ${JSON.stringify({ 
          type: 'error', 
          message: error.message 
        })}\n\n`)
      );
    } finally {
      await writer.close();
    }
  })();

  return new Response(stream.readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
