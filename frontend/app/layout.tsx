import type { Metadata } from 'next';
import './globals.css';
import Nav from '../components/Nav';
import Footer from '../components/Footer';
import ModeBanner from '../components/ModeBanner';
import { ThemeProvider } from '../components/ThemeProvider';

export const metadata: Metadata = {
  title: 'AURUM SIGNALS',
  description:
    'Personal gold (XAU/USD) analysis & signal platform. Analysis tool, not financial advice.',
};

// Runs before paint: apply the saved theme (default dark) to <html> so there is no
// flash and hydration matches.
const themeScript = `(function(){try{var t=localStorage.getItem('aurum-theme');if(t!=='light'&&t!=='dark')t='dark';document.documentElement.classList.add(t);document.documentElement.style.colorScheme=t;}catch(e){document.documentElement.classList.add('dark');}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen bg-neutral-950 text-neutral-100 antialiased">
        <ThemeProvider>
          <div className="flex min-h-screen flex-col">
            <ModeBanner />
            <Nav />
            <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">{children}</main>
            <Footer />
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
