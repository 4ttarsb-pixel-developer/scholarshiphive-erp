import crypto from 'node:crypto';
import multer from 'multer';
import { tx } from '../db.js';
import { bad } from './http.js';

const MB = 1024 * 1024;

/** Multer keeps files in memory; we validate the real content before anything is written to disk. */
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * MB, files: 8, fields: 60, fieldSize: 64 * 1024 },
});

// ── Content sniffing (checks the actual bytes, not the file name) ──
function sniff(buf) {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.length >= 5 && buf.toString('ascii', 0, 5) === '%PDF-') return 'application/pdf';
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) {
    if (buf.includes(Buffer.from('word/'))) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    return 'application/zip';
  }
  return null;
}

/** Returns {width,height} for png/jpeg/webp or null if the image is broken. */
export function imageSize(buf, mime) {
  try {
    if (mime === 'image/png') return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    if (mime === 'image/jpeg') {
      let i = 2;
      while (i < buf.length - 9) {
        if (buf[i] !== 0xff) { i++; continue; }
        const marker = buf[i + 1];
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
        const len = buf.readUInt16BE(i + 2);
        if ((marker >= 0xc0 && marker <= 0xcf) && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
        }
        i += 2 + len;
      }
      return null;
    }
    if (mime === 'image/webp') {
      const chunk = buf.toString('ascii', 12, 16);
      if (chunk === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
      if (chunk === 'VP8L') { const b = buf.readUInt32LE(21); return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 }; }
      if (chunk === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
    }
  } catch { /* fall through */ }
  return null;
}

const RULES = {
  photo: { types: ['image/jpeg', 'image/png', 'image/webp'], max: 2 * MB, label: 'Profile picture', hint: 'JPG, PNG or WEBP up to 2 MB' },
  cv: { types: ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'], max: 3 * MB, label: 'CV', hint: 'PDF or DOCX up to 3 MB' },
  document: { types: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'], max: 3 * MB, label: 'Document', hint: 'PDF, JPG, PNG or WEBP up to 3 MB' },
  expense_receipt: { types: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'], max: 3 * MB, label: 'Receipt', hint: 'PDF, JPG, PNG or WEBP up to 3 MB' },
  petty_receipt: { types: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'], max: 3 * MB, label: 'Receipt', hint: 'PDF, JPG, PNG or WEBP up to 3 MB' },
  owner_image: { types: ['image/jpeg', 'image/png', 'image/webp'], max: 3 * MB, label: 'Image', hint: 'JPG, PNG or WEBP up to 3 MB' },
  owner_cv: { types: ['application/pdf'], max: 3 * MB, label: 'CV', hint: 'PDF up to 3 MB' },
  sale_document: { types: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'], max: 3 * MB, label: 'Document', hint: 'PDF, JPG, PNG, WEBP or DOCX up to 3 MB' },
};
const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'application/pdf': '.pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx' };

/** Validates file authenticity (real type, not corrupted, size, sensible image dimensions). */
export function checkFile(file, kind) {
  const rule = RULES[kind];
  if (!rule) throw new Error('Unknown file kind ' + kind);
  if (!file || !file.buffer?.length) throw bad(`${rule.label} file is empty.`);
  if (file.size > rule.max) throw bad(`${rule.label} is too large (${rule.hint}).`);
  const mime = sniff(file.buffer);
  if (!mime || !rule.types.includes(mime)) throw bad(`${rule.label} "${file.originalname}" is not a genuine ${rule.hint} file. Renamed or fake files are not accepted.`);
  if (mime.startsWith('image/')) {
    const dim = imageSize(file.buffer, mime);
    if (!dim || !dim.width || !dim.height) throw bad(`${rule.label} "${file.originalname}" appears to be damaged. Please upload a clear image.`);
    const minSide = kind === 'photo' || kind === 'owner_image' ? 200 : 300;
    if (Math.min(dim.width, dim.height) < minSide) throw bad(`${rule.label} resolution is too low (${dim.width}×${dim.height}). Minimum ${minSide}px on each side.`);
    if (kind === 'photo') {
      const ratio = dim.width / dim.height;
      if (ratio < 0.5 || ratio > 2) throw bad('Profile picture must be a normal portrait/square photo (not a banner or screenshot strip).');
    }
  }
  if (mime === 'application/pdf') {
    const tail = file.buffer.subarray(Math.max(0, file.buffer.length - 2048)).toString('latin1');
    if (!tail.includes('%%EOF')) throw bad(`${rule.label} "${file.originalname}" is an incomplete/corrupted PDF.`);
    if (/\/Encrypt\b/.test(file.buffer.toString('latin1', 0, Math.min(file.buffer.length, 200000)))) throw bad(`${rule.label} "${file.originalname}" is password-protected. Please upload an unlocked copy.`);
  }
  return mime;
}

/** Stores an already-checked file inside the database (bytea) and records it. Returns the files row. */
export async function saveFile(db, file, kind, ownerId) {
  const mime = checkFile(file, kind);
  const sha256 = crypto.createHash('sha256').update(file.buffer).digest('hex');
  const dup = (await db.query('SELECT id FROM files WHERE sha256=$1 ORDER BY id LIMIT 1', [sha256])).rows[0];
  const stored = `${kind}-${Date.now()}-${crypto.randomBytes(8).toString('hex')}${EXT[mime]}`;
  const original = (file.originalname || 'file').replace(/[^\w.\- ()]/g, '_').slice(0, 200);
  const r = await db.query(
    `INSERT INTO files(owner_id,kind,original_name,stored_name,mime,size_bytes,sha256,duplicate_of,data)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, kind, original_name, mime, size_bytes, duplicate_of, verify_status`,
    [ownerId || null, kind, original, stored, mime, file.size, sha256, dup?.id || null, file.buffer]);
  return r.rows[0];
}

export async function removeStoredFile() { /* nothing on disk any more — the row is removed with the transaction */ }

/** Transaction that deletes any files written during it if the transaction fails. */
export async function txWithFiles(fn) {
  const written = [];
  try {
    return await tx(async client => {
      client.writtenFiles = written;
      try { return await fn(client); } finally { delete client.writtenFiles; }
    });
  } catch (e) {
    for (const f of written) await removeStoredFile(f);
    throw e;
  }
}

