import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import pg from "pg";

const root = path.resolve(import.meta.dirname, "..");

function loadEnv(file) {
  let text = "";
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return;
  }
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const splitAt = trimmed.indexOf("=");
    if (splitAt === -1) continue;
    const key = trimmed.slice(0, splitAt).trim();
    let value = trimmed.slice(splitAt + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnv(path.join(root, ".env"));

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is missing from .env");
  process.exit(1);
}

const regions = [
  "ap-northeast-2",
  "us-east-1",
  "us-east-2",
  "us-west-1",
  "us-west-2",
  "ca-central-1",
  "eu-west-1",
  "eu-west-2",
  "eu-west-3",
  "eu-central-1",
  "eu-central-2",
  "eu-north-1",
  "ap-southeast-1",
  "ap-southeast-2",
  "ap-northeast-1",
  "ap-northeast-2",
  "ap-south-1",
  "sa-east-1",
];

function poolerUrls(databaseUrl) {
  const url = new URL(databaseUrl);
  const ref = url.hostname.split(".")[1];
  if (!ref) return [];
  const password = decodeURIComponent(url.password);
  const urls = [];
  for (const region of regions) {
    for (const prefix of ["aws-0", "aws-1"]) {
      const next = new URL(databaseUrl);
      next.username = `postgres.${ref}`;
      next.password = password;
      next.hostname = `${prefix}-${region}.pooler.supabase.com`;
      next.port = "5432";
      urls.push(next.toString());
    }
  }
  return urls;
}

async function connect() {
  const candidates = [process.env.DATABASE_URL, ...poolerUrls(process.env.DATABASE_URL)];
  let lastError;
  for (const connectionString of candidates) {
    const client = new pg.Client({
      connectionString,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 8000,
    });
    const hostname = new URL(connectionString).hostname;
    client.on("error", () => {});
    try {
      await client.connect();
      console.log(`Connected to ${hostname}`);
      return client;
    } catch (error) {
      lastError = error;
      console.log(`Skipped ${hostname}`);
      try {
        await client.end();
      } catch {
        // The socket never opened.
      }
    }
  }
  throw lastError;
}

const client = await connect();

  const schema = readFileSync(path.join(root, "supabase/schema.sql"), "utf8");

try {
  await client.query("set search_path = public, extensions");
  await client.query(schema);
  const existing = await client.query("select id from public.admin_auth where id = 1");
  if (existing.rowCount === 0) {
    const password = `Niche-${randomBytes(9).toString("base64url")}`;
    await client.query(
      "insert into public.admin_auth (id, password_hash) values (1, crypt($1, gen_salt('bf')))",
      [password],
    );
    console.log(`ADMIN_PASSWORD_CREATED ${password}`);
    await verifyLimits(password);
  } else {
    console.log("ADMIN_PASSWORD_EXISTS");
  }
  console.log("Account tables are ready.");
} finally {
  await client.end();
}

async function verifyLimits(password) {
  const login = await client.query("select public.admin_login($1) as result", [password]);
  if (!login.rows[0].result.ok) throw new Error("Admin login failed after setup.");
  const token = login.rows[0].result.token;
  const email = `limit-check-${Date.now()}@example.com`;
  const saved = await client.query(
    "select public.admin_save_user($1, null, $2, $3, $4, true, 1, null, null) as result",
    [token, email, "test-pass-123", "Limit Check"],
  );
  if (!saved.rows[0].result.ok) throw new Error(saved.rows[0].result.error || "Could not create the limit-check user.");
  const userLogin = await client.query("select public.user_login($1, $2) as result", [email, "test-pass-123"]);
  if (!userLogin.rows[0].result.ok) throw new Error(userLogin.rows[0].result.error || "Test user login failed.");
  const userToken = userLogin.rows[0].result.token;
  const first = await client.query("select public.consume_search($1, 1, 1) as result", [userToken]);
  if (!first.rows[0].result.ok) throw new Error(first.rows[0].result.error || "The first search was refused.");
  const second = await client.query("select public.consume_search($1, 1, 1) as result", [userToken]);
  if (second.rows[0].result.code !== "limit") throw new Error("The second search should have hit the daily limit.");
  await client.query("select public.admin_delete_user($1, $2)", [token, saved.rows[0].result.id]);
  console.log("Limit check passed.");
}
