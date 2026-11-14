// Token Radar (RADAR-2): read the sealed snapshot, score it, write the board.
//
// The program takes the snapshot from /input/snapshot.json (or --input <file|dir>),
// ranks every pre-token protocol that fits the watchlist's own definition with the
// model in lib/model.ts, and writes the ranked board to /output/board.json. It puts
// the dashboard's data beside the page as data.js, copies this repository's
// dashboard/ and screenshots/ into /output, and finishes with /output/dossier.json,
// the summary the judge reads, built with the vendored make.fun library.
//
// The board is a model, not a promise: an implied value is what a token would be
// worth if the protocol's record stayed as it is. It says nothing about whether or
// when a token is issued.
//
// Away from the grader's container, MAKEFUN_OUTPUT_DIR takes the place of /output:
//   mkdir -p out; MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
//
// The program is deterministic: the same snapshot bytes in give the same bytes out,
// so the grader's two runs write identical files.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assembleRadar, radarScript, readSnapshot, validateBoard } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const ROOT = fileURLToPath(new URL('.', import.meta.url));

// The scorer's own caps: the text cap shapes the bytes, the rest refuse.
const TEXT_CAP = 65_536;
const SHOT_CAP = { max: 4, max_bytes: 524_288 };
const SHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

// The value after `--name <value>` or `--name=<value>`, or the fallback when absent.
function flagValue(name: string, fallback: string): string {
  const args = process.argv;
  const at = args.indexOf('--' + name);
  if (at >= 0 && at + 1 < args.length) return args[at + 1]!;
  const joined = args.find((a) => a.startsWith('--' + name + '='));
  if (joined === undefined) return fallback;
  return joined.slice(name.length + 3);
}

// Complain on stderr and stop with a code; never throws past this point.
function fail(message: string, code: number): never {
  process.stderr.write(message + '\n');
  process.exit(code);
}

// Copy one directory's regular files into `to`, skipping names that start with a dot,
// and hand back the names that were copied.
function copyDir(from: string, to: string): string[] {
  if (!fs.existsSync(from)) return [];
  fs.mkdirSync(to, { recursive: true });
  const names = fs.readdirSync(from).filter((name) => !name.startsWith('.'));
  const done: string[] = [];
  for (const name of names) {
    const src = path.join(from, name);
    if (!fs.statSync(src).isFile()) continue;
    fs.copyFileSync(src, path.join(to, name));
    done.push(name);
  }
  return done;
}

function main(): void {
  const inputFlag = flagValue('input', '/input');
  const inputFile = inputFlag.endsWith('.json') ? inputFlag : path.join(inputFlag, 'snapshot.json');
  if (!fs.existsSync(inputFile)) {
    fail(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input`, 2);
  }
  const outDir = flagValue('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

  // Score the snapshot first: a board the gate refuses is caught here, before anything is written.
  const snap = readSnapshot(fs.readFileSync(inputFile, 'utf8'));
  const { board, radar } = assembleRadar(snap);
  const problem = validateBoard(board, snap);
  if (problem !== null) fail(`token radar: the model wrote a board the gate refuses: ${problem}`, 1);

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'board.json'), JSON.stringify({ rows: board }) + '\n');
  fs.writeFileSync(path.join(outDir, 'data.js'), radarScript(radar));

  const dashFiles = copyDir(path.join(ROOT, 'dashboard'), path.join(outDir, 'dashboard'));
  const shots = copyDir(path.join(ROOT, 'screenshots'), path.join(outDir, 'screenshots'));
  if (shots.length < 3) {
    fail(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view`, 1);
  }
  for (const name of shots) {
    if (!SHOT_NAME.test(name)) {
      fail(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`, 1);
    }
  }

  // The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
  fs.writeFileSync(
    path.join(outDir, 'dossier.json'),
    buildDossier(outDir, { text_max_bytes: TEXT_CAP, screenshots: SHOT_CAP, dashboard: { max_files: 400, max_bytes: 4_194_304 } }),
  );

  process.stdout.write(
    `token radar: scored ${board.length} rows from ${snap.entries.length} protocols (${snap.watch.length} watchlist, ${radar.early_size} early, ${radar.live_size} live set aside)\n` +
      `token radar: wrote ${path.join(outDir, 'board.json')}, ${path.join(outDir, 'data.js')}, ${path.join(outDir, 'dashboard')} (${dashFiles.length} files), ${path.join(outDir, 'screenshots')} (${shots.length} images) and ${path.join(outDir, 'dossier.json')}\n`,
  );
}

main();
