import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://rift-board-myanmar.vercel.app/"),
  title: {
    default: "RiftBoard Myanmar",
    template: "%s | RiftBoard Myanmar",
  },
  description:
    "RiftBoard Myanmar — a community League of Legends LP leaderboard and champion mains tracker.",
  applicationName: "RiftBoard Myanmar",
  openGraph: {
    type: "website",
    url: "https://rift-board-myanmar.vercel.app/",
    title: "RiftBoard Myanmar",
    description:
      "Community League of Legends LP leaderboard and champion mains tracker.",
    siteName: "RiftBoard Myanmar",
  },
  twitter: {
    card: "summary_large_image",
    title: "RiftBoard Myanmar",
    description:
      "Community League of Legends LP leaderboard and champion mains tracker.",
  },
};

export const viewport: Viewport = {
  themeColor: "#09090b",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body
        className={[
          geistSans.variable,
          geistMono.variable,
          "min-h-screen antialiased",
          "bg-zinc-950 text-zinc-100",
        ].join(" ")}
      >
        {/* Background */}
        <div className="fixed inset-0 -z-10">
          <div className="absolute inset-0 bg-gradient-to-b from-zinc-950 via-zinc-950 to-black" />
          <div className="absolute inset-0 opacity-[0.08] [background-image:linear-gradient(to_right,rgba(255,255,255,.12)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,.12)_1px,transparent_1px)] [background-size:48px_48px]" />
          <div className="absolute -top-40 left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-white/5 blur-3xl" />
        </div>

        {/* App frame */}
        <div className="mx-auto w-full">
          {children}
          <footer className="px-4 sm:px-6 py-10 text-center text-xs text-zinc-500">
            Not affiliated with Riot Games. League of Legends is a trademark of Riot Games, Inc.
          </footer>
        </div>
      </body>
    </html>
  );
}
