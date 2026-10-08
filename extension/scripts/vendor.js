import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const vendorDir = path.join(root, "vendor");
mkdirSync(vendorDir, { recursive: true });
copyFileSync(path.join(root, "node_modules/xlsx/dist/xlsx.full.min.js"), path.join(vendorDir, "xlsx.full.min.js"));
copyFileSync(path.join(root, "node_modules/jszip/dist/jszip.min.js"), path.join(vendorDir, "jszip.min.js"));
const license = path.join(root, "node_modules/xlsx/LICENSE");
if (existsSync(license)) copyFileSync(license, path.join(vendorDir, "SHEETJS-LICENSE"));
const fontDir = path.join(vendorDir, "fonts");
const inter = path.join(root, "node_modules/@fontsource-variable/inter");
mkdirSync(fontDir, { recursive: true });
copyFileSync(path.join(inter, "files/inter-latin-wght-normal.woff2"), path.join(fontDir, "inter-latin-wght-normal.woff2"));
copyFileSync(path.join(inter, "LICENSE"), path.join(fontDir, "INTER-LICENSE"));
console.log("Vendored SheetJS, JSZip and the Inter font.");
