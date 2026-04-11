import type { Metadata } from "next";
import AdminAddPlayerForm from "@/components/AdminAddPlayerForm";
import AdminLoginForm from "@/components/AdminLoginForm";
import { getOptionalAdminSession } from "@/lib/adminSession";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Admin",
  robots: {
    index: false,
    follow: false,
  },
};

export default async function AdminPage() {
  const session = await getOptionalAdminSession();
  return session ? <AdminAddPlayerForm /> : <AdminLoginForm />;
}
