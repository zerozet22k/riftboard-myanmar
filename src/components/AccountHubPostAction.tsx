"use client";

import { useFormStatus } from "react-dom";

type ActionVariant = "primary" | "secondary" | "quiet" | "danger";

type AccountHubPostActionProps = {
  action: string;
  fields?: Record<string, string>;
  label: string;
  pendingLabel?: string;
  confirmMessage?: string;
  variant?: ActionVariant;
};

const variantClass: Record<ActionVariant, string> = {
  primary:
    "bg-emerald-400 text-zinc-950 hover:bg-emerald-300 disabled:bg-emerald-400/50",
  secondary:
    "border border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10 disabled:text-zinc-500",
  quiet:
    "text-zinc-400 hover:bg-white/5 hover:text-zinc-100 disabled:text-zinc-600",
  danger:
    "border border-red-300/15 text-red-200 hover:border-red-300/25 hover:bg-red-500/10 disabled:text-red-300/40",
};

function SubmitButton({
  label,
  pendingLabel,
  variant,
}: {
  label: string;
  pendingLabel: string;
  variant: ActionVariant;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      aria-disabled={pending}
      className={[
        "inline-flex min-h-10 items-center justify-center rounded-xl px-3.5 py-2 text-sm font-medium transition disabled:cursor-wait",
        variantClass[variant],
      ].join(" ")}
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

export default function AccountHubPostAction({
  action,
  fields = {},
  label,
  pendingLabel = "Working…",
  confirmMessage,
  variant = "secondary",
}: AccountHubPostActionProps) {
  return (
    <form
      action={action}
      method="POST"
      onSubmit={(event) => {
        if (confirmMessage && !window.confirm(confirmMessage)) {
          event.preventDefault();
        }
      }}
    >
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <SubmitButton label={label} pendingLabel={pendingLabel} variant={variant} />
    </form>
  );
}
