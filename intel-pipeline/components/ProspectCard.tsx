// components/ProspectCard.tsx - Display individual prospect with actions

'use client';

import { useState } from 'react';
import { EnrichedProspect } from '@/lib/types';
import DraftModal from './DraftModal';

interface Props {
  prospect: EnrichedProspect;
  onReachOut: (prospectId: string) => void;
  onViewResearch: (prospectId: string) => void;
  onDisqualify: (prospectId: string, reason: string) => void;
}

export default function ProspectCard({
  prospect,
  onReachOut,
  onViewResearch,
  onDisqualify,
}: Props) {
  const [showDraft, setShowDraft] = useState(false);

  const urgencyColors = {
    CRITICAL: 'bg-red-100 text-red-800 border-red-300',
    HIGH: 'bg-orange-100 text-orange-800 border-orange-300',
    MEDIUM: 'bg-yellow-100 text-yellow-800 border-yellow-300',
    LOW: 'bg-green-100 text-green-800 border-green-300',
  };

  const urgencyIcons = {
    CRITICAL: '🔴',
    HIGH: '🟠',
    MEDIUM: '🟡',
    LOW: '🟢',
  };

  return (
    <>
      <div className="bg-white rounded-lg shadow-md p-6 border-l-4 border-blue-500">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <span className={`text-xs px-2 py-1 rounded border ${urgencyColors[prospect.urgencyLevel]}`}>
                {urgencyIcons[prospect.urgencyLevel]} {prospect.urgencyLevel}
              </span>
            </div>
            <h3 className="text-xl font-bold text-gray-900">{prospect.name}</h3>
            <p className="text-sm text-gray-600">
              {prospect.location} • {prospect.employeeCount} employees • {prospect.industry}
            </p>
          </div>
        </div>

        {/* Contact */}
        {prospect.primaryContact && (
          <div className="mb-4 p-3 bg-gray-50 rounded">
            <div className="text-sm">
              <div className="font-medium">👤 {prospect.primaryContact.name}</div>
              <div className="text-gray-600">{prospect.primaryContact.title}</div>
              {prospect.primaryContact.email && (
                <div className="text-blue-600">📧 {prospect.primaryContact.email}</div>
              )}
            </div>
          </div>
        )}

        {/* Fit Score */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-medium">Fit Score</span>
            <span className={`text-sm font-bold ${
              prospect.fitScore >= 70 ? 'text-green-600' :
              prospect.fitScore >= 50 ? 'text-yellow-600' :
              'text-red-600'
            }`}>
              {prospect.fitScore}%
            </span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className={`h-2 rounded-full ${
                prospect.fitScore >= 70 ? 'bg-green-500' :
                prospect.fitScore >= 50 ? 'bg-yellow-500' :
                'bg-red-500'
              }`}
              style={{ width: `${prospect.fitScore}%` }}
            />
          </div>
        </div>

        {/* Qualification Checklist */}
        <div className="mb-4 space-y-1">
          {Object.entries(prospect.qualificationScore).map(([key, value]) => (
            <div key={key} className="flex items-start gap-2 text-sm">
              <span className="text-lg">
                {value === true ? '✓' : value === false ? '✗' : '⚠'}
              </span>
              <span className={
                value === true ? 'text-green-700' :
                value === false ? 'text-red-700' :
                'text-gray-600'
              }>
                {key.replace(/([A-Z])/g, ' $1').trim()}
              </span>
            </div>
          ))}
        </div>

        {/* Sales Angle */}
        <div className="mb-4 p-3 bg-blue-50 rounded">
          <div className="font-semibold text-sm mb-1">
            🎯 {prospect.recommendedSalesAngle}
          </div>
          <div className="text-xs text-gray-600 italic">
            "{prospect.personalizationHooks.slice(0, 2).join(' • ')}"
          </div>
        </div>

        {/* Buying Signals */}
        {prospect.buyingSignals.length > 0 && (
          <div className="mb-4">
            <div className="font-semibold text-sm mb-2">🔍 Buying Signals ({prospect.buyingSignals.length})</div>
            <ul className="space-y-1">
              {prospect.buyingSignals.slice(0, 3).map((signal, i) => (
                <li key={i} className="text-xs text-gray-700">
                  • {signal.signal}
                  {signal.date && <span className="text-gray-500"> ({signal.date})</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={() => setShowDraft(true)}
            className="flex-1 bg-blue-600 text-white py-2 px-4 rounded font-semibold
              hover:bg-blue-700 transition"
          >
            Reach Out
          </button>
          <button
            onClick={() => onViewResearch(prospect.id)}
            className="flex-1 bg-gray-200 text-gray-800 py-2 px-4 rounded font-semibold
              hover:bg-gray-300 transition"
          >
            View Research
          </button>
        </div>

        {!prospect.isQualified && prospect.disqualificationReason && (
          <div className="mt-3 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
            <strong>Disqualified:</strong> {prospect.disqualificationReason}
          </div>
        )}
      </div>

      {/* Draft Modal */}
      {showDraft && (
        <DraftModal
          prospect={prospect}
          onClose={() => setShowDraft(false)}
        />
      )}
    </>
  );
}
