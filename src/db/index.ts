import postgres from "postgres";

const db = postgres({
  host: String(process.env.DB_HOST || "localhost"),
  port: Number(process.env.DB_PORT || 5432),
  database: String(process.env.DB_NAME || "test"),
  username: String(process.env.DB_USER),
  password: String(process.env.DB_PASSWORD),
  ssl: false,
});

export default db;
