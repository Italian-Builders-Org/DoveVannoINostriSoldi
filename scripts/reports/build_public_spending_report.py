#!/usr/bin/env python3
"""Build frozen editorial assets offline from one canonical report, or verify them.

Requires reportlab for PDF generation. Does not crawl, refresh sources or publish.
--check validates arithmetic/provenance and the committed derivative hashes; it
needs no PDF/font dependency and never rewrites an asset.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import html
import io
import json
import re
from decimal import Decimal, ROUND_HALF_UP, localcontext
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]
CANONICAL = Path('src/content/reports/public-spending-2026.json')
MANIFEST = Path('public/data/reports/public-spending-2026.manifest.json')


def rounded_calculation(c: dict[str, Any]) -> str:
    if len(c['inputs']) != 2 or not 0 <= c['roundDigits'] <= 8:
        raise ValueError('Operandi o precisione non validi')
    with localcontext() as context:
        context.prec = 50
        a, b = map(Decimal, c['inputs'])
        operations = {
            'difference': lambda: a - b, 'ratio': lambda: a / b,
            'ratio-percent': lambda: a / b * 100,
            'relative-change-percent': lambda: (a / b - 1) * 100,
        }
        if c['operation'] not in operations:
            raise ValueError('Operazione sconosciuta')
        result = operations[c['operation']]()
        return format(result.quantize(Decimal(1).scaleb(-c['roundDigits']), rounding=ROUND_HALF_UP), 'f')


def bound_value(report: dict, reference: list[str]) -> Decimal:
    if reference[0] == 'constant':
        if reference != ['constant', '100']:
            raise ValueError('Costante non autorizzata')
        return Decimal('100')
    if reference == ['macro', 'total']:
        return Decimal(report['macro']['totalBillionRounded'])
    if reference[0] == 'sum':
        codes = reference[1:]
        if len(codes) != len(set(codes)):
            raise ValueError('Duplicato nella somma delle funzioni')
        values = {s['code']: Decimal(s['amountBillionRounded']) for s in report['sections']}
        return sum((values[code] for code in codes), Decimal('0'))
    fact = next(f for f in report['facts'] if f['id'] == reference[0])
    return Decimal(next(m['value'] for m in fact['metrics'] if m['key'] == reference[1]))


def validate(report: dict) -> None:
    def demand(condition: bool, message: str) -> None:
        if not condition:
            raise ValueError(message)
    demand(report['schemaVersion'] == 1, 'Schema sconosciuto')
    demand(report['reportId'] == 'public-spending-2026', 'Identità sconosciuta')
    demand(report['scope']['transactionAuditCoverage'] is None, 'Copertura transazioni non misurata')
    demand(report['noSavingsTotal'] is True, 'Totale di risparmi non supportato')
    demand('\u2014' not in json.dumps(report, ensure_ascii=False), 'Em dash nel contenuto')
    demand(sorted(s['code'] for s in report['sections']) == [f'GF{i:02}' for i in range(1, 11)], 'Copertura COFOG')
    for name in ('sources', 'facts', 'calculations'):
        ids = [item['id'] for item in report[name]]
        demand(len(ids) == len(set(ids)), f'ID duplicato in {name}')
    sources = {s['id']: s for s in report['sources']}
    facts = {f['id']: f for f in report['facts']}
    calc_ids = {c['id'] for c in report['calculations']}
    def refs(ids: list[str]) -> None:
        demand(bool(ids) and all(i in sources for i in ids), 'Fonte non risolta')
    for source in sources.values():
        url = urlsplit(source['url'])
        demand(url.scheme == 'https' and bool(url.hostname) and not url.username and not url.password, 'URL non sicuro')
        demand(bool(source['locator']) and bool(source['verificationChannel']), 'Provenienza incompleta')
        demand(source['publicationDate'] is None or source['publicationDate'] <= report['referenceDate'], 'Fonte successiva al cutoff')
    for fact in facts.values():
        refs(fact['sourceIds'])
        demand(fact['kind'] in report['assessmentLabels'], 'Qualifica mancante')
        demand(bool(fact['referencePeriod']) and bool(fact['scope']) and bool(fact['limitation']), 'Perimetro incompleto')
        demand(not fact['calculationId'] or fact['calculationId'] in calc_ids, 'Calcolo mancante')
        for metric in fact['metrics']:
            demand(bool(re.fullmatch(r'-?\d+(\.\d+)?', metric['value'])), 'Metrica non decimale')
    for c in report['calculations']:
        refs(c['sourceIds'])
        demand(rounded_calculation(c) == c['roundedResult'], f'Calcolo {c["id"]} non riconciliato')
        demand(len(c['inputRefs']) == len(c['inputs']), 'Provenienza degli operandi incompleta')
        demand(all(bound_value(report, ref) == Decimal(value) for ref, value in zip(c['inputRefs'], c['inputs'])), f'Operandi {c["id"]} scollegati dalle evidenze')
    referenced_facts: set[str] = set()
    for s in [*report['sections'], report['municipal']]:
        refs(s['sourceIds'])
        demand(all(f in facts for f in s['factIds']), 'Fatto non risolto')
        demand(bool(s['actions']) and bool(s['owner']) and bool(s['kpi']), 'Intervento incompleto')
        referenced_facts.update(s['factIds'])
    demand(referenced_facts == set(facts), 'Fatto orfano')
    for s in report['sections']:
        demand(bool(re.fullmatch(r'\d+\.\d{2}', s['amountBillionRounded'])), 'Unità monetaria errata')
    refs(report['macro']['sourceIds'])
    for p in report['priorities']:
        refs(p['sourceIds'])
    demand(Decimal(report['macro']['totalBillionRounded']) > 0, 'Totale non positivo')
    for key in ('pdfPath', 'jsonPath', 'csvPath'):
        path = report[key]
        demand(path.startswith('/') and not path.startswith('//') and '..' not in Path(path).parts, 'Path non valido')


def it(value: str, digits: int = 2) -> str:
    n = Decimal(value).quantize(Decimal(1).scaleb(-digits), rounding=ROUND_HALF_UP)
    text = f'{n:,.{digits}f}'
    return text.replace(',', '_').replace('.', ',').replace('_', '.')


def source_ids(ids: list[str]) -> str:
    return 'Fonti: ' + ', '.join(ids) + '.'


def markdown(report: dict) -> str:
    lines = [f'# {report["title"]}', '', report['subtitle'], '',
             f'**Edizione: {report["edition"]}. Bozza per revisione editoriale.**', '', report['scope']['coverage'], '',
             '## Quadro d’insieme', *sum(([p, ''] for p in report['executive']), []),
             'Calcoli di composizione: C07 e C08. Fonti: S01, S04, S06, S08, S10, S12, S13.', '',
             '## Mappa della spesa', '', 'Miliardi di euro, 2024. Competenza economica SEC 2010, PA S13.', '',
             '| Funzione | Miliardi € | Quota % |', '|---|---:|---:|']
    for s in report['sections']:
        share = rounded_calculation({'operation': 'ratio-percent', 'inputs': [s['amountBillionRounded'], report['macro']['totalBillionRounded']], 'roundDigits': 1})
        lines.append(f'| {s["code"]} {s["title"]} | {it(s["amountBillionRounded"])} | {it(share, 1)} |')
    lines += [f'| Totale ufficiale | {it(report["macro"]["totalBillionRounded"])} | 100,0 |', '', report['macro']['reconciliation'], 'Fonti S01, S02.', '', '## Priorità']
    for p in report['priorities']:
        lines += ['', f'### {p["title"]}', p['scope'], '', p['action'], '', p['tradeoff'], source_ids(p['sourceIds'])]
    facts = {f['id']: f for f in report['facts']}
    for s in [*report['sections'], report['municipal']]:
        lines += ['', f'## {s.get("code", "Trasversale")} · {s["title"]}', '']
        if 'amountBillionRounded' in s:
            lines += [f'{it(s["amountBillionRounded"])} miliardi di euro, COFOG 2024.', '', f'### {s["headline"]}', '']
        for fid in s['factIds']:
            f = facts[fid]
            lines += [f'**{fid} · {f["title"]}.** {f["text"]}', f'Periodo: {f["referencePeriod"]}. {f["scope"]}. {f["limitation"]}', source_ids(f['sourceIds']), '']
        lines += ['### Analisi', *sum(([p, ''] for p in s['analysis']), []), '### Dove intervenire', '']
        lines += [f'{i}. {action}' for i, action in enumerate(s['actions'], 1)]
        lines += ['', f'**Responsabili:** {s["owner"]}', f'**Indicatore:** {s["kpi"]}', f'**Risorse liberabili:** {s["quantification"]}', s['limitations'], source_ids(s['sourceIds'])]
    lines += ['', '## Metodo', *sum(([p, ''] for p in report['methodology']), []), '## Calcoli', '']
    for c in report['calculations']:
        lines += [f'### {c["id"]} · {c["display"]}', c['description'], f'Operazione: `{c["operation"]}`. Operandi: {" ; ".join(c["inputs"])}.', source_ids(c['sourceIds']), '']
    lines += ['## Fonti', '']
    for s in report['sources']:
        lines += [f'### {s["id"]} · {s["holder"]}', f'[{s["title"]}]({s["url"]})',
                  f'Periodo: {s["referencePeriod"]}. Pubblicazione: {s["publicationDate"] or "non dichiarata"}. Consultata: {s["checkedAt"]}.',
                  s['locator'], s['note'], f'Modalità di verifica: {s["verificationChannel"]}. {s["rights"]}', '']
    return '\n'.join(lines).rstrip() + '\n'


def claims_csv(report: dict) -> str:
    output = io.StringIO(newline='')
    writer = csv.writer(output, lineterminator='\n')
    writer.writerow(['id', 'qualifica', 'titolo', 'testo', 'periodo', 'perimetro', 'fonti', 'calcolo', 'limiti'])
    for f in report['facts']:
        # Prevent spreadsheet formula interpretation of externally sourced strings.
        row = [f['id'], f['kind'], f['title'], f['text'], f['referencePeriod'], f['scope'], '|'.join(f['sourceIds']), f['calculationId'] or '', f['limitation']]
        writer.writerow(["'" + v if v.startswith(('=', '+', '-', '@')) else v for v in row])
    return output.getvalue()


def render_pdf(report: dict, destination: Path) -> None:
    try:
        from reportlab import rl_config
        from reportlab.lib import colors
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import ParagraphStyle
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.ttfonts import TTFont
        from reportlab.platypus import BaseDocTemplate, Frame, PageTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether
    except ImportError as error:
        raise SystemExit('PDF: installare la dipendenza di sviluppo reportlab (vedere requirements-public-spending.txt).') from error
    rl_config.invariant = 1
    # Use local fonts, never download or redistribute font files with this script.
    regular = Path('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')
    bold = Path('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf')
    body_font, bold_font = 'Helvetica', 'Helvetica-Bold'
    if regular.exists() and bold.exists():
        pdfmetrics.registerFont(TTFont('ReportSans', str(regular)))
        pdfmetrics.registerFont(TTFont('ReportSansBold', str(bold)))
        pdfmetrics.registerFontFamily('ReportSans', normal='ReportSans', bold='ReportSansBold', italic='ReportSans', boldItalic='ReportSansBold')
        body_font, bold_font = 'ReportSans', 'ReportSansBold'
    styles = {
        'body': ParagraphStyle('body', fontName=body_font, fontSize=9.2, leading=13.2, spaceAfter=5, textColor=colors.black),
        'title': ParagraphStyle('title', fontName=bold_font, fontSize=27, leading=31, spaceAfter=16, textColor=colors.black),
        'h1': ParagraphStyle('h1', fontName=bold_font, fontSize=18, leading=22, spaceAfter=12, keepWithNext=True),
        'h2': ParagraphStyle('h2', fontName=bold_font, fontSize=11, leading=15, spaceBefore=8, spaceAfter=4, keepWithNext=True),
        'small': ParagraphStyle('small', fontName=body_font, fontSize=7.6, leading=10.5, spaceAfter=4, textColor=colors.black),
        'label': ParagraphStyle('label', fontName=bold_font, fontSize=8, leading=11, spaceAfter=5, textColor=colors.black),
        'fact': ParagraphStyle('fact', fontName=body_font, fontSize=8.8, leading=12.2, spaceAfter=5, leftIndent=9, borderColor=colors.black, borderWidth=0, textColor=colors.black),
        'url': ParagraphStyle('url', fontName=body_font, fontSize=7.1, leading=9.8, spaceAfter=7, splitLongWords=True, wordWrap='CJK'),
    }
    def para(text: str, style: str = 'body') -> Any:
        return Paragraph(html.escape(text), styles[style])
    def refs(ids: list[str]) -> Any:
        return para(source_ids(ids), 'small')
    class ReportDoc(BaseDocTemplate):
        def afterFlowable(self, flowable: Any) -> None:
            if isinstance(flowable, Paragraph) and flowable.style.name in ('h1', 'title'):
                text = flowable.getPlainText()
                key = 'outline-' + hashlib.sha256(text.encode()).hexdigest()[:16]
                self.canv.bookmarkPage(key)
                self.canv.addOutlineEntry(text, key, level=0, closed=False)
    width, height = A4
    left, right, top, bottom = 48, 48, 49, 43
    doc = ReportDoc(str(destination), pagesize=A4, leftMargin=left, rightMargin=right, topMargin=top, bottomMargin=bottom,
                    title=report['title'], author='DoveVannoINostriSoldi', subject='Ricognizione documentale della spesa pubblica; bozza per revisione', pageCompression=1)
    def furniture(canvas: Any, _: Any) -> None:
        canvas.saveState()
        canvas.setStrokeColor(colors.black); canvas.setFillColor(colors.black)
        canvas.setLineWidth(.4); canvas.line(left, height-31, width-right, height-31)
        canvas.setFont(body_font, 7)
        canvas.drawString(left, height-24, 'DVNS / SPESA PUBBLICA ITALIANA')
        canvas.drawRightString(width-right, height-24, '14 SETTEMBRE 2026 / BOZZA')
        canvas.line(left, 31, width-right, 31)
        canvas.drawString(left, 20, 'Fonti e calcoli nel registro finale. Nessun totale nazionale di sprechi stimato.')
        canvas.drawRightString(width-right, 20, str(doc.page))
        canvas.restoreState()
    doc.addPageTemplates(PageTemplate(id='report', frames=Frame(left, bottom, width-left-right, height-top-bottom, leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0), onPage=furniture))
    story: list[Any] = []
    def page(title: str) -> None:
        if story: story.append(PageBreak())
        story.append(para(title, 'h1'))
    def fact(fid: str) -> None:
        f = next(f for f in report['facts'] if f['id'] == fid)
        parts = [para(f'{fid} · {report["assessmentLabels"][f["kind"]]} · {f["referencePeriod"]}', 'label'),
                 para(f['text'], 'fact'), para(f'{f["scope"]}. {f["limitation"]}', 'small'), refs(f['sourceIds'])]
        story.append(KeepTogether(parts))
    story += [Spacer(1, 16), para(report['title'], 'title'), para(report['subtitle']),
              para('Dieci funzioni della spesa e una lettura trasversale degli enti locali.', 'h2'),
              para(report['scope']['coverage'], 'small'), para('QUADRO D’INSIEME', 'label')]
    for p in report['executive']: story.append(para(p))
    story += [refs(['S01','S04','S06','S08','S10','S12','S13']), para('Quote di composizione: calcoli C07 e C08. Le proposte sono valutazioni del report, non raccomandazioni attribuite alle fonti.', 'small')]
    page('Mappa della spesa pubblica')
    story += [para(f'{it(report["macro"]["totalBillionRounded"])} miliardi di euro', 'title'),
              para(f'Anno {report["scope"]["macroYear"]} · {report["scope"]["name"]} · {report["scope"]["accounting"]}'),
              para(f'{it(report["macro"]["shareGdpRounded"], 1)}% del PIL. Valori di funzione arrotondati a 0,01 miliardi.', 'small')]
    rows = [[para('Funzione', 'label'), para('Miliardi €', 'label'), para('Quota %', 'label')]]
    for s in report['sections']:
        share = rounded_calculation({'operation':'ratio-percent','inputs':[s['amountBillionRounded'],report['macro']['totalBillionRounded']],'roundDigits':1})
        rows.append([para(f'{s["code"]} · {s["title"]}', 'body'), para(it(s['amountBillionRounded'])), para(it(share,1))])
    rows.append([para('Totale ufficiale', 'label'), para(it(report['macro']['totalBillionRounded']), 'label'), para('100,0', 'label')])
    table = Table(rows, colWidths=[width-left-right-133, 78, 55], repeatRows=1, hAlign='LEFT')
    table.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),5),('RIGHTPADDING',(0,0),(-1,-1),5),
      ('TOPPADDING',(0,0),(-1,-1),5),('BOTTOMPADDING',(0,0),(-1,-1),2),('LINEBELOW',(0,0),(-1,0),.7,colors.black),
      ('LINEBELOW',(0,1),(-1,-2),.2,colors.black),('LINEABOVE',(0,-1),(-1,-1),.7,colors.black)]))
    story += [table, Spacer(1,8), para(report['macro']['reconciliation'], 'small'), refs(report['macro']['sourceIds'])]
    fact('F01')
    page('Quattro priorità di intervento')
    story.append(para('Non una lista di tagli, ma quattro modi diversi per migliorare l’uso delle risorse. Prima di attribuire un risparmio netto occorre verificare costi, effetti e vincoli.'))
    for i, p in enumerate(report['priorities'],1):
        story += [para(f'{i}. {p["title"]}', 'h2'), para(p['scope'],'label'), para(p['action']),
                  para('Base della proposta: '+p['basis']+'.', 'small'), para(p['tradeoff'], 'small'), refs(p['sourceIds']), Spacer(1,5)]
    for s in report['sections']:
        page(f'{s["code"]} · {s["title"]}')
        story += [para(f'{it(s["amountBillionRounded"])} miliardi € · COFOG 2024 · {s["assessment"]}', 'label'),para(s['headline'],'h2')]
        for fid in s['factIds']: fact(fid)
        story.append(para('Analisi','h2'))
        for p in s['analysis']: story.append(para(p))
        story.append(para('Dove intervenire','h2'))
        for i, p in enumerate(s['actions'],1): story.append(para(f'{i}. {p}'))
        story += [para('Attuazione e misura','h2'), para('Responsabili: '+s['owner']+'.', 'small'),
                  para('Indicatore: '+s['kpi'], 'small'), para('Risorse liberabili: '+s['quantification'], 'small'),
                  para(s['limitations'], 'small'), refs(s['sourceIds'])]
    s=report['municipal']; page('Comuni ed enti locali')
    story.append(para('Un livello di governo, non un’undicesima funzione.','h2'))
    for fid in ['F21','F22']: fact(fid)
    story.append(para('Il divario nei nidi, documentato in F16 e F17, rientra anche in questa lettura. Non è una spesa aggiuntiva alla mappa nazionale.', 'small'))
    for p in s['analysis']: story.append(para(p))
    story.append(para('Dove intervenire', 'h2'))
    for i,p in enumerate(s['actions'],1): story.append(para(f'{i}. {p}'))
    story += [para('Responsabili: '+s['owner'], 'small'), para('Indicatore: '+s['kpi'], 'small'),
              para('Risorse liberabili: '+s['quantification'], 'small'), para(s['limitations'], 'small'), refs(s['sourceIds'])]
    page('Metodo e limiti della verifica')
    for i,p in enumerate(report['methodology'],1): story += [para(f'{i:02}'),para(p)]
    page('Registro dei calcoli')
    story.append(para('I calcoli sono rieseguiti con aritmetica decimale e, indipendentemente, con frazioni intere. Gli operandi sono collegati alle metriche del registro JSON. La riproduzione del calcolo non certifica l’accuratezza originaria della fonte.'))
    for index, c in enumerate(report['calculations']):
        if index == 6: story.append(PageBreak())
        story.append(KeepTogether([para(c['id']+' · '+c['display'],'h2'),para(c['description']),
             para(f'Operazione: {c["operation"]}. Operandi: {" ; ".join(c["inputs"])}. Risultato arrotondato: {c["roundedResult"]}.','small'),refs(c['sourceIds'])]))
    page('Registro delle fonti')
    story.append(para('S01-S15 sostengono il quadro e le evidenze. S16-S26 sono cataloghi da cui acquisire ulteriori dati: non rappresentano database integralmente analizzati in questa edizione. Per ogni fonte è indicato il canale effettivo di consultazione. Le condizioni di riuso degli originali devono essere controllate per singola risorsa prima di ridistribuirli.'))
    for s in report['sources']:
        url = html.escape(s['url'], quote=True)
        link = Paragraph(f'<link href="{url}" color="black">{html.escape(s["url"])}</link>', styles['url'])
        story.append(KeepTogether([para(f'{s["id"]} · {s["holder"]}', 'h2'),para(s['title']),
          para(f'Periodo: {s["referencePeriod"]}. Pubblicazione: {s["publicationDate"] or "non dichiarata"}. Consultazione: {s["checkedAt"]}.','small'),
          para(s['locator'],'small'),*([para(s['note'],'small')] if s['note'] else []),para(s['verificationChannel'],'small'),link]))
    story += [Spacer(1,10),para(report['predecessor']['note'],'small')]
    destination.parent.mkdir(parents=True, exist_ok=True)
    doc.build(story)


def build(root: Path, *, check: bool = False) -> dict:
    raw = (root / CANONICAL).read_bytes()
    report = json.loads(raw)
    validate(report)
    derivatives = {
        'public' + report['jsonPath']: raw,
        'public' + report['csvPath']: claims_csv(report).encode(),
        'docs/reports/SPESA_PUBBLICA_ITALIANA_2026.md': markdown(report).encode(),
    }
    if check:
        for relative, content in derivatives.items():
            if not (root / relative).is_file() or (root / relative).read_bytes() != content:
                raise ValueError(f'Artefatto divergente: {relative}')
        manifest = json.loads((root / MANIFEST).read_text())
        if manifest['canonicalSha256'] != hashlib.sha256(raw).hexdigest():
            raise ValueError('Manifest di un contenuto diverso')
        expected_paths = {*derivatives, 'public' + report['pdfPath']}
        if set(manifest['artifacts']) != expected_paths:
            raise ValueError('Manifest incompleto o con percorsi inattesi')
        for relative, expected in manifest['artifacts'].items():
            path = root / relative
            if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != expected['sha256']:
                raise ValueError(f'Hash derivato non valido: {relative}')
        return manifest
    for relative, content in derivatives.items():
        path=root / relative; path.parent.mkdir(parents=True,exist_ok=True); path.write_bytes(content)
    pdf_relative = 'public' + report['pdfPath']
    render_pdf(report, root / pdf_relative)
    files = [*derivatives, pdf_relative]
    manifest = {
        'schemaVersion':1,'reportId':report['reportId'],'referenceDate':report['referenceDate'],
        'canonicalPath':str(CANONICAL),'canonicalSha256':hashlib.sha256(raw).hexdigest(),
        'note':'Hash dei derivati prodotti localmente; non hash dei byte delle fonti esterne. PDF riproducibile nello stesso ambiente ReportLab/font.',
        'artifacts': {name:{'sha256':hashlib.sha256((root/name).read_bytes()).hexdigest(),'bytes':(root/name).stat().st_size} for name in files}
    }
    (root / MANIFEST).write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    return manifest


def main() -> None:
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root',type=Path,default=ROOT)
    parser.add_argument('--check',action='store_true')
    args=parser.parse_args()
    try:
        manifest=build(args.root.resolve(),check=args.check)
    except (ValueError,KeyError,TypeError,OSError,StopIteration,ArithmeticError) as error:
        raise SystemExit(f'Verifica report fallita: {error}') from error
    print(json.dumps({'ok':True,'mode':'check' if args.check else 'build','artifacts':len(manifest['artifacts'])}))

if __name__=='__main__':
    main()
