import { canonicalPlayerPath } from "@/lib/playerIdentity";

export const PROFILE_COMMENT_MAX_LENGTH = 500;

type SerializableDate = Date | string | null | undefined;

export type ProfileCommentView = {
  id: string;
  authorDiscordUsername: string;
  authorGameName: string;
  authorTagLine: string;
  authorProfilePath: string;
  body: string;
  createdAt: string | null;
};

export type StoredProfileComment = {
  _id: unknown;
  authorDiscordUsername: string;
  authorGameName: string;
  authorTagLine: string;
  body: string;
  createdAt?: SerializableDate;
};

function toIsoString(value: SerializableDate) {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function serializeProfileComment(comment: StoredProfileComment): ProfileCommentView {
  return {
    id: String(comment._id),
    authorDiscordUsername: String(comment.authorDiscordUsername ?? ""),
    authorGameName: String(comment.authorGameName ?? ""),
    authorTagLine: String(comment.authorTagLine ?? ""),
    authorProfilePath: canonicalPlayerPath(comment.authorGameName, comment.authorTagLine),
    body: String(comment.body ?? ""),
    createdAt: toIsoString(comment.createdAt),
  };
}
