import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Caveat, Architects_Daughter, Klee_One, Kalam } from "next/font/google";
import { AppShell } from "@/components/app-shell";
import { ClientErrorReporter } from "@/components/client-error-reporter";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

const caveat = Caveat({ subsets: ["latin"], variable: "--font-caveat", display: "swap" });
const architectsDaughter = Architects_Daughter({ subsets: ["latin"], weight: "400", variable: "--font-architects-daughter", display: "swap" });
const kleeOne = Klee_One({ subsets: ["latin"], weight: ["400", "600"], variable: "--font-klee-one", display: "swap" });
// Kalam only ships 300 / 400 / 700 on Google Fonts (no 500/600). Use 700 for
// the bold marker-pen look that the sketch theme needs.
const kalam = Kalam({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-kalam", display: "swap" });

export const metadata: Metadata = {
  title: "relay",
  description: "AI-era cross-project task hub",
};

// Blocking script that resolves the theme before React hydrates, so the
// SSR'd `data-theme` attribute matches what the client paints. Without
// this, theme-provider's useEffect runs *after* hydration and any
// theme-dependent text (icon swap, title attribute, etc.) triggers
// React error #418 for users whose stored theme differs from the SSR
// default. Pattern from Next.js docs / next-themes.
const THEME_IDS = [
  "light",
  "dark",
  "sunset",
  "matrix",
  "ocean",
  "notebook",
  "blueprint",
  "washi",
  "sketch",
  "paper",
  "mist",
  "midnight",
  "solar",
  "nord",
  "sakura",
  "amber",
  "hc-dark",
  "hc-light",
] as const;

const themeInitScript = `
(function() {
  try {
    var allowed = ${JSON.stringify(THEME_IDS)};
    var stored = localStorage.getItem('relay.theme');
    var theme = stored && allowed.indexOf(stored) !== -1
      ? stored
      : (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    document.documentElement.dataset.theme = theme;
  } catch (e) {
    document.documentElement.dataset.theme = 'dark';
  }
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable} ${caveat.variable} ${architectsDaughter.variable} ${kleeOne.variable} ${kalam.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <ThemeProvider>
          <ClientErrorReporter />
          <AppShell>{children}</AppShell>
        </ThemeProvider>
      </body>
    </html>
  );
}
