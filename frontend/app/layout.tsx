import './globals.css';
import React from 'react';

export const metadata = {
  title: 'News Pulse - Topic-Clustered News Timeline',
  description: 'An interactive timeline visualizing clustered global news from BBC, NPR, and The Guardian.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body>
        {children}
      </body>
    </html>
  );
}
