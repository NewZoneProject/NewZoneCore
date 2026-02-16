// Module: CLI Doc Generator
// Description: Generates Markdown documentation for nzcore CLI.
// Run: node core/cli/docgen.js
// File: core/cli/docgen.js

import fs from 'fs/promises';
import path from 'path';
import { commands } from './registry.js';

export async function generateCliDocs() {
  let md = '# NewZoneCore CLI\n\n';
  md += 'Автогенерируемая документация команд CLI.\n\n';
  md += '## Команды\n\n';

  for (const [name, meta] of Object.entries(commands)) {
    md += `### \`${name}\`\n\n`;
    md += `**Описание:** ${meta.desc}\n\n`;
    md += `**Использование:** \`${meta.usage}\`\n\n`;
    if (meta.details) {
      md += meta.details + '\n\n';
    }
  }

  const outPath = path.resolve('CLI.md');
  await fs.writeFile(outPath, md, 'utf8');
  console.log(`[docgen] CLI documentation written to ${outPath}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  generateCliDocs();
}