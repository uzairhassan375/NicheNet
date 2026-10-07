import { rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const extensionDir = path.resolve(import.meta.dirname, "..");
const out = path.join(extensionDir, "nichenet.zip");
rmSync(out, { force: true });
execFileSync("zip", [
  "-r",
  "-X",
  out,
  ".",
  "-x",
  "node_modules/*",
  "-x",
  "node_modules/**",
  "-x",
  "tests/*",
  "-x",
  "tests/**",
  "-x",
  "scripts/*",
  "-x",
  "package.json",
  "-x",
  "package-lock.json",
  "-x",
  ".gitignore",
  "-x",
  "*.zip",
], { cwd: extensionDir });
console.log(out);
