// components/DraftModal.tsx - Modal for drafting and sending outreach emails

'use client';

import { useState, useEffect } from 'react';
import { EnrichedProspect } from '@/lib/types';

interface Props {
  prospect: EnrichedProspect;
  onClose: () => void;
}

export default function DraftModal({ prospect, onClose }: Props) {
  const [draft, setDraft] = useState<{ subject: string; body: string } | null>(null);
  const [isGenerating, setIsGenerating] = useState(true);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // Generate draft on mount
    const generateDraft = async () => {
      try {
        const response = await fetch(`/api/prospects/${prospect.id}/draft-email`);
        if (!response.ok) throw new Error('Failed to generate draft');
        
        const data = await response.json();
        setDraft(data);
        setSubject(data.subject);
        setBody(data.body);
      } catch (error) {
        console.error('Draft generation error:', error);
        alert('Failed to generate draft email');
      } finally {
        setIsGenerating(false);
      }
    };

    generateDraft();
  }, [prospect.id]);

  const handleCopy = () => {
    const fullEmail = `Subject: ${subject}\n\n${body}`;
    navigator.clipboard.writeText(fullEmail);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="p-6 border-b sticky top-0 bg-white">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold">
              Draft Email to {prospect.primaryContact?.name}
            </h2>
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-gray-700 text-2xl"
            >
              ×
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          {isGenerating ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
              <p className="text-gray-600">Generating personalized email...</p>
            </div>
          ) : (
            <>
              {/* Email Fields */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  To:
                </label>
                <input
                  type="text"
                  value={prospect.primaryContact?.email || 'No email found'}
                  disabled
                  className="w-full px-3 py-2 border rounded bg-gray-50 text-gray-600"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Subject:
                </label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Body:
                </label>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={12}
                  className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                />
              </div>

              {/* Personalization Info */}
              <div className="p-4 bg-blue-50 rounded">
                <div className="text-sm font-semibold mb-2">Personalization hooks used:</div>
                <ul className="text-xs space-y-1">
                  {prospect.personalizationHooks.map((hook, i) => (
                    <li key={i} className="text-gray-700">• {hook}</li>
                  ))}
                </ul>
              </div>

              {/* Actions */}
              <div className="flex gap-3">
                <button
                  onClick={handleCopy}
                  className="flex-1 bg-blue-600 text-white py-3 px-6 rounded-lg font-semibold
                    hover:bg-blue-700 transition"
                >
                  {copied ? '✓ Copied!' : 'Copy to Clipboard'}
                </button>
                <button
                  onClick={onClose}
                  className="px-6 py-3 border border-gray-300 rounded-lg font-semibold
                    hover:bg-gray-50 transition"
                >
                  Close
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
