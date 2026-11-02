import { lstat, readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Reads a session's required artifact, or returns null if it doesn't count.
 * Only a non-empty, valid UTF-8 regular file inside the worktree counts: following a symlink,
 * in the file or in any folder on the way to it, could serve a file from elsewhere on the host.
 */
export async function readArtifact(worktreePath: string, relativePath: string): Promise<string | null> {
  try {
    const expected = join(await realpath(worktreePath), relativePath);
    if ((await realpath(expected)) !== expected) return null;
    if (!(await lstat(expected)).isFile()) return null;

    const content = await readFile(expected);
    if (content.length === 0) return null;
    const markdown = new TextDecoder('utf-8', { fatal: true }).decode(content);
    // Postgres text columns can't hold a NUL.
    return markdown.includes('\u0000') ? null : markdown;
  } catch {
    return null;
  }
}
