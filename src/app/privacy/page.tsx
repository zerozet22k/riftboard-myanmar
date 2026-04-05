import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "Privacy Policy for the Riftboard Myanmar website and Discord bot.",
};

const sections = [
  {
    title: "What We Store",
    body: [
      "Riftboard may store the minimum information needed to run the website, tournaments, and community bot features.",
      "This can include Riot IDs, team registration details, check-in status, bracket and match records, organizer notes, Discord contact details you choose to provide, and Discord-related identifiers or server configuration when bot features are connected.",
    ],
  },
  {
    title: "How We Use It",
    body: [
      "We use this information to operate community tournaments, show public brackets or standings, coordinate matches, send Discord updates, and maintain service reliability.",
      "We may also use operational data to debug issues, prevent abuse, and improve the community experience.",
    ],
  },
  {
    title: "Public vs Private Information",
    body: [
      "Some tournament information is intentionally public inside the community experience, such as team names, bracket status, seeds, and match outcomes.",
      "Private or limited-access information, such as organizer-only notes, secret management links, and internal event records, is not intended for public display.",
    ],
  },
  {
    title: "Discord Data",
    body: [
      "If the Riftboard Discord bot is used, Riftboard may process Discord server identifiers, channel identifiers, role identifiers, user identifiers, and interaction payloads needed for community operations.",
      "Discord-related data is used only to support the Riftboard Myanmar community and its approved workflows.",
    ],
  },
  {
    title: "Sharing",
    body: [
      "Riftboard does not sell personal data.",
      "Information may be shared only as needed to operate the service, comply with platform rules, respond to abuse or security issues, or satisfy legal obligations.",
    ],
  },
  {
    title: "Retention and Removal",
    body: [
      "We keep data for as long as it is reasonably needed for community operations, tournament history, moderation, or reliability.",
      "Administrators may remove or archive data when it is no longer needed or when community policy requires it.",
    ],
  },
  {
    title: "Policy Updates",
    body: [
      "This policy may be updated over time as Riftboard and the Discord bot evolve.",
      "Continued use of the service after an update means you accept the revised policy.",
    ],
  },
] as const;

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto w-full max-w-[980px] space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <header className="rounded-[30px] bg-zinc-900/30 p-6 ring-1 ring-white/5 sm:p-8">
          <Link href="/" className="text-sm text-zinc-400 transition hover:text-zinc-200">
            Back to Riftboard
          </Link>
          <div className="mt-4">
            <div className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">Legal</div>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-50">Privacy Policy</h1>
            <p className="mt-3 max-w-3xl text-sm text-zinc-400">
              This policy explains what Riftboard may store and process for the website, tournament
              features, and the Riftboard Myanmar community bot.
            </p>
          </div>
        </header>

        <section className="space-y-4">
          {sections.map((section) => (
            <article
              key={section.title}
              className="rounded-[26px] bg-zinc-900/25 p-5 ring-1 ring-white/5 sm:p-6"
            >
              <h2 className="text-xl font-semibold text-zinc-50">{section.title}</h2>
              <div className="mt-3 space-y-3 text-sm leading-6 text-zinc-300">
                {section.body.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}
