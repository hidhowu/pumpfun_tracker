#!/usr/bin/env node
// Dashboard account management. This is the ONLY way to create accounts -
// there is deliberately no sign-up page, so being able to reach the web app
// never lets anyone give themselves access. Run it on the server, from the
// project root (it uses the same .env/MONGODB_URI as the app):
//
//   npm run user -- create <username>     new account (prompts for the password, hidden)
//   npm run user -- passwd <username>     set a new password; signs out all its sessions
//   npm run user -- list                  accounts, last sign-in, active sessions
//   npm run user -- signout <username>    end every session without changing the password
//   npm run user -- unlock <username>     clear a failed-login lockout
//   npm run user -- delete <username>     remove the account and its sessions
//
// Passwords can also be piped in (one per line) for scripted setups:
//   printf '%s\n%s\n' "$PW" "$PW" | npm run user -- create admin

import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import mongoose from "mongoose";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) process.loadEnvFile(envPath);

const { connectDb } = await import("../db/connect.js");
const auth = await import("../db/authService.js");

let pipedLines = null;

/** Reads a password without echoing it (or the next line of piped stdin). */
async function promptSecret(question) {
  const { stdin, stdout } = process;
  if (!stdin.isTTY) {
    if (!pipedLines) {
      const chunks = [];
      for await (const chunk of stdin) chunks.push(chunk);
      pipedLines = Buffer.concat(chunks).toString("utf8").split(/\r?\n/);
    }
    return pipedLines.shift() ?? "";
  }

  stdout.write(question);
  stdin.setRawMode(true);
  stdin.setEncoding("utf8");
  stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    const finish = (fn) => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write("\n");
      fn();
    };
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") return finish(() => resolve(value));
        if (ch === "\u0003") return finish(() => reject(new Error("Cancelled.")));
        if (ch === "\u0008" || ch === "\u007f") value = value.slice(0, -1);
        else if (ch >= " ") value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

async function promptNewPassword(username) {
  const password = await promptSecret(`New password for "${username}": `);
  const confirm = await promptSecret("Repeat it: ");
  if (password !== confirm) throw new Error("Passwords don't match.");
  return password;
}

function requireUsername(username, command) {
  if (!username) throw new Error(`Usage: npm run user -- ${command} <username>`);
  return username;
}

const fmt = (date) => (date ? new Date(date).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "never");

async function main() {
  const [command, username] = process.argv.slice(2);
  await connectDb();

  switch (command) {
    case "create": {
      const user = await auth.createUser(requireUsername(username, "create"), await promptNewPassword(username));
      console.log(`Created "${user.username}". Sign in at /login.`);
      break;
    }
    case "passwd": {
      await auth.setUserPassword(requireUsername(username, "passwd"), await promptNewPassword(username));
      console.log(`Password changed for "${auth.normalizeUsername(username)}" - all of its sessions were signed out.`);
      break;
    }
    case "list": {
      const users = await auth.listUsers();
      if (users.length === 0) console.log("No accounts yet - create one with: npm run user -- create <username>");
      for (const u of users) {
        console.log(`${u.username.padEnd(24)} created ${fmt(u.createdAt)}   last sign-in ${fmt(u.lastLoginAt)}   active sessions: ${u.activeSessions}`);
      }
      break;
    }
    case "signout": {
      const count = await auth.signOutUser(requireUsername(username, "signout"));
      console.log(`Signed out ${count} session(s).`);
      break;
    }
    case "unlock": {
      const count = await auth.clearLoginFailures(requireUsername(username, "unlock"));
      console.log(`Cleared ${count} failed attempt(s) for "${auth.normalizeUsername(username)}".`);
      break;
    }
    case "delete": {
      await auth.deleteUser(requireUsername(username, "delete"));
      console.log(`Deleted "${auth.normalizeUsername(username)}" and its sessions.`);
      break;
    }
    default:
      console.log("Commands: create <username> | passwd <username> | list | signout <username> | unlock <username> | delete <username>");
      process.exitCode = command ? 1 : 0;
  }
}

try {
  await main();
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
