import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { GeometricBackground } from "@/components/GeometricBackground";
import { Navbar } from "@/components/Navbar";
import { Toaster } from "@/components/ui/toaster";
import { YearFilterProvider } from "@/contexts/YearFilterContext";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Scott Agent",
  description: "專案管理系統",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-TW">
      <body
        className={`${inter.className} antialiased relative`}
      >
        <GeometricBackground />
        <YearFilterProvider>
          <Navbar />
          {children}
        </YearFilterProvider>
        <Toaster />
      </body>
    </html>
  );
}

