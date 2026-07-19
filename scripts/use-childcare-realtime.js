const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const raw = execSync(
  "npx --yes supabase projects api-keys --project-ref yqjehxmxwzoezympyfbi --output json",
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
);
const jsonText = raw.match(/\[[\s\S]*\]/)[0];
const keys = JSON.parse(jsonText);
const anon = keys.find((x) => x.name === "anon" || x.id === "anon");
if (!anon || !anon.api_key) {
  console.error("anon key not found");
  process.exit(1);
}

const cfg = `// Fake Hunt shares the childcare Supabase *project* for billing only.
// Isolation: Realtime channels prefixed fh: only. No childcare tables/reads/writes.
// Client uses anon key only — never service_role.
window.FH_SUPABASE_URL = "https://yqjehxmxwzoezympyfbi.supabase.co";
window.FH_SUPABASE_ANON_KEY = ${JSON.stringify(anon.api_key)};
`;

fs.writeFileSync(path.join(__dirname, "..", "config.js"), cfg);
console.log("ok config.js prefix=", anon.prefix || "anon");
