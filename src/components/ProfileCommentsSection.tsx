"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { formatFullDateTime, formatMetaDateTime } from "@/lib/displayTime";
import {
  PROFILE_COMMENT_MAX_LENGTH,
  type ProfileCommentView,
} from "@/lib/profileComments";

type Viewer = {
  discordUsername: string | null;
  gameName: string;
  tagLine: string;
  isProfileOwner: boolean;
};

async function safeJson(res: Response) {
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) return null;

  try {
    return await res.json();
  } catch {
    return null;
  }
}

export default function ProfileCommentsSection({
  gameName,
  tagLine,
  profilePath,
  initialComments,
  viewer,
}: {
  gameName: string;
  tagLine: string;
  profilePath: string;
  initialComments: ProfileCommentView[];
  viewer: Viewer | null;
}) {
  const [comments, setComments] = useState(initialComments);
  const [body, setBody] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyCommentId, setBusyCommentId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const commentsApiPath = `/api/p/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}/comments`;
  const trimmedBody = body.trim();
  const canSubmit = !!viewer && !pending && trimmedBody.length > 0;

  function resetFeedback() {
    setMessage(null);
    setError(null);
  }

  function submitComment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!viewer || !trimmedBody || pending) return;

    resetFeedback();
    setBusyCommentId(null);

    startTransition(async () => {
      try {
        const res = await fetch(commentsApiPath, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: trimmedBody }),
        });

        const data = await safeJson(res);
        if (!res.ok || data?.ok === false) {
          setError(data?.error ?? `Could not post comment (${res.status})`);
          return;
        }

        if (data?.comment) {
          setComments((current) => [data.comment as ProfileCommentView, ...current]);
        }
        setBody("");
        setMessage("Comment posted.");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not post comment");
      }
    });
  }

  function deleteComment(commentId: string) {
    if (!viewer?.isProfileOwner || !commentId || pending) return;

    resetFeedback();
    setBusyCommentId(commentId);

    startTransition(async () => {
      try {
        const res = await fetch(`${commentsApiPath}?commentId=${encodeURIComponent(commentId)}`, {
          method: "DELETE",
        });

        const data = await safeJson(res);
        if (!res.ok || data?.ok === false) {
          setError(data?.error ?? `Could not remove comment (${res.status})`);
          return;
        }

        setComments((current) => current.filter((comment) => comment.id !== commentId));
        setMessage("Comment removed.");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not remove comment");
      } finally {
        setBusyCommentId(null);
      }
    });
  }

  return (
    <section className="rounded-[18px] bg-zinc-900/16 p-3 ring-1 ring-white/5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold tracking-tight text-zinc-50">Comments</div>
          {comments.length ? (
            <div className="mt-0.5 text-xs text-zinc-500">
              {comments.length} note{comments.length === 1 ? "" : "s"}
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-3 rounded-[14px] bg-zinc-950/30 p-3 ring-1 ring-white/5">
        {viewer ? (
          <form onSubmit={submitComment} className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
              <span className="text-zinc-200">
                {viewer.gameName}#{viewer.tagLine}
              </span>
              {viewer.isProfileOwner ? (
                <span>Owner controls enabled</span>
              ) : null}
            </div>

            <label className="block">
              <span className="sr-only">Write a comment</span>
              <textarea
                value={body}
                onChange={(event) => setBody(event.target.value)}
                rows={3}
                maxLength={PROFILE_COMMENT_MAX_LENGTH}
                placeholder="Leave a note..."
                className="w-full resize-y rounded-[12px] bg-zinc-900/70 px-3 py-2 text-sm text-zinc-100 outline-none ring-1 ring-white/8 placeholder:text-zinc-500 focus:ring-white/15"
                disabled={pending}
              />
            </label>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-zinc-500">
                {body.length}/{PROFILE_COMMENT_MAX_LENGTH}
              </div>
              <button
                type="submit"
                disabled={!canSubmit}
                className="rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-semibold text-black transition hover:bg-white disabled:opacity-60"
              >
                {pending && busyCommentId == null ? "Posting..." : "Post"}
              </button>
            </div>
          </form>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs text-zinc-500">Discord login required.</div>
            <form action="/api/discord/oauth/start" method="GET">
              <input type="hidden" name="returnTo" value={profilePath} />
              <button
                type="submit"
                className="inline-flex rounded-lg bg-emerald-500/90 px-3 py-1.5 text-xs font-semibold text-black transition hover:bg-emerald-400"
              >
                Connect
              </button>
            </form>
          </div>
        )}

        {message ? <div className="mt-3 text-sm text-emerald-300">{message}</div> : null}
        {error ? <div className="mt-3 text-sm text-red-300">{error}</div> : null}
      </div>

      <div className="mt-3 space-y-2">
        {comments.length ? (
          comments.map((comment) => {
            const timestampLabel = formatMetaDateTime(comment.createdAt);
            const fullTimestampLabel = formatFullDateTime(comment.createdAt);
            const deletingThisComment = pending && busyCommentId === comment.id;

            return (
              <article
                key={comment.id}
                className="rounded-[14px] bg-zinc-950/30 p-3 ring-1 ring-white/5"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <Link
                        href={comment.authorProfilePath}
                        className="font-semibold text-zinc-100 transition hover:text-white"
                      >
                        {comment.authorGameName}#{comment.authorTagLine}
                      </Link>
                      <span className="text-zinc-500">
                        {comment.authorDiscordUsername}
                      </span>
                    </div>
                    <div
                      className="mt-1 text-xs text-zinc-500"
                      title={fullTimestampLabel ?? undefined}
                    >
                      {timestampLabel ?? "Just now"}
                    </div>
                  </div>

                  {viewer?.isProfileOwner ? (
                    <button
                      type="button"
                      onClick={() => deleteComment(comment.id)}
                      disabled={pending}
                      className="rounded-lg border border-white/10 px-2.5 py-1 text-xs font-medium text-zinc-300 transition hover:bg-white/5 disabled:opacity-60"
                    >
                      {deletingThisComment ? "Removing..." : "Remove"}
                    </button>
                  ) : null}
                </div>

                <div className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-zinc-200">
                  {comment.body}
                </div>
              </article>
            );
          })
        ) : (
          <div className="rounded-[14px] bg-zinc-950/30 p-3 text-xs text-zinc-500 ring-1 ring-white/5">
            No notes yet.
          </div>
        )}
      </div>
    </section>
  );
}
