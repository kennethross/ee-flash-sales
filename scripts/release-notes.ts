/**
 * Prints one version's section of CHANGELOG.md, for the GitHub Release created when its tag is
 * pushed (`.github/workflows/release.yml`). The release page and the changelog then cannot differ.
 *
 *   npx tsx scripts/release-notes.ts 1.1.0 [path/to/CHANGELOG.md]
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * A version heading as commit-and-tag-version writes them: `## [1.1.0](compare) (date)` for a
 * minor or major, `### [1.0.1](compare) (date)` for a patch, `## 1.0.0 (date)` for the first.
 */
const ANY_VERSION_HEADING = /^#{2,3} \[?\d+\.\d+\.\d+[\] (]/;

/** The section for `version`: its heading through the line before the next version's, or undefined. */
export function releaseNotes(changelog: string, version: string): string | undefined {
  const lines = changelog.split('\n');
  const heading = new RegExp(`^#{2,3} \\[?${version.replaceAll('.', '\\.')}[\\] (]`);
  const start = lines.findIndex((line) => heading.test(line));
  if (start === -1) {
    return undefined;
  }
  const after = lines.slice(start + 1);
  const next = after.findIndex((line) => ANY_VERSION_HEADING.test(line));
  const section = next === -1 ? lines.slice(start) : lines.slice(start, start + 1 + next);
  return section.join('\n').trimEnd();
}

const runAsScript =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (runAsScript) {
  const version = process.argv[2];
  if (version === undefined) {
    console.error('usage: release-notes.ts <version> [changelog]');
    process.exit(2);
  }
  const notes = releaseNotes(readFileSync(process.argv[3] ?? 'CHANGELOG.md', 'utf8'), version);
  if (notes === undefined) {
    console.error(`No CHANGELOG.md section for version ${version}.`);
    process.exit(1);
  }
  process.stdout.write(`${notes}\n`);
}
