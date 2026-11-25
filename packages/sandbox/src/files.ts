import { constants } from 'node:fs';
import { open } from 'node:fs/promises';

// Reads a file that untrusted code may have written: a regular file only,
// never through a symlink (O_NOFOLLOW, so nothing can swap one in between a
// check and the read), and null when it's larger than `maxBytes`, missing,
// or anything other than a regular file.
export const readRegularFile = async (
  path: string,
  maxBytes = Number.POSITIVE_INFINITY
): Promise<Buffer | null> => {
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
  ).catch(() => null);
  if (!handle) return null;
  try {
    const s = await handle.stat();
    if (!s.isFile() || s.size > maxBytes) return null;
    return await handle.readFile();
  } finally {
    await handle.close();
  }
};
