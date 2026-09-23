import { describe, expect, it } from 'vitest';
import { releaseNotes } from '../../scripts/release-notes';

/** The shapes commit-and-tag-version writes: minor/major at `##`, patch at `###`, first with no link. */
const changelog = `# Changelog

One release per merged pull request.

## [1.1.0](https://github.com/x/y/compare/v1.0.1...v1.1.0) (2026-09-25)

### Features

* one ([abc1234](https://github.com/x/y/commit/abc1234))

### [1.0.1](https://github.com/x/y/compare/v1.0.0...v1.0.1) (2026-09-24)

### Bug Fixes

* two ([def5678](https://github.com/x/y/commit/def5678))

## 1.0.0 (2026-09-23)

### Features

* zero ([0123456](https://github.com/x/y/commit/0123456))
`;

describe('releaseNotes', () => {
  it('returns one version: its heading through to the line before the next version', () => {
    expect(releaseNotes(changelog, '1.1.0')).toBe(
      [
        '## [1.1.0](https://github.com/x/y/compare/v1.0.1...v1.1.0) (2026-09-25)',
        '',
        '### Features',
        '',
        '* one ([abc1234](https://github.com/x/y/commit/abc1234))',
      ].join('\n'),
    );
  });

  it('finds a patch release, which the generator writes as a level-3 heading', () => {
    expect(releaseNotes(changelog, '1.0.1')).toBe(
      [
        '### [1.0.1](https://github.com/x/y/compare/v1.0.0...v1.0.1) (2026-09-24)',
        '',
        '### Bug Fixes',
        '',
        '* two ([def5678](https://github.com/x/y/commit/def5678))',
      ].join('\n'),
    );
  });

  it('finds the first release, whose heading has no compare link, at the end of the file', () => {
    expect(releaseNotes(changelog, '1.0.0')).toBe(
      [
        '## 1.0.0 (2026-09-23)',
        '',
        '### Features',
        '',
        '* zero ([0123456](https://github.com/x/y/commit/0123456))',
      ].join('\n'),
    );
  });

  it('matches the whole version, not a prefix of another', () => {
    const withEleven = changelog.replace('## [1.1.0]', '## [11.1.0]');
    expect(releaseNotes(withEleven, '1.1.0')).toBeUndefined();
  });

  it('is undefined for a version the changelog does not have', () => {
    expect(releaseNotes(changelog, '2.0.0')).toBeUndefined();
  });
});
