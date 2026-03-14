'use client';

import { useState, useCallback } from 'react';

interface ContactResult {
  id: string;
  name: string;
  title: string;
  company: string;
  companyDomain?: string;
  companySize?: number;
  industry?: string;
  location?: string;
  email?: string;
  emailStatus?: string;
  linkedinUrl?: string;
  twitterUrl?: string;
  photoUrl?: string;
}

interface QuerySummary {
  label: string;
  total: number;
}

function emailBadgeColor(status?: string) {
  if (!status) return 'bg-gray-100 text-gray-500';
  if (status === 'verified') return 'bg-emerald-50 text-emerald-700 border border-emerald-200';
  if (status === 'likely to engage') return 'bg-blue-50 text-blue-700 border border-blue-200';
  return 'bg-yellow-50 text-yellow-700 border border-yellow-200';
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      title="Copy email"
      className={`ml-2 inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-all
        ${copied
          ? 'bg-emerald-100 text-emerald-700'
          : 'bg-gray-100 text-gray-600 hover:bg-indigo-50 hover:text-indigo-700'
        }`}
    >
      {copied ? (
        <>
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          Copied
        </>
      ) : (
        <>
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
          Copy
        </>
      )}
    </button>
  );
}

function ContactCard({ contact }: { contact: ContactResult }) {
  const initials = contact.name
    .split(' ')
    .map(w => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 hover:shadow-md transition-shadow">
      <div className="flex items-start gap-4">
        {/* Avatar */}
        <div className="flex-shrink-0">
          {contact.photoUrl ? (
            <img
              src={contact.photoUrl}
              alt={contact.name}
              className="w-11 h-11 rounded-full object-cover"
            />
          ) : (
            <div className="w-11 h-11 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-semibold text-sm">
              {initials}
            </div>
          )}
        </div>

        {/* Details */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-gray-900 text-sm">{contact.name}</h3>
            {contact.linkedinUrl && (
              <a
                href={contact.linkedinUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:text-blue-700"
                title="LinkedIn"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z" />
                </svg>
              </a>
            )}
          </div>

          <p className="text-xs text-gray-500 mt-0.5">{contact.title}</p>

          <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-medium text-gray-700">{contact.company}</span>
            {contact.companySize && (
              <span className="text-xs text-gray-400">· {contact.companySize.toLocaleString()} emp.</span>
            )}
            {contact.industry && (
              <span className="text-xs text-gray-400">· {contact.industry}</span>
            )}
          </div>

          {contact.location && (
            <p className="text-xs text-gray-400 mt-0.5">{contact.location}</p>
          )}
        </div>
      </div>

      {/* Email row */}
      <div className="mt-4 pt-3.5 border-t border-gray-50">
        {contact.email ? (
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${emailBadgeColor(contact.emailStatus)}`}>
              {contact.emailStatus || 'email'}
            </span>
            <span className="text-sm font-mono text-gray-800 flex-1 truncate">{contact.email}</span>
            <CopyButton text={contact.email} />
          </div>
        ) : (
          <span className="text-xs text-gray-400 italic">Email not available</span>
        )}
      </div>
    </div>
  );
}

export default function FinalFold() {
  const [markdown, setMarkdown] = useState('');
  const [loading, setLoading] = useState(false);
  const [contacts, setContacts] = useState<ContactResult[]>([]);
  const [queries, setQueries] = useState<QuerySummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [filter, setFilter] = useState<'all' | 'email'>('all');

  const handleSearch = useCallback(async () => {
    if (!markdown.trim()) return;

    setLoading(true);
    setError(null);
    setContacts([]);
    setQueries([]);
    setHasSearched(false);

    try {
      const res = await fetch('/api/finalfold', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markdown }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Something went wrong');
        return;
      }

      setContacts(data.contacts);
      setQueries(data.queriesRun);
      setHasSearched(true);
    } catch (err: any) {
      setError(err.message || 'Network error');
    } finally {
      setLoading(false);
    }
  }, [markdown]);

  const filtered = filter === 'email'
    ? contacts.filter(c => c.email)
    : contacts;

  const withEmail = contacts.filter(c => c.email).length;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center gap-3">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <div>
            <h1 className="text-lg font-bold text-gray-900 leading-none">FinalFold</h1>
            <p className="text-xs text-gray-500 mt-0.5">Intel Pack → Contacts → Click to Copy</p>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        {/* Input section */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <label className="text-sm font-semibold text-gray-700">Paste Intel Pack</label>
            {markdown && (
              <button
                onClick={() => { setMarkdown(''); setContacts([]); setHasSearched(false); }}
                className="text-xs text-gray-400 hover:text-gray-600"
              >
                Clear
              </button>
            )}
          </div>
          <textarea
            value={markdown}
            onChange={e => setMarkdown(e.target.value)}
            placeholder="Paste your intelligence package markdown here — must include an ## Apollo Search Queries section..."
            rows={10}
            className="w-full px-5 py-4 text-sm font-mono text-gray-700 placeholder-gray-400 resize-none outline-none"
          />
          <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between">
            <span className="text-xs text-gray-400">
              {markdown.length > 0 ? `${markdown.length.toLocaleString()} chars` : 'No content'}
            </span>
            <button
              onClick={handleSearch}
              disabled={loading || !markdown.trim()}
              className="inline-flex items-center gap-2 px-5 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg
                hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  Searching Apollo...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  Find Contacts
                </>
              )}
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
            <strong>Error:</strong> {error}
          </div>
        )}

        {/* Loading state */}
        {loading && (
          <div className="text-center py-12">
            <div className="inline-flex flex-col items-center gap-3">
              <svg className="w-8 h-8 animate-spin text-indigo-500" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              <p className="text-sm text-gray-500">Running Apollo searches…</p>
            </div>
          </div>
        )}

        {/* Results */}
        {hasSearched && !loading && (
          <div className="space-y-5">
            {/* Summary bar */}
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-sm font-semibold text-gray-700">
                  {contacts.length} contacts found
                </span>
                <span className="text-sm text-gray-400">·</span>
                <span className="text-sm text-gray-500">
                  {withEmail} with email
                </span>

                {/* Query labels */}
                {queries.map(q => (
                  <span key={q.label} className="inline-flex items-center gap-1 text-xs bg-gray-100 text-gray-600 px-2.5 py-1 rounded-full">
                    {q.label}
                    <span className="font-semibold text-gray-700">{q.total.toLocaleString()}</span>
                  </span>
                ))}
              </div>

              {/* Filter */}
              <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
                <button
                  onClick={() => setFilter('all')}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors
                    ${filter === 'all' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                >
                  All ({contacts.length})
                </button>
                <button
                  onClick={() => setFilter('email')}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors
                    ${filter === 'email' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                >
                  Has Email ({withEmail})
                </button>
              </div>
            </div>

            {/* Contact grid */}
            {filtered.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {filtered.map(contact => (
                  <ContactCard key={contact.id} contact={contact} />
                ))}
              </div>
            ) : (
              <div className="text-center py-16 text-gray-400">
                <svg className="w-12 h-12 mx-auto mb-3 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <p className="text-sm">No contacts with email found</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
