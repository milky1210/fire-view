import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  metadataBase: new URL('https://milky1210.github.io/fire-view/'),
  title: 'FIRE / VIEW — Pixel Fire Simulation',
  description: 'カールノイズで揺らぐ、格子ベースのインタラクティブな焚き火。',
  openGraph: {
    title: 'FIRE / VIEW — Pixel Fire Simulation',
    description: 'カールノイズで揺らぐ、格子ベースのインタラクティブな焚き火。',
    images: [{ url: 'og.png', width: 1536, height: 1024, alt: 'FIRE / VIEW のピクセルアート焚き火' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'FIRE / VIEW — Pixel Fire Simulation',
    description: 'カールノイズで揺らぐ、格子ベースのインタラクティブな焚き火。',
    images: ['og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja" className="dark">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body>
    </html>
  );
}
