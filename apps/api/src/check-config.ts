import { loadConfig } from './config.js';
try { loadConfig(); }
catch (error) {
  console.error(JSON.stringify({ event: 'configuration_error', message: (error as Error).message }));
  process.exit(1);
}
