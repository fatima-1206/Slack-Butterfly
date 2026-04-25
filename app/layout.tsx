import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Slack Butterfly",
  description: "An intelligent Slack co-pilot for finding the right people to solve a problem.",
  icons: {
    icon: [
      { url: "/icons8-butterfly-pieces-32.png", type: "image/png", sizes: "32x32" },
      { url: "/icons8-butterfly-pieces-96.png", type: "image/png", sizes: "96x96" },
      { url: "/icons8-butterfly-pieces-512.png", type: "image/png", sizes: "512x512" },
    ],
    apple: [{ url: "/icons8-butterfly-pieces-96.png", sizes: "96x96", type: "image/png" }],
    shortcut: ["/icons8-butterfly-pieces-32.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head />
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
