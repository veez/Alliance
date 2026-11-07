import { BadRequestException, Global, Injectable, Module, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, ReadStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';

export interface UploadedFileLike {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

/**
 * Хранилище файлов. Сейчас — локальный диск (STORAGE_DIR); драйвер S3/MinIO подключается
 * на этапе документов без изменения API (меняются только save/open).
 */
@Injectable()
export class FilesService {
  private readonly root = resolve(process.cwd(), env.storageDir);

  constructor(private readonly prisma: PrismaService) {}

  async save(file: UploadedFileLike, uploadedById: string | null, opts: { allowedMime?: RegExp; maxBytes?: number } = {}) {
    if (opts.maxBytes && file.size > opts.maxBytes) throw new BadRequestException(`Файл больше ${Math.round(opts.maxBytes / 1024 / 1024)} МБ`);
    if (opts.allowedMime && !opts.allowedMime.test(file.mimetype)) throw new BadRequestException('Недопустимый тип файла');
    const now = new Date();
    const storageKey = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}`;
    const path = join(this.root, storageKey);
    mkdirSync(dirname(path), { recursive: true });
    await writeFile(path, file.buffer);
    // Имя файла из multipart приходит в latin1 — восстанавливаем UTF-8 (кириллические имена).
    const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    return this.prisma.file.create({
      data: {
        storageKey,
        originalName,
        mime: file.mimetype,
        size: file.size,
        sha256: createHash('sha256').update(file.buffer).digest('hex'),
        uploadedById,
      },
    });
  }

  async open(fileId: string): Promise<{ stream: ReadStream; mime: string; name: string; size: number }> {
    const file = await this.prisma.file.findUnique({ where: { id: fileId } });
    const path = file ? join(this.root, file.storageKey) : '';
    if (!file || !existsSync(path)) throw new NotFoundException('Файл не найден');
    return { stream: createReadStream(path), mime: file.mime, name: file.originalName, size: file.size };
  }
}

@Global()
@Module({ providers: [FilesService], exports: [FilesService] })
export class FilesModule {}
