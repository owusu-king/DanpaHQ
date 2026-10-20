import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * A call about the signed-in person carries their session.
 *
 * Plain `apiFetch` sends no access token, so an owner endpoint answers 401 and
 * the API's message, "Sign in to continue.", reaches somebody who is signed in.
 * The Housing Passport and Support both shipped that way. `authedFetch` is the
 * call for anything under `/me/`; plain `apiFetch` stays for public reads.
 */

const web = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** `/me/` endpoints called before any session exists, each with its reason. */
const ANONYMOUS = new Map([
  // Registration with a phone or Google ticket: the ticket in the body is the
  // credential, and the account it creates is where the session comes from.
  ["/me/registration/", "src/components/auth/flows/RegisterFlow.tsx"],
]);

function sources() {
  const files = [];
  for (const folder of ["src", "app"]) {
    for (const entry of readdirSync(resolve(web, folder), { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !/\.(ts|tsx)$/.test(entry.name)) continue;
      files.push(resolve(entry.parentPath ?? entry.path, entry.name));
    }
  }
  return files;
}

test("no call to a /me/ endpoint goes out without the session", () => {
  const offenders = [];
  for (const file of sources()) {
    const source = readFileSync(file, "utf8");
    const where = relative(web, file).replaceAll("\\", "/");
    for (const match of source.matchAll(/\bapiFetch<[^(]*?>\(\s*[`"'](\/me\/[^`"'$]*)/g)) {
      if (ANONYMOUS.get(match[1]) === where) continue;
      const line = source.slice(0, match.index).split("\n").length;
      offenders.push(`${where}:${line} ${match[1]}`);
    }
  }
  assert.deepEqual(offenders, [], `these call /me/ without the access token: ${offenders.join(", ")}`);
});

test("Support's calls carry the session", () => {
  const support = readFileSync(resolve(web, "src/lib/support.ts"), "utf8");
  assert.match(support, /import \{ authedFetch \} from "@\/lib\/auth";/);
  for (const name of ["listSupportCases", "getSupportCase", "createSupportCase", "replyToSupportCase"]) {
    assert.match(support, new RegExp(`export const ${name} = [^\\n]*=> authedFetch<`), `${name} is sent without the session`);
  }
});
