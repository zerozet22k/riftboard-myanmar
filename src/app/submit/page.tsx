import SubmitForm from "./SubmitForm";

export default function SubmitPage() {
  const codeRequired = !!process.env.SUBMIT_CODE?.trim();
  return (
    <main className="mx-auto max-w-xl p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Submit your Riot ID</h1>
      <SubmitForm codeRequired={codeRequired} />
    </main>
  );
}
