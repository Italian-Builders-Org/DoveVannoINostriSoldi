const DECIMAL = /^-?\d+(?:\.\d+)?$/;
function decimal(value) {
    if (!DECIMAL.test(value))
        throw new Error(`Numero decimale non valido: ${value}`);
    const negative = value.startsWith('-');
    const [whole, fraction = ''] = value.replace(/^-/, '').split('.');
    return { n: BigInt(whole + fraction) * (negative ? -BigInt(1) : BigInt(1)), d: BigInt(10) ** BigInt(fraction.length) };
}
/** Independent exact rational computation; no float in the report's calculation gate. */
export function calculateRounded(calculation) {
    if (calculation.inputs.length !== 2)
        throw new Error('Attesi due operandi');
    if (!Number.isInteger(calculation.roundDigits) || calculation.roundDigits < 0 || calculation.roundDigits > 8) {
        throw new Error('Precisione non valida');
    }
    const [a, b] = calculation.inputs.map(decimal);
    let n;
    let d;
    if (calculation.operation === 'difference') {
        n = a.n * b.d - b.n * a.d;
        d = a.d * b.d;
    }
    else {
        if (b.n === BigInt(0))
            throw new Error('Denominatore nullo');
        n = a.n * b.d;
        d = a.d * b.n;
        if (calculation.operation === 'relative-change-percent')
            n = (n - d) * BigInt(100);
        else if (calculation.operation === 'ratio-percent')
            n *= BigInt(100);
        else if (calculation.operation !== 'ratio')
            throw new Error('Operazione non ammessa');
    }
    if (d < BigInt(0)) {
        n = -n;
        d = -d;
    }
    const sign = n < BigInt(0) ? '-' : '';
    const magnitude = n < BigInt(0) ? -n : n;
    const scaled = magnitude * BigInt(10) ** BigInt(calculation.roundDigits);
    const rounded = scaled / d + ((scaled % d) * BigInt(2) >= d ? BigInt(1) : BigInt(0));
    const digits = rounded.toString().padStart(calculation.roundDigits + 1, '0');
    const formatted = calculation.roundDigits === 0 ? digits : `${digits.slice(0, -calculation.roundDigits)}.${digits.slice(-calculation.roundDigits)}`;
    return rounded === BigInt(0) ? formatted : sign + formatted;
}
