#!/usr/bin/env python3
"""Build the current, canonical report offline. --check needs only stdlib.

No network requests, no source refresh and no publication. PDF figures and the
web page consume the same decimal inputs and dependency-bound calculations.
"""
from __future__ import annotations
import argparse
import csv
import hashlib
import io
import json
import re
from decimal import Decimal, ROUND_HALF_UP, localcontext
from pathlib import Path
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parents[2]
CONTENT = Path('src/content/reports/state-budget-reader.json')
PDF = Path('public/report/bilancio-stato-2025.pdf')
RECEIPT = Path('docs/research/state-budget-2025/pdf-receipt.json')
DATA = Path('public/data/reports/state-budget-reader.json')
CSV = Path('public/data/reports/state-budget-reader.csv')
MD = Path('docs/research/state-budget-2025/READER_REPORT.md')
LEGACY = ('affidamenti','tolentino','impianti','prepac','carceri','entrate','percentuali','personale','archivi','rti','date')


def number(report: dict, key: str, seen: tuple = ()) -> Decimal:
    if key in seen or len(seen) > 40:
        raise ValueError('Cyclic calculation')
    if key in report['metrics']:
        raw = report['metrics'][key]['value']
        if not re.fullmatch(r'-?\d+(?:\.\d+)?', raw):
            raise ValueError('Invalid decimal')
        return Decimal(raw)
    matches = [c for c in report['calculations'] if c['id'] == key]
    if len(matches) != 1:
        raise ValueError('Missing or duplicate calculation: ' + key)
    c = matches[0]
    values = [number(report, x, seen + (key,)) for x in c['inputs']]
    with localcontext() as ctx:
        ctx.prec = 50
        op = c['operation']
        if op == 'sum':
            if len(values) < 2:
                raise ValueError('Sum needs at least two inputs')
            value = sum(values)
        else:
            if len(values) != 2:
                raise ValueError('Two inputs required')
            a, b = values
            if op == 'difference': value = a - b
            elif op == 'ratio': value = a / b
            elif op == 'ratio-percent': value = a / b * 100
            elif op == 'relative-change-percent': value = (a - b) / b * 100
            elif op == 'reduction-percent': value = (a - b) / a * 100
            else: raise ValueError('Unsupported operation')
        if not isinstance(c['digits'], int) or not 0 <= c['digits'] <= 8:
            raise ValueError('Invalid precision')
        return value.quantize(Decimal(10) ** -c['digits'], rounding=ROUND_HALF_UP)


def validate(report: dict) -> None:
    if report['route'] != '/report/bilancio-stato-2025' or report['pdfPath'] != '/report/bilancio-stato-2025.pdf':
        raise ValueError('Canonical URL changed')
    if report.get('noNationalWasteTotal') is not True:
        raise ValueError('Undocumented waste total')
    if '\u2014' in json.dumps(report, ensure_ascii=False):
        raise ValueError('Em dash in manuscript')
    for collection in ('sources', 'cases', 'calculations'):
        ids = [x['id'] for x in report[collection]]
        if len(ids) != len(set(ids)):
            raise ValueError('Duplicate identifiers')
    if set(report['metrics']) & {c['id'] for c in report['calculations']}:
        raise ValueError('Metric/calculation collision')
    sources = {s['id'] for s in report['sources']}
    for metric in report['metrics'].values():
        if metric['sourceId'] not in sources:
            raise ValueError('Unresolved metric source')
    for c in report['calculations']:
        if str(number(report, c['id'])) != c['expected']:
            raise ValueError('Calculation mismatch: ' + c['id'])
    sectors = report['sectors']
    if sorted(s['code'] for s in sectors) != [f'GF{i:02}' for i in range(1,11)]:
        raise ValueError('Incomplete COFOG coverage')
    if sum(int(s['amountCents']) for s in sectors) != int(report['macro']['totalCents']):
        raise ValueError('Composition mismatch')
    if any(sum(c['legacyId'] == old for c in report['cases']) != 1 for old in LEGACY):
        raise ValueError('Legacy case missing')
    for case in report['cases']:
        if not case['sourceIds'] or set(case['sourceIds']) - sources:
            raise ValueError('Unresolved case source')
        if not case['period'] or not case['conclusion']:
            raise ValueError('Case missing context')


def it(value, digits=2):
    return f'{Decimal(value):,.{digits}f}'.translate(str.maketrans(',.', '.,'))


def formula(report, c):
    vals = [number(report, key) for key in c['inputs']]
    f = [it(v, max(0, -v.as_tuple().exponent)) for v in vals]
    op = c['operation']
    if op == 'sum': text = ' + '.join(f)
    elif op == 'difference': text = f'{f[0]} - {f[1]}'
    elif op == 'relative-change-percent': text = f'({f[0]} - {f[1]}) / {f[1]} × 100'
    elif op == 'reduction-percent': text = f'({f[0]} - {f[1]}) / {f[0]} × 100'
    else: text = f'{f[0]} / {f[1]}' + (' × 100' if op == 'ratio-percent' else '')
    return f'{text} = {it(number(report,c["id"]),c["digits"])} {c["unit"]}'


def derivatives(report: dict, raw: bytes) -> dict[Path, bytes]:
    out = io.StringIO(newline='')
    writer = csv.writer(out, lineterminator="\n")
    writer.writerow(['id','settore','tipo','titolo','numero','significato','periodo','conclusione','fonti'])
    for c in report['cases']:
        row = [c['id'],c['sector'],report['kindLabels'][c['kind']],c['title'],c['number'],c['numberLabel'],c['period'],c['conclusion'],'|'.join(c['sourceIds'])]
        # Safe to open in spreadsheets, also after a future editorial update.
        writer.writerow(["'"+v if v.startswith(('=','+','-','@','\t','\r')) else v for v in row])
    lines = ['# '+report['title'],'',report['summary'],'',report['lead'],'']
    for c in report['cases']:
        lines += ['## '+c['title'], '', report['kindLabels'][c['kind']]+' · '+c['period'], '', c['lead'], '', *sum(([p,''] for p in c['paragraphs']),[]), '**Cosa dimostra.** '+c['conclusion'], '', '**Come migliorare.** '+c['improve'], '']
        if c['math']:
            lines += [c['math']['explanation'],'']
            for id in c['math']['calculationIds']:
                calculation = next(x for x in report['calculations'] if x['id']==id)
                lines += [calculation['label']+': '+formula(report,calculation),'']
        lines += ['Fonti: '+', '.join(c['sourceIds']), '']
    lines += ['## Metodo','',*sum(([p,''] for p in report['method']),[]),'## Fonti','']
    for s in report['sources']:
        lines += [f'- [{s["publisher"]}: {s["title"]}]({s["url"]}). {s["locator"]}']
    return {DATA:raw,CSV:out.getvalue().encode('utf-8-sig'),MD:('\n'.join(lines).rstrip()+'\n').encode()}


def make_pdf(report: dict, target: Path) -> dict:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle, KeepTogether, Flowable
    from reportlab.pdfgen.canvas import Canvas
    ink=colors.HexColor('#182b3a'); teal=colors.HexColor('#176575'); red=colors.HexColor('#b42332')
    paper=colors.HexColor('#f3f5f7'); muted=colors.HexColor('#536474'); line=colors.HexColor('#c5cfd8')
    styles={
      'body':ParagraphStyle('Body',fontName='Helvetica',fontSize=10.2,leading=15.2,textColor=ink,spaceAfter=7,allowWidows=0,allowOrphans=0),
      'small':ParagraphStyle('Small',fontName='Helvetica',fontSize=8.2,leading=11.5,textColor=muted,spaceAfter=5),
      'label':ParagraphStyle('Label',fontName='Helvetica-Bold',fontSize=8.2,leading=11,textColor=red,spaceAfter=8),
      'title':ParagraphStyle('TitleReader',fontName='Helvetica-Bold',fontSize=32,leading=35.5,textColor=ink,spaceAfter=17),
      'h1':ParagraphStyle('SectionReader',fontName='Helvetica-Bold',fontSize=23,leading=27,textColor=ink,spaceAfter=14,keepWithNext=True),
      'h2':ParagraphStyle('CaseReader',fontName='Helvetica-Bold',fontSize=21,leading=25,textColor=ink,spaceAfter=11,keepWithNext=True),
      'h3':ParagraphStyle('HeadingReader',fontName='Helvetica-Bold',fontSize=11.2,leading=15,textColor=ink,spaceBefore=9,spaceAfter=5,keepWithNext=True),
      'lead':ParagraphStyle('LeadReader',fontName='Helvetica-Bold',fontSize=11.3,leading=16.5,textColor=ink,spaceAfter=11),
      'number':ParagraphStyle('NumberReader',fontName='Helvetica-Bold',fontSize=23,leading=27,textColor=teal,spaceAfter=3),
      'formula':ParagraphStyle('FormulaReader',fontName='Helvetica',fontSize=8.8,leading=13,textColor=ink,spaceAfter=5,wordWrap='LTR'),
    }
    def p(text, style='body'): return Paragraph(escape(str(text)),styles[style])
    def markup(text,style='body'): return Paragraph(text,styles[style])
    source_numbers={s['id']:i+1 for i,s in enumerate(report['sources'])}
    def refs(ids):
        return markup('Fonti: '+', '.join(f'<link href="#source-{s}">[{source_numbers[s]}]</link>' for s in ids)+'.','small')
    logo=ROOT/'public/brand/icon-48.png'
    # The exact branded image already tracked by DVNS; no newly generated mark.
    if not logo.is_file(): raise ValueError('Missing DVNS brand asset: public/brand/icon-48.png')
    logo_sha=hashlib.sha256(logo.read_bytes()).hexdigest()
    class ReportCanvas(Canvas):
        def __init__(self,*args,**kwargs):
            kwargs['invariant']=1
            super().__init__(*args,**kwargs)
        def header(self,doc):
            self.saveState();w,h=A4
            self.setFillColor(ink);self.setFont('Helvetica-Bold',8.6)
            self.drawImage(str(logo),47,h-40,width=17,height=17,mask='auto')
            self.drawString(71,h-32,'DoveVannoINostriSoldi')
            self.setFont('Helvetica',8);self.setFillColor(muted);self.drawRightString(w-47,h-32,'Spesa pubblica | 14 settembre 2026')
            self.setStrokeColor(line);self.line(47,38,w-47,38)
            self.setFont('Helvetica',8);self.drawString(47,24,'Spesa pubblica | Settembre 2026')
            self.drawRightString(w-47,24,str(doc.page));self.restoreState()
    class BarChart(Flowable):
        def __init__(self, chart, width):
            super().__init__();self.chart=chart;self.width=width;self.height=28*len(chart['rows'])+8
        def draw(self):
            c=self.canv;vals=[float(number(report,row['metric'])) for row in self.chart['rows']];maximum=max(*vals,1)
            for i,(row,v) in enumerate(zip(self.chart['rows'],vals)):
                y=self.height-17-i*28
                c.setFont('Helvetica',8.5);c.setFillColor(ink);c.drawString(0,y,row['label'])
                c.setFont('Helvetica-Bold',8.5);c.drawRightString(self.width,y,it(str(v),0 if v.is_integer() else 2))
                c.setFillColor(colors.HexColor('#dce7ec'));c.rect(0,y-11,self.width,5,fill=1,stroke=0)
                c.setFillColor(teal);c.rect(0,y-11,self.width*v/maximum,5,fill=1,stroke=0)
    class ReaderDocument(SimpleDocTemplate):
        def afterFlowable(self, flowable):
            if isinstance(flowable, Paragraph) and flowable.style.name in ('SectionReader', 'CaseReader'):
                key = 'reading-' + str(getattr(self, '_reading_count', 0))
                self._reading_count = getattr(self, '_reading_count', 0) + 1
                self.canv.bookmarkPage(key)
                self.canv.addOutlineEntry(flowable.getPlainText(), key, level=0)

    doc=ReaderDocument(str(target),pagesize=A4,rightMargin=47,leftMargin=47,topMargin=62,bottomMargin=53,title=report['title'],author='DoveVannoINostriSoldi',subject='Rapporto documentale sulla spesa pubblica italiana',allowSplitting=True)
    width=A4[0]-94
    story=[]
    def block(title,text):
        box=Table([[p(title,'h3')],[p(text)]],colWidths=[width-2])
        box.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),paper),('BOX',(0,0),(-1,-1),.6,line),('LEFTPADDING',(0,0),(-1,-1),12),('RIGHTPADDING',(0,0),(-1,-1),12),('TOPPADDING',(0,0),(-1,0),2),('BOTTOMPADDING',(0,-1),(-1,-1),7)]))
        return box
    # Cover: useful entry points, not an empty decorative page.
    story += [Spacer(1,15),p('RAPPORTO · SETTEMBRE 2026','label'),p(report['title'],'title'),p(report['summary'],'lead'),p(report['lead']),Spacer(1,20)]
    for c in report['cases'][:3]:
        story += [p(c['number'],'number'),p(c['title'],'h3'),p(c['numberLabel']+'. '+c['period']+'.','small'),Spacer(1,13)]
    story += [p('Questi importi e confronti hanno periodi e significati diversi. Non vanno sommati.','small'),Spacer(1,10),p('Percorso di lettura','h3'),p('Il quadro contabile, tutti i settori, 17 riscontri, i servizi comunali e le fonti. Ogni scheda separa il fatto dalla sua interpretazione.'),p('Il quadro nazionale usa il 2024, ultimo anno dello snapshot COFOG integrato. I riscontri includono atti e risultati successivi.','small'),PageBreak()]
    # Exact macro overview, with bars and values from the same cents.
    story += [p('01 · IL QUADRO COMPLETO','label'),p('Dove vanno 100 euro di spesa pubblica','h1'),p(it(Decimal(report['macro']['totalCents'])/Decimal('100000000000'))+' miliardi di euro','number'),p('Italia · '+str(report['macro']['year'])+' · '+it(report['macro']['gdpPercent'],1)+'% del PIL','small'),p(report['macro']['note']),Spacer(1,9)]
    class ShareBar(Flowable):
        def __init__(self, share):
            super().__init__(); self.width=78; self.height=14; self.share=float(share)
        def draw(self):
            self.canv.setFillColor(colors.HexColor('#dce7ec')); self.canv.rect(0,4,78,6,fill=1,stroke=0)
            self.canv.setFillColor(teal); self.canv.rect(0,4,78*self.share/100,6,fill=1,stroke=0)
    rows=[[p('Funzione','small'),p('Scala 0-100','small'),p('Miliardi €','small'),p('Su 100 €','small')]]
    for s in sorted(report['sectors'],key=lambda x:int(x['amountCents']),reverse=True):
        share=Decimal(s['amountCents'])/Decimal(report['macro']['totalCents'])*100
        rows.append([p(s['label']),ShareBar(share),p(it(Decimal(s['amountCents'])/Decimal('100000000000'))),p(it(share)+' €')])
    rows.append([p('Totale','lead'),ShareBar(100),p(it(Decimal(report['macro']['totalCents'])/Decimal('100000000000')),'lead'),p('100,00 €','lead')])
    table=Table(rows,colWidths=[width*.41,width*.19,width*.22,width*.18],repeatRows=1,hAlign='LEFT')
    table.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),paper),('LINEBELOW',(0,0),(-1,-1),.4,line),('VALIGN',(0,0),(-1,-1),'TOP'),('TOPPADDING',(0,0),(-1,-1),8),('BOTTOMPADDING',(0,0),(-1,-1),5),('ALIGN',(1,0),(-1,-1),'RIGHT')]))
    story += [table,Spacer(1,14),p('Ogni quota è la spesa della funzione divisa per il totale nazionale, moltiplicata per 100. Le quote sono arrotondate soltanto per la lettura.','small'),p('Stato, Regioni, Comuni ed enti previdenziali non sono totali da aggiungere a questo: fanno già parte del perimetro delle amministrazioni pubbliche.','small'),refs(['cofog']),PageBreak()]
    for n in range(0,10,5):
        story += [p('02 · TUTTI I SETTORI','label'),p('Spesa e risultati sono due domande diverse','h1')]
        for s in report['sectors'][n:n+5]:
            story += [p(s['label']+' · '+it(Decimal(s['amountCents'])/Decimal('100000000000'))+' mld €','h3'),p(s['note']),p(s['reading'],'small')]
        story += [refs(['cofog']),PageBreak()]
    for i,c in enumerate(report['cases'],1):
        story += [markup(f'<a name="case-{c["id"]}"/>{i:02} · '+escape(report['kindLabels'][c['kind']].upper()),'label'),p(c['title'],'h2'),p(c['period'],'small'),p(c['number'],'number'),p(c['numberLabel'],'small'),Spacer(1,5),p(c['lead'],'lead')]
        story += [p(text) for text in c['paragraphs']]
        story += [block('Cosa dimostra',c['conclusion']),Spacer(1,7),p('Come migliorare','h3'),p(c['improve'])]
        if c['math']:
            story += [p('Il calcolo, in parole semplici','h3'),p(c['math']['explanation'])]
            # The RTI explanation uses a real table before detailed calculations.
            if c['math']['rows']:
                r=[[p('Confronto','small'),p('Importo associato','small'),p('Totale confrontato','small'),p('Quota','small')]]
                for row in c['math']['rows']:
                    r.append([p(row['label'],'small'),p(it(number(report,row['numerator']))+' €','small'),p(it(number(report,row['denominator']))+' €','small'),p(it(number(report,row['result']))+'%','small')])
                t=Table(r,colWidths=[width*.29,width*.27,width*.29,width*.15]);t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),paper),('VALIGN',(0,0),(-1,-1),'TOP'),('LINEBELOW',(0,0),(-1,-1),.5,line),('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),6)]));story.append(t)
            else:
                for id in c['math']['calculationIds']:
                    cl=next(x for x in report['calculations'] if x['id']==id)
                    story.append(p(formula(report,cl),'formula'))
        if c['chart'] and not (c['math'] and c['math']['rows']):
            story += [p(c['chart']['title']+' · '+c['chart']['unit'],'h3'),BarChart(c['chart'],width),p(c['chart']['note'],'small')]
        story += [refs(c['sourceIds']),PageBreak()]
    story += [p('04 · I SERVIZI LOCALI','label'),p(report['municipal']['title'],'h1')]+[p(x) for x in report['municipal']['paragraphs']]
    for chart in report['municipal']['charts']:
        story += [p(chart['title']+' · '+chart['unit'],'h3'),BarChart(chart,width),p(chart['note'],'small')]
    story += [refs(report['municipal']['sourceIds']),PageBreak(),p('05 · METODO E LESSICO','label'),p('Cosa abbiamo controllato','h1')]+[p(x) for x in report['method']]
    for g in report['glossary']: story += [p(g['term'],'h3'),p(g['definition'],'small')]
    story += [PageBreak(),p('FONTI','label'),p('Documenti e riferimenti','h1'),p('I titoli sono collegamenti alla fonte. Date e modalità di consultazione complete sono nel registro tecnico incluso nel pacchetto di revisione.','small')]
    for i,s in enumerate(report['sources'],1):
        title=markup(f'<a name="source-{s["id"]}"/>[{i}] <link href="{escape(s["url"],{chr(34):"&quot;"})}"><b>{escape(s["publisher"])}</b>: {escape(s["title"])}</link>','small')
        story.append(KeepTogether([title,p(s['locator'],'small'),Spacer(1,8)]))
    story += [p('Prove della prima analisi','h3'),markup(f'<link href="{report["legacyEvidenceUrl"]}">Archivio congelato: input, estratti, ricevute e calcoli della PR #506.</link>','small')]
    def page(canvas, document): canvas.header(document)
    doc.build(story,onFirstPage=page,onLaterPages=page,canvasmaker=ReportCanvas)
    return {'logoPath':'public/brand/icon-48.png','logoSha256':logo_sha,'font':'Helvetica (PDF); il sito usa i token tipografici del progetto','palette':{'ink':'#182b3a','teal':'#176575','accent':'#b42332','paper':'#f3f5f7'}}


def sha(raw): return hashlib.sha256(raw).hexdigest()

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--check',action='store_true');args=parser.parse_args()
    raw=(ROOT/CONTENT).read_bytes();report=json.loads(raw);validate(report);assets=derivatives(report,raw)
    if args.check:
        receipt=json.loads((ROOT/RECEIPT).read_text())
        if receipt['readerManuscriptSha256'] != sha(raw): raise ValueError('Reader receipt mismatch')
        pdf=(ROOT/PDF).read_bytes()
        if receipt['pdfSha256'] != sha(pdf) or receipt['pdfBytes']!=len(pdf): raise ValueError('PDF receipt mismatch')
        for name,value in assets.items():
            if (ROOT/name).read_bytes()!=value: raise ValueError('Stale derivative: '+str(name))
        print(json.dumps({'ok':True,'cases':len(report['cases']),'calculations':len(report['calculations']),'sources':len(report['sources']),'note':'Offline content/arithmetic/derivative check; not verification of original source bytes.'}));return
    (ROOT/PDF).parent.mkdir(parents=True,exist_ok=True)
    rendering=make_pdf(report,ROOT/PDF)
    for name,value in assets.items():
        (ROOT/name).parent.mkdir(parents=True,exist_ok=True);(ROOT/name).write_bytes(value)
    pdf=(ROOT/PDF).read_bytes()
    original=ROOT/'src/content/reports/state-budget-2025.json'
    receipt={'schemaVersion':2,'readerManuscriptSha256':sha(raw),'legacyManuscriptGitBlob':'b5ff933bc27d3c2d21393c6e8011fb1efcb23b96','pdfSha256':sha(pdf),'pdfBytes':len(pdf),'readerPath':str(CONTENT),'pdfPath':str(PDF),'rendering':rendering,'sourcesOriginalBytesAcquired':False}
    # Retain the legacy receipt field when the full repository is available.
    if original.exists():receipt['manuscriptSha256']=sha(original.read_bytes())
    (ROOT/RECEIPT).parent.mkdir(parents=True,exist_ok=True);(ROOT/RECEIPT).write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'pdf':str(PDF),'bytes':len(pdf),'cases':len(report['cases'])}))
if __name__=='__main__':main()
