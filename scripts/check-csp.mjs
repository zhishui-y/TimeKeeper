import { readFile } from "node:fs/promises";

const config = JSON.parse(
  await readFile(new globalThis.URL("../src-tauri/tauri.conf.json", import.meta.url)),
);
const security = config.app?.security;
const requiredProduction = [
  "default-src 'self'",
  "script-src 'self'",
  "connect-src ipc: http://ipc.localhost",
  "object-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
];
const requiredDevelopment = ["connect-src 'self' ipc: http://ipc.localhost ws:"];

if (!security || typeof security.csp !== "string" || typeof security.devCsp !== "string") {
  throw new Error("Tauri CSP and devCsp must both be explicit strings");
}
for (const directive of requiredProduction) {
  if (!security.csp.includes(directive)) throw new Error(`Production CSP is missing: ${directive}`);
}
for (const directive of requiredDevelopment) {
  if (!security.devCsp.includes(directive))
    throw new Error(`Development CSP is missing: ${directive}`);
}
if (security.csp.includes("'unsafe-eval'") || security.devCsp.includes("'unsafe-eval'")) {
  throw new Error("CSP must not allow unsafe-eval");
}
if (JSON.stringify(security.dangerousDisableAssetCspModification) !== '["style-src"]') {
  throw new Error("Only style-src may bypass Tauri asset CSP modification");
}

globalThis.console.log("Tauri CSP static contract is valid.");
