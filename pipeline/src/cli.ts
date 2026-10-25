import { loadConfig } from './config.ts';
import { migrateAll } from './migrate.ts';

function usage(): never {
  console.error('usage: node src/cli.ts <migrate|collect> [--country <slug>] [--countries <n>]');
  process.exit(2);
}

const [command] = process.argv.slice(2);
if (command === undefined) usage();

if (command === 'migrate') {
  migrateAll();
} else if (command === 'collect') {
  const config = loadConfig();
  console.error(`collect: not wired in this milestone (${config.locations.length} locations known)`);
  process.exit(1);
} else {
  usage();
}
