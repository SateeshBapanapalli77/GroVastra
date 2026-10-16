import type { Metadata } from 'next';
import { Playfair_Display, Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';
import { AppProviders } from '../components/providers/AppProviders';

const playfair = Playfair_Display({
  subsets: ['latin'],
  variable: '--font-serif',
  display: 'swap',
});

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'GroVastra | Handloom OS & Auto Campaigns',
  description: 'Automated high-touch WhatsApp messaging for boutique owners and handloom stores',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${playfair.variable} ${plusJakarta.variable}`}>
      <body className="min-h-screen bg-[#FAF8F5] text-[#271E1B] antialiased">
        <AppProviders>
          {children}
        </AppProviders>
      </body>
    </html>
  );
}
