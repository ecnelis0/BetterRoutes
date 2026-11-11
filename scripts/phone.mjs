#!/usr/bin/env node
/**
 * `npm run phone`: the dev server over https on this Wi-Fi, for riding with
 * the app on a phone.
 *
 * Phones only share GPS with a secure page, and http://192.168.x.x is not
 * one - so navigation would refuse to start. This makes a small certificate
 * authority of its own (once, in certificates/, gitignored), a certificate
 * for this Mac's Wi-Fi address signed by it (again whenever the address
 * changes), starts `next dev` with it, and prints a QR code of the address.
 *
 * Nothing is installed on the Mac: the phone shows a certificate warning
 * once, or trusts certificates/phone-ca.crt for no warnings (README).
 */
import { execFileSync, spawn } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import path from "node:path";
import qrcode from "qrcode-terminal";

const PORT = process.env.PORT ?? "3443";
const DIR = path.resolve("certificates");
const CA_KEY = path.join(DIR, "phone-ca-key.pem");
const CA_CERT = path.join(DIR, "phone-ca.crt");
const KEY = path.join(DIR, "phone-key.pem");
const CERT = path.join(DIR, "phone-cert.pem");

const ips = Object.values(networkInterfaces())
  .flat()
  .filter((a) => a && a.family === "IPv4" && !a.internal)
  .map((a) => a.address);
if (!ips.length) {
  console.error("This Mac is not on a network. Join the same Wi-Fi as your phone and try again.");
  process.exit(1);
}

const openssl = (...args) => execFileSync("openssl", args, { stdio: ["ignore", "ignore", "pipe"] });
mkdirSync(DIR, { recursive: true });

if (!existsSync(CA_KEY) || !existsSync(CA_CERT)) {
  openssl("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-sha256", "-days", "825",
    "-keyout", CA_KEY, "-out", CA_CERT, "-subj", "/CN=BetterRoutes local dev CA");
}

// Reissue when the Wi-Fi address is not on the certificate (new network) or it is near expiry.
const current = existsSync(CERT) && existsSync(KEY) ? new X509Certificate(readFileSync(CERT)) : null;
const fresh =
  current &&
  ips.every((ip) => current.checkIP(ip)) &&
  new Date(current.validTo).getTime() - Date.now() > 7 * 24 * 3600 * 1000;
if (!fresh) {
  const ext = path.join(DIR, "phone-cert.ext");
  writeFileSync(
    ext,
    [
      "basicConstraints=CA:FALSE",
      "keyUsage=digitalSignature,keyEncipherment",
      "extendedKeyUsage=serverAuth",
      `subjectAltName=DNS:localhost,IP:127.0.0.1,${ips.map((ip) => `IP:${ip}`).join(",")}`,
    ].join("\n")
  );
  const csr = path.join(DIR, "phone.csr");
  openssl("req", "-newkey", "rsa:2048", "-nodes", "-keyout", KEY, "-out", csr, "-subj", "/CN=BetterRoutes dev");
  // iOS rejects server certificates valid for more than 825 days.
  openssl("x509", "-req", "-in", csr, "-CA", CA_CERT, "-CAkey", CA_KEY, "-CAcreateserial",
    "-out", CERT, "-days", "397", "-sha256", "-extfile", ext);
}

const url = `https://${ips[0]}:${PORT}`;
const next = spawn(
  "npx",
  ["next", "dev", "-p", PORT, "--experimental-https", "--experimental-https-key", KEY, "--experimental-https-cert", CERT],
  { stdio: ["inherit", "pipe", "pipe"], env: { ...process.env, NEXT_DIST_DIR: ".next-phone" } }
);
let output = "";
next.stdout.on("data", (chunk) => {
  process.stdout.write(chunk);
  output += chunk;
});
next.stderr.on("data", (chunk) => {
  process.stderr.write(chunk);
  output += chunk;
});
next.on("exit", (code) => {
  if (/Another next dev server is already running/.test(output)) {
    console.error("\nnpm run phone is already running in another window - use that one, or Ctrl+C it first.");
  }
  process.exit(code ?? 0);
});

// "Ready" is printed before Next checks for another dev server, so wait
// until the page actually answers before telling anyone to scan.
const answers = async () => {
  try {
    execFileSync("curl", ["-sk", "-o", "/dev/null", "-m", "5", `https://127.0.0.1:${PORT}/`]);
    return true;
  } catch {
    return false;
  }
};
for (let i = 0; i < 60 && next.exitCode === null; i++) {
  if (await answers()) {
    console.log("\nOn your phone (same Wi-Fi), scan this or open", url);
    qrcode.generate(url, { small: true });
    console.log(
      [
        "The first time, the phone warns the certificate is not trusted:",
        "  Android Chrome: Advanced -> Proceed.",
        "  iPhone Safari:  Show Details -> visit this website -> Visit Website.",
        "Then allow location when navigation asks. Ctrl+C here stops the server.",
        "",
      ].join("\n")
    );
    break;
  }
  await new Promise((r) => setTimeout(r, 1000));
}

for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => next.kill(sig));
