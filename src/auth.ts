import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

import {
  countAdmins,
  countUsers,
  createUserRecord,
  deleteUserRecord,
  getUserRecordByUsername,
  listUserRecords,
  updateUserPinHash,
  type UserRecord,
  type UserRole,
} from "./db/database";

/**
 * Authentication and role-based access control.
 *
 * PINs are never stored in plain text. A per-user salt plus scrypt makes a
 * stolen database file useless for recovering short numeric PINs. Sessions are
 * intentionally in-memory: closing the terminal always requires a fresh login.
 */

export interface Session {
  userId: number;
  username: string;
  role: UserRole;
}

export const USER_ROLES: UserRole[] = ["Admin", "Manager", "Cashier"];

export function isPinFormatValid(pin: string): boolean {
  return /^\d{4,6}$/.test(pin);
}

function hashPin(pin: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(pin, salt, 32).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPinHash(pin: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  try {
    const expected = Buffer.from(hash, "hex");
    const actual = scryptSync(pin, salt, expected.length);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function pinIsUsedByAnotherUser(pin: string, exceptUserId?: number): boolean {
  return listUserRecords().some(
    (user) => user.id !== exceptUserId && verifyPinHash(pin, user.pin_hash)
  );
}

export function canManageStore(role: UserRole): boolean {
  return role === "Admin" || role === "Manager";
}

export function isAdmin(role: UserRole): boolean {
  return role === "Admin";
}

/** Verify a PIN. If a username is supplied, only that account is checked. */
export function authenticate(pin: string, username?: string): Session | null {
  if (!isPinFormatValid(pin)) return null;

  if (username?.trim()) {
    const user = getUserRecordByUsername(username);
    if (!user || !verifyPinHash(pin, user.pin_hash)) return null;
    return { userId: user.id, username: user.username, role: user.role };
  }

  for (const user of listUserRecords()) {
    if (verifyPinHash(pin, user.pin_hash)) {
      return { userId: user.id, username: user.username, role: user.role };
    }
  }
  return null;
}

export interface CreateAccountInput {
  username: string;
  pin: string;
  role: UserRole;
}

export function createAccount(input: CreateAccountInput): number {
  const username = input.username.trim();
  if (!/^[a-zA-Z0-9_.-]{2,24}$/.test(username)) {
    throw new Error("Username must be 2–24 characters (letters, numbers, . _ -).");
  }
  if (!isPinFormatValid(input.pin)) throw new Error("PIN must be 4–6 digits.");
  if (!USER_ROLES.includes(input.role)) throw new Error("Choose a valid role.");
  if (getUserRecordByUsername(username)) throw new Error(`Username "${username}" is already taken.`);
  if (pinIsUsedByAnotherUser(input.pin)) throw new Error("That PIN is already assigned to another user.");

  return createUserRecord(username, hashPin(input.pin), input.role);
}

export function resetPin(userId: number, pin: string): void {
  if (!isPinFormatValid(pin)) throw new Error("PIN must be 4–6 digits.");
  if (pinIsUsedByAnotherUser(pin, userId)) throw new Error("That PIN is already assigned to another user.");

  const user = listUserRecords().find((candidate) => candidate.id === userId);
  if (!user) throw new Error("User not found.");
  updateUserPinHash(userId, hashPin(pin));
}

export function deleteAccount(userId: number, currentUserId: number): void {
  const user = listUserRecords().find((candidate) => candidate.id === userId);
  if (!user) throw new Error("User not found.");
  if (user.id === currentUserId) throw new Error("You cannot delete your own signed-in account.");
  if (user.role === "Admin" && countAdmins() <= 1) throw new Error("The last Admin account cannot be deleted.");
  deleteUserRecord(userId);
}

export function listAccounts(): Array<Omit<UserRecord, "pin_hash">> {
  return listUserRecords().map(({ pin_hash: _pinHash, ...user }) => user);
}

export function hasAccounts(): boolean {
  return countUsers() > 0;
}

export function createInitialAdmin(username: string, pin: string): Session {
  if (hasAccounts()) throw new Error("An account already exists.");
  const userId = createAccount({ username, pin, role: "Admin" });
  return { userId, username: username.trim(), role: "Admin" };
}
