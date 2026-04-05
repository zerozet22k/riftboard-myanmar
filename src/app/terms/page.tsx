import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "Terms of Service for the Riftboard Myanmar website and Discord bot.",
};

const sections = [
  {
    title: "Server-Only Service",
    body: [
      "Riftboard and the Riftboard Discord bot are provided for the Riftboard Myanmar community and its related Discord server.",
      "Access to community features, tournament tools, and bot features may be limited, changed, or removed by the administrators at any time.",
    ],
  },
  {
    title: "Community Use",
    body: [
      "You agree to use Riftboard in good faith and to follow community rules, event rules, and organizer instructions.",
      "Harassment, cheating, impersonation, spam, abuse of tournament tools, or attempts to disrupt events may result in removal from tournaments, Discord features, or the wider community service.",
    ],
  },
  {
    title: "Tournament Rules",
    body: [
      "Tournament participants must provide accurate player and team information.",
      "Organizers may verify check-in, lock seeds, issue match instructions, and make rulings for no-shows, disputes, remakes, or other event exceptions.",
      "Tournament participation is also subject to Riot Games policies and any event-specific rules published on Riftboard.",
    ],
  },
  {
    title: "Discord Bot",
    body: [
      "The Riftboard Discord bot is intended to support community operations such as tournament notifications, player coordination, and organizer workflows inside approved community spaces.",
      "Bot features may be unavailable, modified, or discontinued without notice.",
    ],
  },
  {
    title: "Service Availability",
    body: [
      "Riftboard is provided on an as-is and as-available basis.",
      "We do not guarantee uninterrupted service, successful tournament participation, message delivery, or error-free operation.",
    ],
  },
  {
    title: "Changes",
    body: [
      "These terms may be updated as the community, website, or Discord bot evolves.",
      "Continued use of the service after changes are published means you accept the updated terms.",
    ],
  },
] as const;

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto w-full max-w-[980px] space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <header className="rounded-[30px] bg-zinc-900/30 p-6 ring-1 ring-white/5 sm:p-8">
          <Link href="/" className="text-sm text-zinc-400 transition hover:text-zinc-200">
            Back to Riftboard
          </Link>
          <div className="mt-4">
            <div className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">Legal</div>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-50">Terms of Service</h1>
            <p className="mt-3 max-w-3xl text-sm text-zinc-400">
              These terms apply to the Riftboard Myanmar website, tournament tools, and the
              Riftboard Discord bot used for the community server.
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
