// app/page.tsx - Main application page

'use client';

import { useState } from 'react';
import ProspectCard from '@/components/ProspectCard';
import UploadIntelPackage from '@/components/UploadIntelPackage';
import ResearchProgress from '@/components/ResearchProgress';
import { EnrichedProspect } from '@/lib/types';

export default function Home() {
  const [currentPackageId, setCurrentPackageId] = useState<string | null>(null);
  const [isResearching, setIsResearching] = useState(false);
  const [prospects, setProspects] = useState<EnrichedProspect[]>([]);
  const [filter, setFilter] = useState<'all' | 'qualified' | 'disqualified'>('all');

  const handlePackageUploaded = (packageId: string) => {
    setCurrentPackageId(packageId);
  };

  const handleResearchComplete = (researchedProspects: EnrichedProspect[]) => {
    setProspects(researchedProspects);
    setIsResearching(false);
  };

  const filteredProspects = prospects.filter(p => {
    if (filter === 'qualified') return p.isQualified;
    if (filter === 'disqualified') return !p.isQualified;
    return true;
  });

  const sortedProspects = [...filteredProspects].sort((a, b) => {
    // Sort by urgency first, then fit score
    const urgencyOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    const urgencyDiff = urgencyOrder[a.urgencyLevel] - urgencyOrder[b.urgencyLevel];
    if (urgencyDiff !== 0) return urgencyDiff;
    return b.fitScore - a.fitScore;
  });

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">
            Intelligence Package → Prospect Pipeline
          </h1>
          <p className="mt-2 text-gray-600">
            Transform market intelligence into researched, qualified prospects with personalized outreach
          </p>
        </div>

        {/* Upload Section */}
        {!currentPackageId && (
          <UploadIntelPackage onPackageUploaded={handlePackageUploaded} />
        )}

        {/* Research Progress */}
        {currentPackageId && isResearching && (
          <ResearchProgress
            packageId={currentPackageId}
            onComplete={handleResearchComplete}
          />
        )}

        {/* Prospects Display */}
        {prospects.length > 0 && !isResearching && (
          <div>
            {/* Filters */}
            <div className="mb-6 flex items-center gap-4">
              <div className="flex gap-2">
                <button
                  onClick={() => setFilter('all')}
                  className={`px-4 py-2 rounded ${
                    filter === 'all'
                      ? 'bg-blue-600 text-white'
                      : 'bg-white text-gray-700 border'
                  }`}
                >
                  All ({prospects.length})
                </button>
                <button
                  onClick={() => setFilter('qualified')}
                  className={`px-4 py-2 rounded ${
                    filter === 'qualified'
                      ? 'bg-blue-600 text-white'
                      : 'bg-white text-gray-700 border'
                  }`}
                >
                  Qualified ({prospects.filter(p => p.isQualified).length})
                </button>
                <button
                  onClick={() => setFilter('disqualified')}
                  className={`px-4 py-2 rounded ${
                    filter === 'disqualified'
                      ? 'bg-blue-600 text-white'
                      : 'bg-white text-gray-700 border'
                  }`}
                >
                  Disqualified ({prospects.filter(p => !p.isQualified).length})
                </button>
              </div>
            </div>

            {/* Prospect Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {sortedProspects.map(prospect => (
                <ProspectCard
                  key={prospect.id}
                  prospect={prospect}
                  onReachOut={(id) => console.log('Reach out to:', id)}
                  onViewResearch={(id) => console.log('View research:', id)}
                  onDisqualify={(id, reason) => console.log('Disqualify:', id, reason)}
                />
              ))}
            </div>

            {sortedProspects.length === 0 && (
              <div className="text-center py-12 text-gray-500">
                No prospects match the current filter
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
