"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import HeaderPlayerSearch from "@/components/HeaderPlayerSearch";
import { SITE_LOGO_PATH } from "@/lib/seo";

type SiteHeaderProps = {
  discordUrl?: string;
  accessLabel?: string;
};

const NAV_ITEMS = [
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/tft", label: "TFT" },
  { href: "/tournaments", label: "Tournaments" },
];

function isActivePath(pathname: string, href: string) {
  if (href === "/leaderboard") return pathname === "/" || pathname === "/leaderboard";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function navLinkClass(active: boolean) {
  return [
    "rounded-full px-3 py-2 text-sm transition",
    active
      ? "bg-white/10 text-zinc-50 ring-1 ring-white/10"
      : "text-zinc-400 hover:bg-white/5 hover:text-zinc-100",
  ].join(" ");
}

export default function SiteHeader({
  discordUrl = "",
  accessLabel = "Link Account",
}: SiteHeaderProps) {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-white/8 bg-zinc-950/80 backdrop-blur-xl">
      <div className="mx-auto flex w-full flex-col gap-3 px-4 py-3 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
        <div className="flex items-center justify-between gap-4">
          <Link href="/" className="flex min-w-0 items-center gap-3">
            <Image
              src={SITE_LOGO_PATH}
              alt="RiftBoard Myanmar logo"
              width={44}
              height={44}
              className="h-11 w-11 rounded-2xl object-cover ring-1 ring-white/10"
              priority
            />
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-[0.28em] text-zinc-500">
                Myanmar Community
              </div>
              <div className="truncate text-lg font-semibold tracking-tight text-zinc-50">
                RiftBoard
              </div>
            </div>
          </Link>

          {discordUrl ? (
            <Link
              href={discordUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-sm font-medium text-emerald-200 transition hover:bg-emerald-400/20 lg:hidden"
            >
              Join Discord
            </Link>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center">
          <nav className="flex flex-wrap items-center gap-1">
            {NAV_ITEMS.map((item) => {
              const active = isActivePath(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={navLinkClass(active)}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <HeaderPlayerSearch />

          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/discord/linked-roles"
              className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-200 transition hover:bg-white/10"
            >
              {accessLabel}
            </Link>
            {discordUrl ? (
              <Link
                href={discordUrl}
                target="_blank"
                rel="noreferrer"
                className="hidden rounded-full bg-emerald-400 px-3 py-2 text-sm font-semibold text-black transition hover:bg-emerald-300 lg:inline-flex"
              >
                Join Discord
              </Link>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  );
}
