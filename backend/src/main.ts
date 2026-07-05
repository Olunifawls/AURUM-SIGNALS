import { NestFactory } from '@nestjs/core';
import { loadRepoEnv } from './load-env';
import { AppModule } from './app.module';

// Load the repo-root .env before the app is created (the Supabase provider and
// external clients read process.env at DI/runtime, not at import time). No-op
// when no .env file exists (Docker/CI), so injected process.env wins.
loadRepoEnv();

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`AURUM SIGNALS backend listening on port ${port}`);
}

bootstrap();
