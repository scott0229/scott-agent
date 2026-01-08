import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { GeometricBackground } from "@/components/GeometricBackground";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Scott Agent",
  description: "Project Management",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${inter.className} antialiased relative`}
      >
        <GeometricBackground />
        {children}
      </body>
    </html>
  );
}

