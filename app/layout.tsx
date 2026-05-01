import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Sonic AI — Intelligent Parametric Equalizer',
  description:
    'High-fidelity 10-band parametric EQ with on-device AI calibration, A/B preview, and full-fidelity profile export (EqualizerAPO, AutoEq, Wavelet, CamillaDSP).',
  applicationName: 'Sonic AI',
  icons: { icon: '/favicon.ico' },
  openGraph: {
    title: 'Sonic AI — Intelligent Parametric Equalizer',
    description: 'On-device AI calibration · 10-band PEQ · Universal export.',
    type: 'website',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#0a0a0b',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`} suppressHydrationWarning>
      <body suppressHydrationWarning className="font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
