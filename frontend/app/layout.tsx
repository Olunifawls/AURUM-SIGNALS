import type { Metadata } from 'next';
import './globals.css';
import Nav from '../components/Nav';
import Footer from '../components/Footer';

export const metadata: Metadata = {
  title: 'AURUM SIGNALS',
  description:
    'Personal gold (XAU/USD) analysis & signal platform. Analysis tool, not financial advice.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-neutral-950 text-neutral-100 antialiased">
        <div className="flex min-h-screen flex-col">
          <Nav />
          <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">{children}</main>
          <Footer />
        </div>
      </body>
    </html>
  );
}
