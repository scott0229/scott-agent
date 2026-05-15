import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { GeometricBackground } from "@/components/GeometricBackground";
import { Navbar } from "@/components/Navbar";
import { Toaster } from "@/components/ui/toaster";
import { YearFilterProvider } from "@/contexts/YearFilterContext";
import { AdminSettingsProvider } from "@/contexts/AdminSettingsContext";
import { ThemeProvider } from "@/contexts/ThemeContext";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Scott Agent",
  description: "專案管理系統",
};

const themeBootstrap = `try{if(localStorage.getItem('theme')==='dark')document.documentElement.classList.add('dark')}catch(e){}`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-TW">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body
        className={`${inter.className} antialiased relative`}
      >
        <GeometricBackground />
        <ThemeProvider>
          <YearFilterProvider>
            <AdminSettingsProvider>
              <Navbar />
              {children}
            </AdminSettingsProvider>
          </YearFilterProvider>
        </ThemeProvider>
        <Toaster />
      </body>
    </html>
  );
}

