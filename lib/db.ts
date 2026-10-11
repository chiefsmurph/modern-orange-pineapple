// lib/db.ts
//
// Redeem codes live OUTSIDE the code tree so a deploy can never overwrite them.
//   MOP_DATA_DIR  — directory holding codes.json (default: ./data, gitignored).
//                   Production sets it to /var/lib/mopclothing (systemd StateDirectory).
// On first use, if codes.json is missing but a legacy ./db.json exists (the old
// in-repo location), it is copied over once. The legacy file is left untouched.
import { promises as fs } from 'fs';
import path from 'path';

export type Code = {
  value: string;
  redeemed: boolean;
  redeemedAt: string | null;
  user: { name: string; fact: string } | null;
};

const DATA_DIR = path.resolve(process.env.MOP_DATA_DIR || path.join(process.cwd(), 'data'));
const FILE = path.join(DATA_DIR, 'codes.json');
const LEGACY_FILE = path.join(process.cwd(), 'db.json');

let storeReady: Promise<void> | null = null;

function ensureStore(): Promise<void> {
  if (!storeReady) {
    storeReady = (async () => {
      await fs.mkdir(DATA_DIR, { recursive: true });
      try {
        await fs.access(FILE);
        return; // already migrated / in use
      } catch {
        // no codes.json yet — fall through to the one-time legacy migration
      }
      let legacy: string;
      try {
        legacy = await fs.readFile(LEGACY_FILE, 'utf8');
      } catch {
        return; // nothing to migrate; codes.json is created on first write
      }
      JSON.parse(legacy); // refuse to migrate a corrupt file
      try {
        await fs.writeFile(FILE, legacy, { flag: 'wx' }); // never clobber an existing store
        console.log(`[codes] migrated legacy ${LEGACY_FILE} -> ${FILE}`);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      }
    })().catch((err) => {
      storeReady = null; // retry on the next call
      throw err;
    });
  }
  return storeReady;
}

export async function readCodes(): Promise<Code[]> {
  try {
    await ensureStore();
    const data = await fs.readFile(FILE, 'utf8');
    return JSON.parse(data).codes || [];
  } catch {
    return [];
  }
}

export async function writeCodes(codes: Code[]) {
  await ensureStore();
  // write-then-rename so a crash mid-write can't truncate the list
  const tmp = `${FILE}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify({ codes }, null, 2));
  await fs.rename(tmp, FILE);
}

export function generateCode(existingCodes: Code[]): Code['value'] {
  const animals = ['FOX', 'OWL', 'DOG', 'BAT', 'ANT', 'CAT', 'RAM', 'COW', 'HEN'];
  const safeNumbers = '23678'; // Only numbers 2, 3, 6, 7, 8 to avoid confusion with '4', '9', '0'

  let newCode: string | undefined;
  let isDuplicate = true;

  // Keep generating until we find a unique code
  while (isDuplicate) {
    const animal = animals[Math.floor(Math.random() * animals.length)];
    const nums = Array.from({ length: 2 }, () =>
      safeNumbers[Math.floor(Math.random() * safeNumbers.length)]
    ).join('');

    newCode = `${animal}-${nums}`;

    // Check if the new code already exists in the database
    isDuplicate = existingCodes.some((code) => code.value === newCode);
  }

  return newCode;
}

export const ADMIN_SECRET = process.env.ADMIN_SECRET || 'alphabetsoup';
