import assert from 'node:assert/strict';
import {appendFile, readFile} from 'node:fs/promises';

const metadata = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
);
assert.equal(
    process.env.RELEASE_TAG,
    `v${metadata.version}`,
    'Release tag must be v followed by the package.json version.',
);
const isPrerelease = metadata.version.includes('-');
assert.equal(
    process.env.RELEASE_PRERELEASE,
    String(isPrerelease),
    'GitHub prerelease status must match the version suffix.',
);
const distTag = isPrerelease ? 'next' : 'latest';
if (process.env.GITHUB_OUTPUT) {
  await appendFile(process.env.GITHUB_OUTPUT, `dist-tag=${distTag}\n`);
}
console.log(`Validated ${metadata.version}; npm dist-tag: ${distTag}`);
