// components/UploadIntelPackage.tsx - Upload and parse intelligence packages

'use client';

import { useState } from 'react';

interface Props {
  onPackageUploaded: (packageId: string) => void;
}

export default function UploadIntelPackage({ onPackageUploaded }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [preview, setPreview] = useState<{
    prospectCount: number;
    salesAngles: string[];
  } | null>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;
    
    if (!selectedFile.name.endsWith('.md')) {
      alert('Please upload a markdown (.md) file');
      return;
    }

    setFile(selectedFile);
  };

  const handleUpload = async () => {
    if (!file) return;

    setIsUploading(true);

    try {
      const markdown = await file.text();

      // Parse intelligence package
      const parseResponse = await fetch('/api/intel/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markdown }),
      });

      if (!parseResponse.ok) {
        throw new Error('Failed to parse intelligence package');
      }

      const { packageId, prospectCount, salesAngles } = await parseResponse.json();

      setPreview({ prospectCount, salesAngles });
      onPackageUploaded(packageId);
    } catch (error) {
      console.error('Upload error:', error);
      alert('Failed to upload intelligence package. Check console for details.');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto bg-white rounded-lg shadow p-8">
      <h2 className="text-2xl font-bold mb-6">Upload Intelligence Package</h2>

      <div className="space-y-4">
        {/* File input */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Select Markdown File (.md)
          </label>
          <input
            type="file"
            accept=".md"
            onChange={handleFileSelect}
            className="block w-full text-sm text-gray-500
              file:mr-4 file:py-2 file:px-4
              file:rounded file:border-0
              file:text-sm file:font-semibold
              file:bg-blue-50 file:text-blue-700
              hover:file:bg-blue-100"
          />
        </div>

        {/* Upload button */}
        {file && !preview && (
          <button
            onClick={handleUpload}
            disabled={isUploading}
            className="w-full bg-blue-600 text-white py-3 px-6 rounded-lg font-semibold
              hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isUploading ? 'Parsing...' : 'Upload & Parse'}
          </button>
        )}

        {/* Preview */}
        {preview && (
          <div className="mt-6 p-6 bg-blue-50 rounded-lg">
            <h3 className="font-semibold text-lg mb-3">Package Parsed Successfully!</h3>
            <div className="space-y-2 text-sm">
              <p>
                <strong>Prospects found:</strong> {preview.prospectCount}
              </p>
              <p>
                <strong>Sales angles:</strong> {preview.salesAngles.join(', ')}
              </p>
            </div>
            <button
              onClick={() => {
                // Trigger research start
                window.location.reload();
              }}
              className="mt-4 w-full bg-green-600 text-white py-2 px-4 rounded-lg font-semibold
                hover:bg-green-700"
            >
              Start Research
            </button>
          </div>
        )}
      </div>

      {/* Instructions */}
      <div className="mt-8 p-4 bg-gray-50 rounded-lg text-sm text-gray-600">
        <h4 className="font-semibold mb-2">Expected Format:</h4>
        <ul className="list-disc list-inside space-y-1">
          <li>Markdown file with sections: ICP Profile, Sales Angles, Named Prospects</li>
          <li>Named companies/institutions mentioned throughout</li>
          <li>Qualification criteria and red flags</li>
        </ul>
      </div>
    </div>
  );
}
