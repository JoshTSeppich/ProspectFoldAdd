// app/layout.tsx - Root layout

import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Intel Prospect Pipeline',
  description: 'AI-powered prospecting: Intelligence packages → Researched prospects → Personalized outreach',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
