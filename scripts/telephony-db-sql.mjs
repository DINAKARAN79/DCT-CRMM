import { spawnSync } from "node:child_process";

const scriptByCommand = {
  check: "scripts/check-telephony-permission.sql",
  repair: "scripts/repair-telephony-permission.sql",
};

const command = process.argv[2];
if (command !== "check" && command !== "repair") {
  console.error("Choose either 'check' or 'repair'.");
  process.exit(2);
}
const script = scriptByCommand[command];

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required for the telephony database command.");
  process.exit(2);
}

let databaseUrl;
try {
  databaseUrl = new URL(process.env.DATABASE_URL);
} catch {
  console.error("DATABASE_URL must be a PostgreSQL connection URL.");
  process.exit(2);
}

if (!["postgres:", "postgresql:"].includes(databaseUrl.protocol)) {
  console.error("DATABASE_URL must use the postgres or postgresql protocol.");
  process.exit(2);
}

const environment = {
  ...process.env,
  PGHOST: databaseUrl.hostname.replace(/^\[|\]$/g, ""),
  PGPORT: databaseUrl.port || "5432",
  PGDATABASE: decodeURIComponent(databaseUrl.pathname.slice(1)),
};

if (databaseUrl.username) environment.PGUSER = decodeURIComponent(databaseUrl.username);
else delete environment.PGUSER;
if (databaseUrl.password) environment.PGPASSWORD = decodeURIComponent(databaseUrl.password);
else delete environment.PGPASSWORD;

const libpqOptions = {
  sslmode: "PGSSLMODE",
  sslrootcert: "PGSSLROOTCERT",
  sslcert: "PGSSLCERT",
  sslkey: "PGSSLKEY",
  connect_timeout: "PGCONNECT_TIMEOUT",
  application_name: "PGAPPNAME",
  options: "PGOPTIONS",
  target_session_attrs: "PGTARGETSESSIONATTRS",
};
for (const [parameter, variable] of Object.entries(libpqOptions)) {
  const value = databaseUrl.searchParams.get(parameter);
  if (value) environment[variable] = value;
}

const result = spawnSync("psql", ["-X", "-v", "ON_ERROR_STOP=1", "-f", script], {
  env: environment,
  stdio: "inherit",
});

if (result.error) {
  console.error(`Unable to run psql: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
