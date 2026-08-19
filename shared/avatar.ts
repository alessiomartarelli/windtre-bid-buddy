export const AVATAR_ALLOWED_MIME_TYPES = ["image/png", "image/jpeg"] as const;
export const AVATAR_MAX_BYTES = 1024 * 1024;

export function isAllowedAvatarMimeType(value: unknown): value is (typeof AVATAR_ALLOWED_MIME_TYPES)[number] {
  return typeof value === "string" && (AVATAR_ALLOWED_MIME_TYPES as readonly string[]).includes(value);
}