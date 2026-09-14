import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Upstox Chartink Scanner",
  description: "Real-time NSE scanner using Upstox V3 candles.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
