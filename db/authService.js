import { User } from "./models/User.js";
import { Session } from "./models/Session.js";
import { LoginFailure } from "./models/LoginFailure.js";
import { checkPasswordStrength, getDummyHash, hashPassword, PASSWORD_MAX_LENGTH, verifyPassword } from "./auth/password.js";

// A session ends after 12h without any request, and after 7 days no matter what.
export const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_IDLE_MS = 12 * 60 * 60 * 1000;
// lastSeenAt only needs to be roughly right for the idle check - writing it
// at most every 5 minutes keeps every API poll from also being a DB write.
const LAST_SEEN_RESOLUTION_MS = 5 * 60 * 1000;

// Brute-force throttling: 5 wrong passwords per username, or 30 per client
// IP, within 15 minutes locks further attempts until the oldest ages out.
const THROTTLE_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES_PER_USER = 5;
const MAX_FAILURES_PER_IP = 30;

export const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;

export function normalizeUsername(username) {
  return typeof username === "string" ? username.trim().toLowerCase() : "";
}

const userKey = (username) => `user:${username.slice(0, 64)}`;
const ipKey = (ip) => `ip:${(ip || "unknown").slice(0, 64)}`;

/**
 * How long until `key` has at most `limit` failures in the window (0 = not
 * locked). Counts the attempt in progress, which beginAttempt has already
 * recorded.
 */
async function lockedForMs(key, limit) {
  const recent = await LoginFailure.find({ key, createdAt: { $gte: new Date(Date.now() - THROTTLE_WINDOW_MS) } }, { createdAt: 1 })
    .sort({ createdAt: -1 })
    .limit(limit + 1)
    .lean();
  if (recent.length <= limit) return 0;
  return Math.max(1000, recent[limit].createdAt.getTime() + THROTTLE_WINDOW_MS - Date.now());
}

/**
 * Records this attempt as a failure BEFORE the password is checked (cleared
 * again on success), so a burst of parallel requests can't all get past the
 * limit before any of them has been counted. If already locked, the attempt
 * is un-recorded so hammering a locked account doesn't extend the lock.
 */
async function beginAttempt(limits) {
  const rows = await LoginFailure.insertMany(limits.map(([key]) => ({ key })));
  const waits = await Promise.all(limits.map(([key, limit]) => lockedForMs(key, limit)));
  const retryAfterMs = Math.max(0, ...waits);
  if (retryAfterMs > 0) await LoginFailure.deleteMany({ _id: { $in: rows.map((r) => r._id) } });
  return { retryAfterMs, rows };
}

/**
 * Username/password check with throttling. Unknown usernames are verified
 * against a dummy hash and throttled exactly like real ones, so neither the
 * response, its timing, nor a lockout reveals whether an account exists.
 *
 * @returns {Promise<
 *   | { ok: true, user: { id: string, username: string } }
 *   | { ok: false, reason: "invalid" }
 *   | { ok: false, reason: "locked", retryAfterMs: number }
 * >}
 */
export async function authenticate(rawUsername, password, { ip = "" } = {}) {
  const username = normalizeUsername(rawUsername);
  const { retryAfterMs, rows } = await beginAttempt([
    [userKey(username), MAX_FAILURES_PER_USER],
    [ipKey(ip), MAX_FAILURES_PER_IP],
  ]);
  if (retryAfterMs > 0) return { ok: false, reason: "locked", retryAfterMs };

  const user = USERNAME_RE.test(username) ? await User.findOne({ username }).select("+passwordHash") : null;
  const passwordOk =
    typeof password === "string" &&
    password.length <= PASSWORD_MAX_LENGTH &&
    (await verifyPassword(password, user?.passwordHash ?? (await getDummyHash())));
  if (!user || !passwordOk) return { ok: false, reason: "invalid" };

  await Promise.all([
    LoginFailure.deleteMany({ $or: [{ key: userKey(username) }, { _id: rows[1]._id }] }),
    User.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } }),
  ]);
  return { ok: true, user: { id: String(user._id), username: user.username } };
}

// ------------------------------------------------------------------ sessions

export async function createSession(userId, tokenHash, { ip = "", userAgent = "" } = {}) {
  const now = new Date();
  return Session.create({
    tokenHash,
    userId,
    createdAt: now,
    lastSeenAt: now,
    expiresAt: new Date(now.getTime() + SESSION_MAX_AGE_MS),
    ip: ip.slice(0, 64),
    userAgent: userAgent.slice(0, 256),
  });
}

/**
 * The user behind a session token hash, or null. Expired, idle, orphaned, or
 * pre-password-change sessions are deleted on sight.
 */
export async function findSessionUser(tokenHash) {
  const session = await Session.findOne({ tokenHash }).lean();
  if (!session) return null;

  const now = Date.now();
  const user =
    session.expiresAt.getTime() > now && session.lastSeenAt.getTime() + SESSION_IDLE_MS > now
      ? await User.findById(session.userId).lean()
      : null;
  if (!user || session.createdAt < user.passwordChangedAt) {
    await Session.deleteOne({ _id: session._id });
    return null;
  }

  if (now - session.lastSeenAt.getTime() > LAST_SEEN_RESOLUTION_MS) {
    await Session.updateOne({ _id: session._id }, { $set: { lastSeenAt: new Date(now) } });
  }
  return { id: String(user._id), username: user.username };
}

export async function deleteSession(tokenHash) {
  await Session.deleteOne({ tokenHash });
}

// ------------------------------------------------------------------ accounts

async function writePassword(user, password) {
  user.passwordHash = await hashPassword(password);
  user.passwordChangedAt = new Date();
  await user.save();
  // Every existing session for this account ends with the old password.
  await Session.deleteMany({ userId: user._id });
}

/**
 * Self-service change from the Account page. The current password is
 * re-checked (throttled like a login, so a hijacked session can't be used to
 * guess it). Signs out every session, including the caller's - the route
 * issues it a fresh one.
 */
export async function changePassword(userId, currentPassword, newPassword, { ip = "" } = {}) {
  const user = await User.findById(userId).select("+passwordHash");
  if (!user) return { ok: false, status: 404, error: "Account not found." };

  const { retryAfterMs, rows } = await beginAttempt([
    [userKey(user.username), MAX_FAILURES_PER_USER],
    [ipKey(ip), MAX_FAILURES_PER_IP],
  ]);
  if (retryAfterMs > 0) {
    return { ok: false, status: 429, error: `Too many failed attempts. Try again in ${Math.ceil(retryAfterMs / 60000)} min.` };
  }
  if (typeof currentPassword !== "string" || currentPassword.length > PASSWORD_MAX_LENGTH || !(await verifyPassword(currentPassword, user.passwordHash))) {
    return { ok: false, status: 400, error: "Current password is incorrect." };
  }
  await LoginFailure.deleteMany({ _id: { $in: rows.map((r) => r._id) } });

  const problems = checkPasswordStrength(newPassword, user.username);
  if (problems.length > 0) return { ok: false, status: 400, error: problems.join(" ") };
  if (await verifyPassword(newPassword, user.passwordHash)) {
    return { ok: false, status: 400, error: "New password must be different from the current one." };
  }

  await writePassword(user, newPassword);
  return { ok: true };
}

// Everything below is for extras/manageUsers.mjs (shell access only).

export async function createUser(rawUsername, password) {
  const username = normalizeUsername(rawUsername);
  if (!USERNAME_RE.test(username)) throw new Error("Username must be 3-32 characters: a-z, 0-9, dot, dash, underscore.");
  const problems = checkPasswordStrength(password, username);
  if (problems.length > 0) throw new Error(problems.join(" "));
  if (await User.exists({ username })) throw new Error(`User "${username}" already exists.`);
  const user = await User.create({ username, passwordHash: await hashPassword(password) });
  return { id: String(user._id), username: user.username };
}

export async function setUserPassword(rawUsername, password) {
  const user = await User.findOne({ username: normalizeUsername(rawUsername) }).select("+passwordHash");
  if (!user) throw new Error(`No user "${normalizeUsername(rawUsername)}".`);
  const problems = checkPasswordStrength(password, user.username);
  if (problems.length > 0) throw new Error(problems.join(" "));
  await writePassword(user, password);
  await LoginFailure.deleteMany({ key: userKey(user.username) });
}

export async function listUsers() {
  const [users, sessionCounts] = await Promise.all([
    User.find({}).sort({ createdAt: 1 }).lean(),
    Session.aggregate([{ $match: { expiresAt: { $gt: new Date() } } }, { $group: { _id: "$userId", count: { $sum: 1 } } }]),
  ]);
  const countByUser = new Map(sessionCounts.map((s) => [String(s._id), s.count]));
  return users.map((u) => ({
    username: u.username,
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt,
    activeSessions: countByUser.get(String(u._id)) || 0,
  }));
}

export async function deleteUser(rawUsername) {
  const user = await User.findOneAndDelete({ username: normalizeUsername(rawUsername) });
  if (!user) throw new Error(`No user "${normalizeUsername(rawUsername)}".`);
  await Session.deleteMany({ userId: user._id });
}

export async function signOutUser(rawUsername) {
  const user = await User.findOne({ username: normalizeUsername(rawUsername) });
  if (!user) throw new Error(`No user "${normalizeUsername(rawUsername)}".`);
  const { deletedCount } = await Session.deleteMany({ userId: user._id });
  return deletedCount || 0;
}

export async function clearLoginFailures(rawUsername) {
  const { deletedCount } = await LoginFailure.deleteMany({ key: userKey(normalizeUsername(rawUsername)) });
  return deletedCount || 0;
}
