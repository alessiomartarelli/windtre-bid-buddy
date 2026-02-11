import { profiles, sessions } from "../schema";

export { sessions };
export const users = profiles;

export type User = typeof profiles.$inferSelect;
export type UpsertUser = {
  id: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  profileImageUrl?: string | null;
  fullName?: string | null;
};
