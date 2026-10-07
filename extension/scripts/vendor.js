import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const vendorDir = path.join(root, "vendor");
mkdirSync(vendorDir, { recursive: true });
copyFileSync(path.join(root, "node_modules/xlsx/dist/xlsx.full.min.js"), path.join(vendorDir, "xlsx.full.min.js"));
copyFileSync(path.join(root, "node_modules/jszip/dist/jszip.min.js"), path.join(vendorDir, "jszip.min.js"));
const license = path.join(root, "node_modules/xlsx/LICENSE");
if (existsSync(license)) copyFileSync(license, path.join(vendorDir, "SHEETJS-LICENSE"));
console.log("Vendored SheetJS and JSZip.");
