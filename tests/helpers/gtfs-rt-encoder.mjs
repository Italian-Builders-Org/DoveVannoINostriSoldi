// Minimal protobuf writer: the fixture mirrors the field layout observed in the
// official Roma Mobilità VehiclePositions feed (GTFS-RT 2.0), so the parser is
// checked against the spec numbering rather than against its own assumptions.
export function varint(value) {
  const out = [];
  // Negative int32/int64 are sent as 10-byte two's complement varints.
  let v = BigInt.asUintN(64, BigInt(value));
  do {
    let byte = Number(v & 0x7fn);
    v >>= 7n;
    if (v > 0n) byte |= 0x80;
    out.push(byte);
  } while (v > 0n);
  return out;
}
export const tag = (field, wire) => varint((field << 3) | wire);
export const vField = (field, value) => [...tag(field, 0), ...varint(value)];
export const sField = (field, text) => {
  const bytes = [...new TextEncoder().encode(text)];
  return [...tag(field, 2), ...varint(bytes.length), ...bytes];
};
export const mField = (field, bytes) => [...tag(field, 2), ...varint(bytes.length), ...bytes];
export const fField = (field, value) => {
  const buf = new DataView(new ArrayBuffer(4));
  buf.setFloat32(0, value, true);
  return [...tag(field, 5), ...new Uint8Array(buf.buffer)];
};
export const dField = (field, value) => {
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, value, true);
  return [...tag(field, 1), ...new Uint8Array(buf.buffer)];
};
