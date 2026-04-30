import 'dotenv/config';
import axios from 'axios';
import { JsonRpcProvider } from 'ethers';

const API_URL = required('API_URL');
const SOURCE_RPC_URL = required('SOURCE_RPC_URL');
const CHAIN_KEY = Number(required('CHAIN_KEY'));
const BLOCKS = Number(process.env.BLOCKS ?? '10');
const CONCURRENCY = Number(process.env.CONCURRENCY ?? '10');
const DURATION_S = Number(process.env.DURATION ?? '60');
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS ?? '10000');
const HEAD_OFFSET = Number(process.env.HEAD_OFFSET ?? '0');
const REFRESH_S = Number(process.env.REFRESH ?? '15');

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

const provider = new JsonRpcProvider(SOURCE_RPC_URL);
const http = axios.create({ baseURL: API_URL, timeout: TIMEOUT_MS });

type Pool = { hashes: string[]; refreshedAt: number };

async function refreshPool(): Promise<Pool> {
  const head = (await provider.getBlockNumber()) - HEAD_OFFSET;
  const start = Math.max(0, head - BLOCKS + 1);
  const blocks = await Promise.all(
    Array.from({ length: head - start + 1 }, (_, i) => provider.getBlock(start + i)),
  );
  const hashes = blocks.flatMap((b) => (b ? b.transactions.slice() : []));
  console.log(`pool refreshed: ${hashes.length} txs across blocks ${start}..${head}`);
  return { hashes, refreshedAt: Date.now() };
}

function pick(pool: Pool): string | undefined {
  if (pool.hashes.length === 0) return undefined;
  return pool.hashes[Math.floor(Math.random() * pool.hashes.length)];
}

const stats = { sent: 0, ok: 0, err: 0, statuses: new Map<string | number, number>() };

function bumpStatus(code: string | number) {
  stats.statuses.set(code, (stats.statuses.get(code) ?? 0) + 1);
}

async function fireOne(txHash: string) {
  stats.sent++;
  try {
    const res = await http.get(`/api/v1/proof-by-tx/${CHAIN_KEY}/${txHash}`);
    stats.ok++;
    bumpStatus(res.status);
  } catch (e: any) {
    stats.err++;
    bumpStatus(e?.response?.status ?? e?.code ?? 'ERR');
  }
}

async function worker(getPool: () => Pool, deadline: number) {
  while (Date.now() < deadline) {
    const tx = pick(getPool());
    if (!tx) {
      await new Promise((r) => setTimeout(r, 100));
      continue;
    }
    await fireOne(tx);
  }
}

async function main() {
  console.log(
    `stress-test: api=${API_URL} chainKey=${CHAIN_KEY} blocks=${BLOCKS} concurrency=${CONCURRENCY} duration=${DURATION_S}s`,
  );
  let pool = await refreshPool();
  const start = Date.now();
  const deadline = start + DURATION_S * 1000;

  const refreshTimer = setInterval(async () => {
    try {
      pool = await refreshPool();
    } catch (e) {
      console.error(`pool refresh failed: ${e}`);
    }
  }, REFRESH_S * 1000);

  const reportTimer = setInterval(() => {
    const elapsed = (Date.now() - start) / 1000;
    const rps = stats.sent / Math.max(elapsed, 0.001);
    console.log(
      `[${elapsed.toFixed(0)}s] sent=${stats.sent} ok=${stats.ok} err=${stats.err} rps=${rps.toFixed(1)}`,
    );
  }, 2000);

  await Promise.all(
    Array.from({ length: CONCURRENCY }, () => worker(() => pool, deadline)),
  );

  clearInterval(refreshTimer);
  clearInterval(reportTimer);

  const elapsed = (Date.now() - start) / 1000;
  console.log('\n=== done ===');
  console.log(`duration: ${elapsed.toFixed(1)}s`);
  console.log(`sent:     ${stats.sent}`);
  console.log(`ok:       ${stats.ok}`);
  console.log(`err:      ${stats.err}`);
  console.log(`rps:      ${(stats.sent / Math.max(elapsed, 0.001)).toFixed(1)}`);
  console.log('status codes:');
  for (const [code, n] of [...stats.statuses.entries()].sort()) {
    console.log(`  ${code}: ${n}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
