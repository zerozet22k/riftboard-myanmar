import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Submit",
  robots: {
    index: false,
    follow: false,
  },
};

export default function SubmitPage() {
  redirect("/discord/linked-roles");
}
