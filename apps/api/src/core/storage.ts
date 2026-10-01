import { createReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { env } from '../config/env.js';

/**
 * Storage abstraction for attachments. Only the local provider is implemented;
 * S3 / Azure Blob / SharePoint providers can implement the same interface later
 * and be selected by configuration without touching business code.
 */
export interface StorageProvider {
  readonly name: string;
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  getStream(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
}

export class LocalStorageProvider implements StorageProvider {
  readonly name = 'local';

  constructor(private readonly root: string) {}

  /** Resolves a key inside the root; rejects traversal attempts. */
  private resolve(key: string): string {
    if (!/^[A-Za-z0-9/_.-]+$/.test(key) || key.includes('..')) throw new Error('Invalid storage key');
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root) + path.sep)) throw new Error('Invalid storage key');
    return full;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, data, { flag: 'wx' }); // never overwrite
  }

  async getStream(key: string): Promise<Readable> {
    const full = this.resolve(key);
    await stat(full); // throws if missing
    return createReadStream(full);
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }
}

let provider: StorageProvider = new LocalStorageProvider(env.fileStoragePath);

export function storage(): StorageProvider {
  return provider;
}

/** Test hook. */
export function setStorageProvider(p: StorageProvider): void {
  provider = p;
}
