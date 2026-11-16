/**
 * Minimal protobuf wire-format reader for the GTFS-Realtime feeds we consume.
 * Fails closed on truncated input; values are read by the caller per field.
 */
export type Cursor = { i: number };

// Arithmetic (not bitwise) so 64-bit timestamps do not wrap at 2^31.
export function readVarint(buffer: Uint8Array, offset: Cursor): number {
  let result = 0;
  let multiplier = 1;
  for (let n = 0; n < 10; n += 1) {
    if (offset.i >= buffer.length) throw new Error("varint_truncated");
    const byte = buffer[offset.i++]!;
    result += (byte & 0x7f) * multiplier;
    if ((byte & 0x80) === 0) return result;
    multiplier *= 128;
  }
  throw new Error("varint_overflow");
}

/**
 * int32 fields: negatives travel as 10-byte two's complement varints, so only
 * the low 32 bits are meaningful. Reading them as a float would give ~1.8e19.
 */
export function readInt32(buffer: Uint8Array, offset: Cursor): number {
  let low = 0;
  for (let n = 0; n < 10; n += 1) {
    if (offset.i >= buffer.length) throw new Error("varint_truncated");
    const byte = buffer[offset.i++]!;
    const shift = n * 7;
    if (shift < 32) low = (low | ((byte & 0x7f) << shift)) >>> 0;
    if ((byte & 0x80) === 0) return low | 0;
  }
  throw new Error("varint_overflow");
}

function need(buffer: Uint8Array, offset: Cursor, bytes: number): void {
  if (offset.i + bytes > buffer.length) throw new Error("bytes_truncated");
}

export function readBytes(buffer: Uint8Array, offset: Cursor): Uint8Array {
  const length = readVarint(buffer, offset);
  need(buffer, offset, length);
  const start = offset.i;
  offset.i += length;
  return buffer.subarray(start, start + length);
}

export function readFloat32(buffer: Uint8Array, offset: Cursor): number {
  need(buffer, offset, 4);
  const value = new DataView(buffer.buffer, buffer.byteOffset + offset.i, 4).getFloat32(0, true);
  offset.i += 4;
  return value;
}

export function readFixed64(buffer: Uint8Array, offset: Cursor): number {
  need(buffer, offset, 8);
  const view = new DataView(buffer.buffer, buffer.byteOffset + offset.i, 8);
  offset.i += 8;
  return view.getUint32(4, true) * 2 ** 32 + view.getUint32(0, true);
}

export function skipField(buffer: Uint8Array, offset: Cursor, wireType: number): void {
  if (wireType === 0) readVarint(buffer, offset);
  else if (wireType === 1) {
    need(buffer, offset, 8);
    offset.i += 8;
  } else if (wireType === 2) readBytes(buffer, offset);
  else if (wireType === 5) {
    need(buffer, offset, 4);
    offset.i += 4;
  } else throw new Error(`unsupported_wire_${wireType}`);
}

const decoder = new TextDecoder("utf-8", { fatal: false });
export const text = (bytes: Uint8Array) => decoder.decode(bytes);

/** Iterates fields; values the consumer does not read are skipped. */
export function* fields(buffer: Uint8Array): Generator<[number, number, Cursor]> {
  const offset: Cursor = { i: 0 };
  while (offset.i < buffer.length) {
    const tag = readVarint(buffer, offset);
    const before = offset.i;
    yield [Math.floor(tag / 8), tag % 8, offset];
    if (offset.i === before) skipField(buffer, offset, tag % 8);
  }
}

/** Reads FeedHeader.timestamp (field 3); null when absent or not absolute. */
export function readHeaderTimestamp(header: Uint8Array): number | null {
  let timestamp: number | null = null;
  for (const [field, wire, at] of fields(header)) {
    if (field === 3 && wire === 0) timestamp = readVarint(header, at);
    else if (field === 3 && wire === 1) timestamp = readFixed64(header, at);
  }
  return timestamp !== null && timestamp >= 1_000_000_000 ? timestamp : null;
}
