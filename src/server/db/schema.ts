import { sql } from "drizzle-orm";
import {
  boolean,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { uuidv7 } from "uuidv7";

const id = () =>
  uuid("id")
    .primaryKey()
    .$defaultFn(() => uuidv7());
const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const tenants = pgTable("tenants", {
  id: id(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  vertical: text("vertical").notNull(),
  status: text("status").notNull().default("active"),
  timezone: text("timezone").notNull().default("America/Sao_Paulo"),
  country: text("country").notNull().default("BR"),
  currency: text("currency").notNull().default("BRL"),
  createdAt: createdAt(),
});

export const tenantDomains = pgTable("tenant_domains", {
  host: text("host").primaryKey(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  verified: boolean("verified").notNull().default(false),
});

export const customers = pgTable("customers", {
  id: id(),
  phone: text("phone").notNull().unique(),
  name: text("name"),
  createdAt: createdAt(),
});

export const staffUsers = pgTable("staff_users", {
  id: id(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: id(),
  staffId: uuid("staff_id")
    .notNull()
    .references(() => staffUsers.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const staffMemberships = pgTable(
  "staff_memberships",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    staffId: uuid("staff_id")
      .notNull()
      .references(() => staffUsers.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.staffId] })],
);

export const customerProfiles = pgTable(
  "customer_profiles",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.customerId] })],
);

export const tenantSettings = pgTable("tenant_settings", {
  tenantId: uuid("tenant_id")
    .primaryKey()
    .references(() => tenants.id, { onDelete: "cascade" }),
  theme: jsonb("theme").notNull().default(sql`'{}'::jsonb`),
  serviceModes: text("service_modes").array().notNull().default(sql`'{pickup}'`),
  paymentMethods: text("payment_methods").array().notNull().default(sql`'{}'`),
  contact: jsonb("contact").notNull().default(sql`'{}'::jsonb`),
  address: jsonb("address").notNull().default(sql`'{}'::jsonb`),
});

export const auditLog = pgTable("audit_log", {
  id: id(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  resource: text("resource"),
  ip: text("ip"),
  createdAt: createdAt(),
});

export const otpCodes = pgTable("otp_codes", {
  id: id(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  phone: text("phone").notNull(),
  codeHash: text("code_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  attempts: integer("attempts").notNull().default(0),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: createdAt(),
});
