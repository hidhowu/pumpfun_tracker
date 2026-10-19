import { User } from "./models/User.js";
import { Session } from "./models/Session.js";
import { LoginFailure } from "./models/LoginFailure.js";
import { checkPasswordStrength, getDummyHash, hashPassword, PASSWORD_MAX_LENGTH, verifyPassword } from "./auth/password.js";
import {
  decryptSecret,
  encryptSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  isTotpEncryptionConfigured,
  looksLikeRecoveryCode,
  otpauthUrl,
  verifyTotp,
} from "./auth/totp.js";

/** @typedef {{ ok: false, status: number, error: string }} AuthFailure */

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
 *   | { ok: true, user: { id: string, username: string }, twoFactor: boolean }
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

  // With two-factor on, a correct password is only the first step: the caller must now collect a code (verifyTwoFactorLogin)
  // before any session exists. lastLoginAt is set when the code is accepted.
  const twoFactor = !!user.totp?.enabled;
  await LoginFailure.deleteMany({ $or: [{ key: userKey(username) }, { _id: rows[1]._id }] });
  if (!twoFactor) await User.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } });
  return { ok: true, user: { id: String(user._id), username: user.username }, twoFactor };
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

// ------------------------------------------------------------------ two-factor (authenticator app)

// A wrong code counts toward its own limit (separate from the password one), so guessing the 6 digits is throttled to
// 5 tries per 15 minutes per account - on top of the ~1-in-333,000 chance per try.
const twoFactorKey = (userId) => `totp:${userId}`;
const setupKey = (userId) => `totpsetup:${userId}`;
const TWO_FACTOR_ISSUER = "pump.fun tracker";

/** @returns {AuthFailure} */
function lockedResult(retryAfterMs) {
  return { ok: false, status: 429, error: `Too many failed attempts. Try again in ${Math.ceil(retryAfterMs / 60000)} min.` };
}

/**
 * Checks `code` (an authenticator code, or - when allowRecovery - an unused recovery code) for a user whose document was
 * loaded with the secret and recovery hashes. A TOTP code is accepted at most once; a recovery code is consumed by an atomic
 * pull, so two requests can't both spend it. Returns "totp" | "recovery" | null.
 */
async function consumeSecondFactor(user, rawCode, { allowRecovery = true } = {}) {
  const code = typeof rawCode === "string" ? rawCode.trim() : "";
  if (/^\d{6}$/.test(code)) {
    if (!user.totp?.secretEnc) return null;
    const step = verifyTotp(decryptSecret(user.totp.secretEnc), code);
    if (step === null) return null;
    const claimed = await User.updateOne(
      { _id: user._id, $or: [{ "totp.lastUsedStep": null }, { "totp.lastUsedStep": { $lt: step } }] },
      { $set: { "totp.lastUsedStep": step } }
    );
    return claimed.modifiedCount === 1 ? "totp" : null; // null here = this code (or a later one) was already used
  }
  if (allowRecovery && looksLikeRecoveryCode(code)) {
    const hash = hashRecoveryCode(code);
    const pulled = await User.updateOne({ _id: user._id, "totp.recoveryHashes": hash }, { $pull: { "totp.recoveryHashes": hash } });
    return pulled.modifiedCount === 1 ? "recovery" : null;
  }
  return null;
}

/**
 * Second step of sign-in: the code that goes with a password already verified by authenticate(). Throttled, replay-proof.
 * @returns {Promise<{ ok: true, user: { id: string, username: string }, usedRecoveryCode: boolean } | AuthFailure>}
 */
export async function verifyTwoFactorLogin(userId, code, { ip = "" } = {}) {
  const { retryAfterMs, rows } = await beginAttempt([
    [twoFactorKey(userId), MAX_FAILURES_PER_USER],
    [ipKey(ip), MAX_FAILURES_PER_IP],
  ]);
  if (retryAfterMs > 0) return lockedResult(retryAfterMs);

  const user = await User.findById(userId).select("+totp.secretEnc +totp.recoveryHashes");
  const method = user?.totp?.enabled ? await consumeSecondFactor(user, code) : null;
  if (!user || !method) return { ok: false, status: 401, error: "Invalid code." };

  await Promise.all([
    LoginFailure.deleteMany({ $or: [{ key: twoFactorKey(userId) }, { _id: rows[1]._id }] }),
    User.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } }),
  ]);
  return { ok: true, user: { id: String(user._id), username: user.username }, usedRecoveryCode: method === "recovery" };
}

/**
 * Password re-check for sensitive account changes, throttled like a login so a hijacked session can't be used to guess it.
 * @returns {Promise<AuthFailure | { ok: true, user: any }>}
 */
async function reauthenticate(userId, password, ip) {
  const user = await User.findById(userId).select("+passwordHash +totp.secretEnc +totp.recoveryHashes +totp.pendingSecretEnc");
  if (!user) return { ok: false, status: 404, error: "Account not found." };
  const { retryAfterMs, rows } = await beginAttempt([
    [userKey(user.username), MAX_FAILURES_PER_USER],
    [ipKey(ip), MAX_FAILURES_PER_IP],
  ]);
  if (retryAfterMs > 0) return lockedResult(retryAfterMs);
  if (typeof password !== "string" || password.length > PASSWORD_MAX_LENGTH || !(await verifyPassword(password, user.passwordHash))) {
    return { ok: false, status: 400, error: "Password is incorrect." };
  }
  await LoginFailure.deleteMany({ _id: { $in: rows.map((r) => r._id) } });
  return { ok: true, user };
}

/**
 * Same throttled code check, for changes made from inside a session (disable, new recovery codes).
 * @returns {Promise<AuthFailure | { ok: true, user: any }>}
 */
async function reauthenticateWithCode(userId, password, code, ip) {
  const re = await reauthenticate(userId, password, ip);
  if (!re.ok) return re;
  if (!re.user.totp?.enabled) return { ok: false, status: 400, error: "Two-factor sign-in isn't turned on." };
  const { retryAfterMs, rows } = await beginAttempt([
    [twoFactorKey(userId), MAX_FAILURES_PER_USER],
    [ipKey(ip), MAX_FAILURES_PER_IP],
  ]);
  if (retryAfterMs > 0) return lockedResult(retryAfterMs);
  if (!(await consumeSecondFactor(re.user, code))) return { ok: false, status: 400, error: "Invalid code." };
  await LoginFailure.deleteMany({ _id: { $in: rows.map((r) => r._id) } });
  return re;
}

export async function getTwoFactorStatus(userId) {
  const user = await User.findById(userId).select("+totp.recoveryHashes").lean();
  return {
    enabled: !!user?.totp?.enabled,
    enabledAt: user?.totp?.enabledAt ?? null,
    recoveryCodesRemaining: user?.totp?.recoveryHashes?.length ?? 0,
    available: isTotpEncryptionConfigured(),
  };
}

/**
 * Step 1 of turning it on: new secret (not active yet) for the QR code. Needs the account password.
 * @returns {Promise<AuthFailure | { ok: true, secret: string, otpauthUrl: string }>}
 */
export async function beginTwoFactorSetup(userId, password, { ip = "" } = {}) {
  if (!isTotpEncryptionConfigured()) {
    return { ok: false, status: 500, error: "Two-factor isn't configured on this server (TOTP_ENCRYPTION_KEY is missing)." };
  }
  const re = await reauthenticate(userId, password, ip);
  if (!re.ok) return re;
  if (re.user.totp?.enabled) return { ok: false, status: 400, error: "Two-factor sign-in is already on." };

  const secret = generateTotpSecret();
  await User.updateOne({ _id: userId }, { $set: { "totp.pendingSecretEnc": encryptSecret(secret) } });
  return { ok: true, secret, otpauthUrl: otpauthUrl({ secret, account: re.user.username, issuer: TWO_FACTOR_ISSUER }) };
}

/**
 * Step 2: the user types a code from their app, proving it holds the secret. Only then does it become active, and the
 * recovery codes are generated - returned here, in plain text, exactly once.
 * @returns {Promise<AuthFailure | { ok: true, recoveryCodes: string[] }>}
 */
export async function enableTwoFactor(userId, code, { ip = "" } = {}) {
  const { retryAfterMs, rows } = await beginAttempt([
    [setupKey(userId), MAX_FAILURES_PER_USER],
    [ipKey(ip), MAX_FAILURES_PER_IP],
  ]);
  if (retryAfterMs > 0) return lockedResult(retryAfterMs);

  const user = await User.findById(userId).select("+totp.pendingSecretEnc");
  if (!user || !user.totp?.pendingSecretEnc) return { ok: false, status: 400, error: "Start the setup again." };
  const step = verifyTotp(decryptSecret(user.totp.pendingSecretEnc), typeof code === "string" ? code.trim() : "");
  if (step === null) return { ok: false, status: 400, error: "That code isn't right. Check the time on your phone and try the next one." };

  const recoveryCodes = generateRecoveryCodes();
  const enabled = await User.updateOne(
    { _id: userId, "totp.enabled": { $ne: true }, "totp.pendingSecretEnc": user.totp.pendingSecretEnc },
    {
      $set: {
        "totp.enabled": true,
        "totp.enabledAt": new Date(),
        "totp.secretEnc": user.totp.pendingSecretEnc,
        "totp.pendingSecretEnc": null,
        "totp.lastUsedStep": step,
        "totp.recoveryHashes": recoveryCodes.map(hashRecoveryCode),
      },
    }
  );
  if (enabled.modifiedCount !== 1) return { ok: false, status: 400, error: "Start the setup again." };
  await LoginFailure.deleteMany({ _id: { $in: rows.map((r) => r._id) } });
  // Every session that exists was created without a second factor: end them all (the route gives this browser a fresh one).
  await Session.deleteMany({ userId });
  return { ok: true, recoveryCodes };
}

/**
 * Turning it off needs BOTH the password and a current code (or recovery code).
 * @returns {Promise<AuthFailure | { ok: true }>}
 */
export async function disableTwoFactor(userId, password, code, { ip = "" } = {}) {
  const re = await reauthenticateWithCode(userId, password, code, ip);
  if (!re.ok) return re;
  await User.updateOne(
    { _id: userId },
    { $set: { "totp.enabled": false, "totp.enabledAt": null, "totp.secretEnc": null, "totp.pendingSecretEnc": null, "totp.lastUsedStep": null, "totp.recoveryHashes": [] } }
  );
  await Session.deleteMany({ userId });
  return { ok: true };
}

/**
 * Replaces the recovery codes (the old ones stop working). Needs the password and a current code.
 * @returns {Promise<AuthFailure | { ok: true, recoveryCodes: string[] }>}
 */
export async function regenerateRecoveryCodes(userId, password, code, { ip = "" } = {}) {
  const re = await reauthenticateWithCode(userId, password, code, ip);
  if (!re.ok) return re;
  const recoveryCodes = generateRecoveryCodes();
  await User.updateOne({ _id: userId }, { $set: { "totp.recoveryHashes": recoveryCodes.map(hashRecoveryCode) } });
  return { ok: true, recoveryCodes };
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

/** Break-glass for a lost phone AND lost recovery codes: shell access only. Signs the account out everywhere. */
export async function resetTwoFactor(rawUsername) {
  const user = await User.findOne({ username: normalizeUsername(rawUsername) });
  if (!user) throw new Error(`No user "${normalizeUsername(rawUsername)}".`);
  await User.updateOne(
    { _id: user._id },
    { $set: { "totp.enabled": false, "totp.enabledAt": null, "totp.secretEnc": null, "totp.pendingSecretEnc": null, "totp.lastUsedStep": null, "totp.recoveryHashes": [] } }
  );
  await Session.deleteMany({ userId: user._id });
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
    twoFactor: !!u.totp?.enabled,
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
