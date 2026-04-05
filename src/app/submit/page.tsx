import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function SubmitPage() {
  redirect("/discord/linked-roles");
}
