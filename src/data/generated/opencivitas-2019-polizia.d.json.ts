// Opaque on purpose: assertOpenCivitasFunctionSnapshot validates this JSON at
// runtime (digest, columns, dates). Letting tsc infer ~6.600 row tuples per
// function snapshot exhausts the default Node heap during typecheck.
declare const snapshot: unknown;
export default snapshot;
