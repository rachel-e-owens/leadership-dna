import { PrismaClient } from '@prisma/client';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { log } from './http.js';

const config = loadConfig();
const prisma = new PrismaClient();
const server = createApp(prisma, config).listen(config.port, () => {
  const address = server.address();
  log({ event: 'listening', address: `http://localhost:${typeof address === 'object' && address ? address.port : config.port}` });
});
