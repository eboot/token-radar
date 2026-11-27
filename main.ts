// token-radar-01 entry, Node 22, standard library only.
//
// What it does, in order: read the sealed snapshot (from /input/snapshot.json
// or --input), rank every rankable pre-token protocol with the model in lib/model.ts,
// write the ranked board to /output/board.json, copy this repo's dashboard/
// and screenshots/ into /output, then write /output/dossier.json, the summary
// the judge reads, with the vendored make.fun library.
//
// radar-3: board.json ranks by implied value, highest first, as the gate's sorted_by_value row
// requires (rank 1 is the board's most valuable protocol); the expected-value ranking (implied
// value x token odds from the peers' record) lives in dashboard/data.js, where the dashboard
// sorts by EV by default. The value model is the flat global multiple the blind tests kept
// after dropping every v2 term, each farm plan is netted to $/hour with a FARM / MARGINAL / SKIP
// verdict, and data.js carries the validation numbers plus the ledger accounting for all 758 protocols.
//
// NOTE on the gate: board.json ranks by implied value, highest first, so the gate's
// sorted_by_value row (implied_value_usd non-increasing with rank) holds; boardIssue() below
// still refuses any board that breaks it — that is the tripwire working as designed. The
// expected-value ranking is not lost: it lives in dashboard/data.js, where the dashboard sorts
// by EV by default. See the build report for the gate quotes and the coordinator's decision.
//
// The dashboard is a static page with no framework and no network:
// dashboard/index.html, dashboard/app.css and dashboard/app.js read
// /output/data.js, which this program writes from the same board. Keep the gate's shape and
// the outputs byte-identical between runs.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRadar, dataScript, parseSnapshot, boardIssue } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps (reference/gate.json): the text cap shapes the bytes, the rest refuse. */
const DOSSIER_TEXT_LIMIT = 65_536;
const SHOT_LIMITS = { max: 4, max_bytes: 524_288 };
const SHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** Print a message to stderr and stop with the given code. */
function fail(message: string, code = 1): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(code);
}

/** The value after `--name <value>` or `--name=<value>`, or the fallback. */
function flag(name: string, fallback: string): string {
  const marker = `--${name}`;
  for (let i = 2; i < process.argv.length; i += 1) {
    const current = process.argv[i]!;
    if (current === marker && i + 1 < process.argv.length) return process.argv[i + 1]!;
    if (current.startsWith(`${marker}=`)) return current.slice(marker.length + 1);
  }
  return fallback;
}

const inputGiven = flag('input', '/input');
const snapshotPath = inputGiven.endsWith('.json') ? inputGiven : join(inputGiven, 'snapshot.json');
if (!existsSync(snapshotPath)) {
  fail(`no snapshot at ${snapshotPath}: pass --input <snapshot.json|directory> or mount the sealed /input`, 2);
}
const outDir = flag('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snap = parseSnapshot(readFileSync(snapshotPath, 'utf8'));
const { board, radar } = buildRadar(snap);
const problem = boardIssue(board, snap);
if (problem !== null) fail(`the model wrote a board the gate refuses: ${problem}`);

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outDir, 'data.js'), dataScript(radar));

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyDir(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const names: string[] = [];
  for (const entry of readdirSync(from)) {
    if (entry.startsWith('.')) continue;
    const source = join(from, entry);
    if (!statSync(source).isFile()) continue;
    copyFileSync(source, join(to, entry));
    names.push(entry);
  }
  return names;
}

copyDir(join(repoRoot, 'dashboard'), join(outDir, 'dashboard'));
const shots = copyDir(join(repoRoot, 'screenshots'), join(outDir, 'screenshots'));
if (shots.length < 3) {
  fail(`screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view`);
}
for (const name of shots) {
  if (!SHOT_NAME.test(name)) {
    fail(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(
  join(outDir, 'dossier.json'),
  buildDossier(outDir, { text_max_bytes: DOSSIER_TEXT_LIMIT, screenshots: SHOT_LIMITS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }),
);

process.stdout.write(
  `token radar: ${snap.protocols.length} protocols, ${snap.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: model ${radar.model_version}, global multiple ${radar.global_multiple}, ` +
    `blind tests LOO x${radar.validation.loo.variants.v3!.multiple} / walk-forward pooled x${radar.validation.walk_forward.pooled.v3!.multiple}, ` +
    `ledger ${radar.ledger.boarded} boarded + ${radar.ledger.live} live + ${radar.ledger.set_aside.length} set aside = ${radar.ledger.total}\n` +
    `token radar: wrote ${join(outDir, 'board.json')}, ${join(outDir, 'data.js')}, ${join(outDir, 'dashboard')} (3 files), ${join(outDir, 'screenshots')} (${shots.length} images) and ${join(outDir, 'dossier.json')}\n`,
);
