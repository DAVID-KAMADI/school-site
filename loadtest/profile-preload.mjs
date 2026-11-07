// Optional CPU profile of a server process, loaded with: node --import ./loadtest/profile-preload.mjs <server>
// PROFILE_OUT=<file.cpuprofile> PROFILE_DELAY_MS=<wait before starting> PROFILE_MS=<how long to record>
import { writeFileSync } from 'node:fs';
import { Session } from 'node:inspector/promises';

const out = process.env.PROFILE_OUT;
const ms = Number(process.env.PROFILE_MS || 0);
if (out && ms) {
  const session = new Session();
  session.connect();
  setTimeout(async () => {
    await session.post('Profiler.enable');
    await session.post('Profiler.setSamplingInterval', { interval: 500 });
    await session.post('Profiler.start');
    console.error(`[profile] recording ${ms} ms`);
    setTimeout(async () => {
      const { profile } = await session.post('Profiler.stop');
      writeFileSync(out, JSON.stringify(profile));
      console.error(`[profile] written to ${out}`);
    }, ms).unref();
  }, Number(process.env.PROFILE_DELAY_MS || 0)).unref();
}
