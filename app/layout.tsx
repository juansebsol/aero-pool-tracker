import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'Aerowatch · Aerodrome pool tracker', description: 'Follow Aerodrome pool creation and first liquidity on Base. Direct from the chain.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
