import type { Metadata, Viewport } from "next";
import { Archivo, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const sans = Archivo({ subsets: ["latin"], variable: "--font-sans", axes: ["wdth"] });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "SARsight",
  description: "NISAR radar, translated into decisions. Surface dynamics for farmers, responders and everyone.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#050608" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var p=JSON.parse(localStorage.getItem("sarsight.profile.v1")||"{}");if(p.theme==="light")document.documentElement.setAttribute("data-theme","light");}catch(e){}`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
