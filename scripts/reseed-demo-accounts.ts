/**
 * Reseed demo personas (Issue #99).
 *
 * Idempotent — uses upsert + always rewrites the `passwordHash` so this can
 * be re-run safely on prod when:
 *   1. The full seed (`seed-realistic.ts`) was never applied (LAB_TECH and
 *      PHARMACIST users missing entirely → "Invalid email or password").
 *   2. A demo password was changed during testing and needs to be reset.
 *
 * Run on the prod box AFTER deploy:
 *   $ DATABASE_URL=$DATABASE_URL_PROD npx tsx scripts/reseed-demo-accounts.ts
 *
 * Does NOT touch any other data — patients, appointments, audit log, etc.
 * are left alone. Only the 7 demo persona User rows are touched.
 */
import { PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

interface DemoAccount {
  email: string;
  name: string;
  phone: string;
  password: string;
  role: Role;
}

const DEMO_ACCOUNTS: DemoAccount[] = [
  {
    email: "admin@medcore.local",
    name: "System Admin",
    phone: "9999900000",
    password: "admin123",
    role: Role.ADMIN,
  },
  {
    email: "dr.sharma@medcore.local",
    name: "Dr. Rajesh Sharma",
    phone: "9999900001",
    password: "doctor123",
    role: Role.DOCTOR,
  },
  {
    email: "nurse@medcore.local",
    name: "Anita Pawar",
    phone: "9999900020",
    password: "nurse123",
    role: Role.NURSE,
  },
  {
    email: "reception@medcore.local",
    name: "Sneha Deshmukh",
    phone: "9999900010",
    password: "reception123",
    role: Role.RECEPTION,
  },
  {
    email: "labtech@medcore.local",
    name: "Sunita Bhosale",
    phone: "9999900040",
    password: "labtech123",
    role: Role.LAB_TECH,
  },
  {
    email: "pharmacist@medcore.local",
    name: "Vikas Joshi",
    phone: "9999900030",
    password: "pharmacist123",
    role: Role.PHARMACIST,
  },
  {
    email: "patient1@medcore.local",
    name: "Rahul Sharma",
    phone: "9876543210",
    password: "patient123",
    role: Role.PATIENT,
  },
];

async function main() {
  console.log("=== Reseeding demo accounts (Issue #99) ===\n");
  let touched = 0;

  for (const acc of DEMO_ACCOUNTS) {
    const passwordHash = await bcrypt.hash(acc.password, 10);
    // Upsert with passwordHash on BOTH branches so re-running this script
    // resets the password to the documented demo value, in case it was
    // changed manually during testing.
    const user = await prisma.user.upsert({
      where: { email: acc.email },
      update: {
        passwordHash,
        name: acc.name,
        phone: acc.phone,
        role: acc.role,
        isActive: true,
      },
      create: {
        email: acc.email,
        name: acc.name,
        phone: acc.phone,
        passwordHash,
        role: acc.role,
      },
    });

    // Patients need an associated Patient row (with MR number) to log in
    // and see their portal. If the realistic seed never ran, this row is
    // missing — create a minimal one with a high MR number that won't clash
    // with the realistic-seed sequence (MR000001..).
    if (acc.role === Role.PATIENT) {
      const existingPatient = await prisma.patient.findUnique({
        where: { userId: user.id },
      });
      if (!existingPatient) {
        await prisma.patient.create({
          data: {
            userId: user.id,
            mrNumber: `MR900001`,
            gender: "MALE",
          },
        });
      }
    }

    touched++;
    console.log(
      `  [${acc.role.padEnd(11)}] ${acc.email} → ${acc.password} (id=${user.id})`
    );
  }

  console.log(`\nDone — ${touched} demo accounts ready.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => {
    prisma.$disconnect();
  });
