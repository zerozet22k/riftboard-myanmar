import Link from "next/link";
import type { ReactNode } from "react";

export function LeaderboardSearchBar({
  action,
  value,
  defaultValue,
  placeholder = "Search name#tag...",
  helper,
  clearHref,
  onChange,
  children,
}: {
  action?: string;
  value?: string;
  defaultValue?: string;
  placeholder?: string;
  helper?: ReactNode;
  clearHref?: string;
  onChange?: (value: string) => void;
  children?: ReactNode;
}) {
  const controls = (
    <>
      <input
        name="q"
        value={value}
        defaultValue={defaultValue}
        onChange={onChange ? (event) => onChange(event.target.value) : undefined}
        placeholder={placeholder}
        className="min-w-0 flex-1 rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-zinc-600 sm:w-72 sm:flex-none"
      />
      {action ? (
        <button
          type="submit"
          className="rounded-xl border border-zinc-700 bg-zinc-950/35 px-3 py-2 text-sm font-medium text-zinc-100 transition hover:bg-white/5"
        >
          Search
        </button>
      ) : null}
      {clearHref ? (
        <Link
          href={clearHref}
          className="rounded-xl border border-zinc-800 bg-zinc-950/30 px-3 py-2 text-sm text-zinc-400 transition hover:bg-white/5"
        >
          Clear
        </Link>
      ) : null}
      {children}
    </>
  );

  const className =
    "flex flex-col gap-3 rounded-[20px] bg-zinc-900/22 p-3 ring-1 ring-white/5 xl:flex-row xl:items-center xl:justify-between";

  const content = (
    <>
      <div className="text-sm text-zinc-400">{helper}</div>
      <div className="flex w-full flex-wrap gap-2 xl:w-auto">{controls}</div>
    </>
  );

  return action ? (
    <form action={action} className={className}>
      {content}
    </form>
  ) : (
    <div className={className}>{content}</div>
  );
}

export function LeaderboardPager({
  start,
  end,
  total,
  page,
  pages,
  previousHref,
  nextHref,
  onPrevious,
  onNext,
}: {
  start: number;
  end: number;
  total: number;
  page: number;
  pages: number;
  previousHref?: string | null;
  nextHref?: string | null;
  onPrevious?: () => void;
  onNext?: () => void;
}) {
  const previousDisabled = page === 1;
  const nextDisabled = page === pages;
  const buttonClass =
    "rounded-lg border border-zinc-700 bg-zinc-950/35 px-3 py-2 text-zinc-100 transition hover:bg-white/5 disabled:border-zinc-800 disabled:bg-zinc-950/20 disabled:text-zinc-600 disabled:hover:bg-zinc-950/20";
  const disabledClass = "rounded-lg border border-zinc-800 bg-zinc-950/20 px-3 py-2 text-zinc-600";

  return (
    <nav className="flex flex-col gap-3 rounded-[20px] bg-zinc-900/22 p-3 text-sm text-zinc-400 ring-1 ring-white/5 sm:flex-row sm:items-center sm:justify-between">
      <div>
        Showing <span className="text-zinc-100">{start}</span>
        {" - "}
        <span className="text-zinc-100">{end}</span>
        {" of "}
        <span className="text-zinc-100">{total}</span>
      </div>

      <div className="flex items-center gap-2">
        {previousHref && !previousDisabled ? (
          <Link href={previousHref} className={buttonClass}>
            Previous
          </Link>
        ) : onPrevious ? (
          <button type="button" className={buttonClass} onClick={onPrevious} disabled={previousDisabled}>
            Previous
          </button>
        ) : (
          <span className={disabledClass}>Previous</span>
        )}

        <span className="px-2 text-xs text-zinc-500">
          Page <span className="text-zinc-200">{page}</span> / {pages}
        </span>

        {nextHref && !nextDisabled ? (
          <Link href={nextHref} className={buttonClass}>
            Next
          </Link>
        ) : onNext ? (
          <button type="button" className={buttonClass} onClick={onNext} disabled={nextDisabled}>
            Next
          </button>
        ) : (
          <span className={disabledClass}>Next</span>
        )}
      </div>
    </nav>
  );
}
