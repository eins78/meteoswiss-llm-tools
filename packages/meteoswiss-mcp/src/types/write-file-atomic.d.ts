/**
 * Minimal local typings for `write-file-atomic` v5, which ships no types of its
 * own. `@types/write-file-atomic` is still on v4, so declaring the slice we use
 * here avoids pinning a types package a major version behind the runtime — the
 * same approach already taken for `turndown-plugin-gfm`.
 *
 * Only the promise form is declared; the callback and `.sync` variants are
 * deliberately omitted so they cannot be used by accident.
 */
declare module 'write-file-atomic' {
  export interface WriteFileAtomicOptions {
    /** File mode for the created file. Defaults to the existing file's mode. */
    mode?: number;
    /** Encoding for string data. Defaults to 'utf8'. */
    encoding?: string;
    /** fsync the file before renaming. Defaults to true. */
    fsync?: boolean;
    /** Owner uid for the created file. */
    chown?: { uid: number; gid: number } | false;
  }

  /**
   * Write `data` to `filename` atomically: writes to a uniquely-named temp file
   * in the same directory, then renames it into place. The temp name mixes pid,
   * thread id and a monotonic counter, and concurrent writes to the same path
   * are serialised, so two writers can neither collide on a temp name nor leave
   * a torn file behind. Registers an exit handler that removes its own temp file
   * on a *clean* exit — `signal-exit` does not see SIGKILL, so an OOM-kill can
   * still orphan one.
   */
  export default function writeFileAtomic(
    filename: string,
    data: string | NodeJS.ArrayBufferView,
    options?: WriteFileAtomicOptions
  ): Promise<void>;
}
