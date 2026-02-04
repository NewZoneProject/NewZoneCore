// recovery.js — восстановление структуры env и ключей

import fs from 'fs/promises';
import path from 'path';
import readline from 'readline';

const ENV = path.resolve('env');
const KEYS = path.join(ENV, 'keys');

function ask(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise(resolve =>
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    })
  );
}

export async function resetEnvironment() {
  console.log('[reset] Removing env/…');

  await fs.rm(ENV, { recursive: true, force: true });

  console.log('[reset] Creating new env/ structure…');
  await fs.mkdir(KEYS, { recursive: true });

  console.log('[reset] Environment reset complete.');
}

export async function recoverFromSeed() {
  console.log('[recovery] Recovering from seed phrase…');

  const seed = await ask('Enter seed phrase: ');

  if (!seed) {
    console.log('[recovery] Seed phrase is empty.');
    process.exit(1);
  }

  const master = crypto.randomUUID(); // позже: derive(master, seed)

  await fs.mkdir(KEYS, { recursive: true });

  await fs.writeFile(path.join(ENV, 'master.key'), master);
  await fs.writeFile(path.join(ENV, 'seed.txt'), seed);
  await fs.writeFile(path.join(ENV, 'trust.json'), '{}');

  await fs.writeFile(path.join(KEYS, 'logging.key'), crypto.randomUUID());
  await fs.writeFile(path.join(KEYS, 'event.key'), crypto.randomUUID());
  await fs.writeFile(path.join(KEYS, 'queue.key'), crypto.randomUUID());

  console.log('[recovery] Keys restored from seed.');
}

export async function fullRecovery() {
  console.log('[recovery] Full recovery mode.');

  const seed = await ask('Enter seed phrase: ');

  if (!seed) {
    console.log('[recovery] Seed phrase is empty.');
    process.exit(1);
  }

  await resetEnvironment();
  await recoverFromSeed();
}