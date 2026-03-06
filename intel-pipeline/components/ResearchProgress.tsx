// components/ResearchProgress.tsx - Show streaming research progress

'use client';

import { useEffect, useState } from 'react';
import { EnrichedProspect } from '@/lib/types';

interface Props {
  packageId: string;
  onComplete: (prospects: EnrichedProspect[]) => void;
}

interface ProgressUpdate {
  current: number;
  total: number;
  currentProspect: string;
  status: string;
  fitScore?: number;
}

export default function ResearchProgress({ packageId, onComplete }: Props) {
  const [progress, setProgress] = useState<ProgressUpdate>({
    current: 0,
    total: 0,
    currentProspect: '',
    status: 'Initializing...',
  });

  useEffect(() => {
    const eventSource = new EventSource(`/api/intel/${packageId}/research-stream`);

    eventSource.onmessage = (e) => {
      const update = JSON.parse(e.data);
      
      if (update.type === 'progress') {
        setProgress(update.data);
      } else if (update.type === 'complete') {
        eventSource.close();
        onComplete(update.prospects);
      }
    };

    eventSource.onerror = (error) => {
      console.error('EventSource error:', error);
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }, [packageId, onComplete]);

  const percentage = progress.total > 0 
    ? Math.round((progress.current / progress.total) * 100)
    : 0;

  return (
    <div className="max-w-2xl mx-auto bg-white rounded-lg shadow p-8">
      <h2 className="text-2xl font-bold mb-6">Research in Progress</h2>

      <div className="space-y-6">
        {/* Progress bar */}
        <div>
          <div className="flex justify-between text-sm text-gray-600 mb-2">
            <span>
              {progress.current} / {progress.total} prospects
            </span>
            <span>{percentage}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-4 overflow-hidden">
            <div
              className="bg-blue-600 h-full transition-all duration-300"
              style={{ width: `${percentage}%` }}
            />
          </div>
        </div>

        {/* Current prospect */}
        {progress.currentProspect && (
          <div className="p-4 bg-blue-50 rounded-lg">
            <div className="font-semibold text-lg mb-2">
              Currently researching: {progress.currentProspect}
            </div>
            <div className="text-sm text-gray-600">
              {progress.status}
            </div>
            {progress.fitScore !== undefined && (
              <div className="mt-2 text-sm">
                <span className="font-medium">Fit Score: </span>
                <span className={`
                  ${progress.fitScore >= 70 ? 'text-green-600' : ''}
                  ${progress.fitScore >= 50 && progress.fitScore < 70 ? 'text-yellow-600' : ''}
                  ${progress.fitScore < 50 ? 'text-red-600' : ''}
                `}>
                  {progress.fitScore}%
                </span>
              </div>
            )}
          </div>
        )}

        {/* Status log */}
        <div className="bg-gray-50 rounded-lg p-4 h-64 overflow-y-auto">
          <div className="font-mono text-xs space-y-1">
            <div className="text-gray-600">
              [00:00] Starting research pipeline...
            </div>
            <div className="text-gray-600">
              [00:01] Found {progress.total} prospects to research
            </div>
            {progress.current > 0 && (
              <div className="text-blue-600">
                [00:0{progress.current}] Researching {progress.currentProspect}...
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
