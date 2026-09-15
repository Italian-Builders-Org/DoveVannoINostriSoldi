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
import runpy
from decimal import Decimal, ROUND_HALF_UP, localcontext
from pathlib import Path
from xml.sax.saxutils import escape
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]
AUDIT = runpy.run_path(str(ROOT / 'scripts/reports/audit_state_budget.py'))
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
    sr = report['spendingReview']
    if sr['version'] != 1 or len(sr['stages']) != 4 or len(sr['series']) != 2:
        raise ValueError('Spending review incomplete')
    document_ids = [d['id'] for d in sr['documents']]
    if len(set(document_ids)) != len(document_ids): raise ValueError('Duplicate archive item')
    for d in sr['documents']:
        if d['sourceId'] not in sources or urlsplit(d['url']).scheme != 'https' or not d['reading']:
            raise ValueError('Archive provenance incomplete')
    for t in sr['tracker']:
        if t['caseId'] and t['caseId'] not in {c['id'] for c in report['cases']}: raise ValueError('Tracker case missing')
        if any(i not in sources for i in t['sourceIds']): raise ValueError('Tracker source missing')
    if any(x['status'] != 'proposta' for x in sr['series'][0]['rows']): raise ValueError('Proposal relabelled')
    if next(x for x in sr['series'][1]['rows'] if x['year'] == 2018)['status'] != 'previsione': raise ValueError('Forecast relabelled')
    if number(report,'sr-army-reconciliation') != 0 or number(report,'sr-rents-missed') != 245000: raise ValueError('New findings inconsistent')
    if number(report,'sr-pg-reconciliation') != number(report,'sr-pg-total'): raise ValueError('Plans inconsistent')
    AUDIT['analyse'](report)


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


def spending_review_markdown(report: dict) -> list[str]:
    sr = report['spendingReview']
    lines = ['## '+sr['title'], '', *sr['intro'], '', sr['scope'], '']
    for stage in sr['stages']: lines += ['**'+stage['label']+'.** '+stage['text'], '']
    for era in sr['chronology']:
        lines += ['### '+era['period']+' · '+era['actor'], era['title'], era['text'], 'Fonti: '+', '.join(era['sourceIds']), '']
    for serie in sr['series']:
        lines += ['### '+serie['title'], serie['unit']]
        lines += [str(row['year'])+': '+str(number(report,row['metric']))+' ('+row['status']+')' for row in serie['rows']]
        lines += [serie['note'], '']
    lines += ['### '+sr['result2024']['title'], *sr['result2024']['paragraphs'], '']
    for t in sr['tracker']:
        lines += ['### '+t['theme'], '**Stato:** '+t['status'], '**Proposta:** '+t['proposal'], '**Seguito:** '+t['result'], '**Misura:** '+t['measure'], 'Fonti: '+', '.join(t['sourceIds']), '']
    lines += ['### Documenti originali e percorsi di archivio', '']
    for d in sr['documents']:
        lines += [f'**{d["period"]}: [{d["title"]}]({d["url"]})**', d['reading']+'. '+d['use'], '']
    lines += ['### Che cosa non possiamo concludere', '']
    for c in sr['corrections']: lines += ['**'+c['claim']+'** '+c['finding'], '']
    lines += [*sr['notReconstructed'], '', sr['conclusion'], '']
    return lines


def archive_csv(report: dict) -> bytes:
    out = io.StringIO(newline='')
    writer = csv.writer(out, lineterminator='\n')
    writer.writerow(['id','periodo','titolo','fonte','url','lettura','utilita'])
    for d in report['spendingReview']['documents']:
        row = [d[k] for k in ['id','period','title','sourceId','url','reading','use']]
        writer.writerow(["'"+v if v.startswith(('=','+','-','@','\t','\r')) else v for v in row])
    return out.getvalue().encode('utf-8-sig')


def derivatives(report: dict, raw: bytes) -> dict[Path, bytes]:
    out = io.StringIO(newline='')
    writer = csv.writer(out, lineterminator="\n")
    writer.writerow(['id','settore','tipo','titolo','numero','significato','periodo','conclusione','fonti'])
    for c in report['cases']:
        row = [c['id'],c['sector'],report['kindLabels'][c['kind']],c['title'],c['number'],c['numberLabel'],c['period'],c['conclusion'],'|'.join(c['sourceIds'])]
        # Safe to open in spreadsheets, also after a future editorial update.
        writer.writerow(["'"+v if v.startswith(('=','+','-','@','\t','\r')) else v for v in row])
    lines = ['# '+report['title'],'',report['summary'],'',report['lead'],'']
    for key in ('funding', 'execution', 'historyIntro', 'inpsContext', 'foreign'):
        ctx = report['audit'][key]
        lines += ['## '+ctx['title'], '', *sum(([p,''] for p in ctx['paragraphs']),[]), ctx['technical'], '', 'Fonti: '+', '.join(ctx['sourceIds']), '']
    lines += spending_review_markdown(report)
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
    return {Path('docs/research/state-budget-2025/reader-source-register.json'):(json.dumps({'checkedOn':'2026-09-15','updatedOn':'2026-09-15','note':'Accesso dichiarato per ogni fonte. Gli hash dei documenti originali non acquisiti restano null; non sono hash di estratti o trascrizioni.','sources':report['sources']},ensure_ascii=False,indent=2)+'\n').encode(),Path('public/data/reports/spending-review-documents.csv'):archive_csv(report), Path('docs/research/state-budget-2025/SPENDING_REVIEW.md'):('\n'.join(spending_review_markdown(report)).rstrip()+'\n').encode(), DATA:raw,CSV:out.getvalue().encode('utf-8-sig'),MD:('\n'.join(lines).rstrip()+'\n').encode(), **AUDIT['derivatives'](report)}


def make_pdf(report: dict, target: Path) -> dict:
    """Flowing analytical report; vector charts, no full-page case templates."""
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, KeepTogether, Flowable, HRFlowable
    from reportlab.pdfgen.canvas import Canvas
    ink, teal, red, paper, muted, line = [colors.HexColor(x) for x in ('#182b3a','#176575','#b42332','#f3f5f7','#536474','#c5cfd8')]
    width = A4[0]-90
    styles = {
        'body': ParagraphStyle('Body', fontName='Helvetica',fontSize=9.7,leading=13.5,textColor=ink,spaceAfter=6,allowWidows=0,allowOrphans=0),
        'small': ParagraphStyle('Small',fontName='Helvetica',fontSize=8,leading=10.8,textColor=muted,spaceAfter=5),
        'source': ParagraphStyle('SourceNote',fontName='Helvetica',fontSize=8,leading=10,textColor=muted,spaceAfter=3),
        'caption': ParagraphStyle('Caption',fontName='Helvetica',fontSize=8,leading=10.8,textColor=muted,spaceAfter=5,keepWithNext=True),
        'label': ParagraphStyle('Label',fontName='Helvetica-Bold',fontSize=8,leading=11,textColor=red,spaceBefore=9,spaceAfter=6,keepWithNext=True),
        'title': ParagraphStyle('TitleReader',fontName='Helvetica-Bold',fontSize=31,leading=34,textColor=ink,spaceAfter=13,keepWithNext=True),
        'h1': ParagraphStyle('SectionReader',fontName='Helvetica-Bold',fontSize=19,leading=23,textColor=ink,spaceBefore=17,spaceAfter=9,keepWithNext=True),
        'h2': ParagraphStyle('CaseReader',fontName='Helvetica-Bold',fontSize=16,leading=19.5,textColor=ink,spaceBefore=6,spaceAfter=7,keepWithNext=True),
        'h3': ParagraphStyle('HeadingReader',fontName='Helvetica-Bold',fontSize=10.5,leading=14,textColor=ink,spaceBefore=7,spaceAfter=4,keepWithNext=True),
        'lead': ParagraphStyle('LeadReader',fontName='Helvetica-Bold',fontSize=10,leading=14,textColor=ink,spaceAfter=7),
        'number': ParagraphStyle('NumberReader',fontName='Helvetica-Bold',fontSize=20,leading=24,textColor=teal,spaceAfter=6),
        'stat': ParagraphStyle('StatReader',fontName='Helvetica',fontSize=10,leading=13.5,textColor=teal,spaceAfter=7,keepWithNext=True),
        'formula': ParagraphStyle('FormulaReader',fontName='Helvetica',fontSize=8.1,leading=11.5,textColor=ink,spaceAfter=5),
    }
    def p(text, style='body'): return Paragraph(escape(str(text)),styles[style])
    def markup(text, style='body'): return Paragraph(text,styles[style])
    source_numbers={s['id']:i+1 for i,s in enumerate(report['sources'])}
    def refs(ids): return markup('Fonti: '+', '.join(f'<link href="#source-{s}">[{source_numbers[s]}]</link>' for s in ids)+'.','small')
    logo=ROOT/'public/brand/icon-48.png'
    if not logo.is_file(): raise ValueError('Missing original DVNS logo')
    class ReportCanvas(Canvas):
        def __init__(self,*args,**kwargs):
            kwargs['invariant']=1
            super().__init__(*args,**kwargs)
        def header(self,doc):
            self.saveState();w,h=A4
            self.drawImage(str(logo),45,h-39,width=17,height=17,mask='auto')
            self.setFont('Helvetica-Bold',8.5);self.setFillColor(ink);self.drawString(68,h-31,'DoveVannoINostriSoldi')
            self.setFont('Helvetica',7.6);self.setFillColor(muted);self.drawRightString(w-45,h-31,'Bilancio, spesa e risultati | 15 settembre 2026')
            self.setStrokeColor(line);self.line(45,36,w-45,36)
            self.setFont('Helvetica',7.5);self.drawString(45,23,'Audit documentale | Italia | Edizione del 15 settembre 2026')
            self.drawRightString(w-45,23,str(doc.page));self.restoreState()
    class Document(SimpleDocTemplate):
        def afterFlowable(self, flowable):
            if isinstance(flowable,Paragraph) and flowable.style.name in ('SectionReader','CaseReader'):
                key='reading-'+str(getattr(self,'_count',0));self._count=getattr(self,'_count',0)+1
                self.canv.bookmarkPage(key);self.canv.addOutlineEntry(flowable.getPlainText(),key,level=0)
    class MiniBar(Flowable):
        def __init__(self, share, bar_width=74):
            super().__init__();self.width=bar_width;self.height=12;self.share=float(share)
        def draw(self):
            self.canv.setFillColor(colors.HexColor('#dce7ec'));self.canv.rect(0,3,self.width,6,fill=1,stroke=0)
            self.canv.setFillColor(teal);self.canv.rect(0,3,self.width*self.share/100,6,fill=1,stroke=0)
    class SeriesChart(Flowable):
        def __init__(self, rows, chart_width=width, ceiling=None):
            super().__init__();self.rows=rows;self.width=chart_width
            self.layout=[]
            for label,value in rows:
                text=p(label,'small');_,height=text.wrap(chart_width-112,100)
                self.layout.append((text,height+19,float(value)))
            self.height=sum(h for _,h,_ in self.layout)+5
            self.maximum=ceiling or max(1,max(float(v) for _,v in rows))
        def draw(self):
            c=self.canv;y=self.height
            for text,h,value in self.layout:
                text.drawOn(c,0,y-(h-19));c.setFont('Helvetica-Bold',8.5);c.setFillColor(ink)
                c.drawRightString(self.width,y-9,it(str(value),0 if value.is_integer() else 2))
                c.setFillColor(colors.HexColor('#dce7ec'));c.rect(0,y-h+7,self.width,5,fill=1,stroke=0)
                c.setFillColor(teal);c.rect(0,y-h+7,self.width*value/self.maximum,5,fill=1,stroke=0)
                y-=h
    class HistoryChart(Flowable):
        def __init__(self): super().__init__();self.width=width;self.height=195
        def draw(self):
            c=self.canv;left=33;right=width-8;bottom=31;top=175
            x=lambda i:left+i*(right-left)/9
            y=lambda v:bottom+v/220000*(top-bottom)
            c.setFont('Helvetica',7.5)
            for tick in (0,50,100,150,200):
                c.setStrokeColor(line);c.setLineWidth(.4);c.line(left,y(tick*1000),right,y(tick*1000))
                c.setFillColor(muted);c.drawRightString(left-7,y(tick*1000)-2,str(tick))
            for field,colour,dash in [('totalMillion',teal,[]),('capitalMillion',ink,[5,2]),('currentMillion',muted,[1.5,2])]:
                c.setStrokeColor(colour);c.setLineWidth(1.8);c.setDash(dash)
                for i in range(9):c.line(x(i),y(report['audit']['history'][i][field]),x(i+1),y(report['audit']['history'][i+1][field]))
            c.setDash([])
            for i,row in enumerate(report['audit']['history']):
                c.setFillColor(teal);c.circle(x(i),y(row['totalMillion']),2,fill=1,stroke=0)
                c.setFillColor(muted);c.drawCentredString(x(i),bottom-14,str(row['year']))
            for text,colour,xpos,dash in [('Totale',teal,35,[]),('Conto capitale',ink,152,[5,2]),('Spese correnti',muted,305,[1.5,2])]:
                c.setStrokeColor(colour);c.setDash(dash);c.line(xpos,3,xpos+16,3);c.setFillColor(ink);c.drawString(xpos+22,0,text)
            c.setDash([])
    doc=Document(str(target),pagesize=A4,rightMargin=45,leftMargin=45,topMargin=56,bottomMargin=48,
        title=report['title'],author='DoveVannoINostriSoldi',subject='Bilancio statale, dati storici e riscontri documentali',allowSplitting=True)
    story=[]
    def heading(title, label=None):
        if label:story.append(p(label,'label'))
        story.append(p(title,'h1'))
    def context(key):
        ctx=report['audit'][key]
        story.extend(p(text) for text in ctx['paragraphs']);story.extend([p(ctx['technical'],'small'),refs(ctx['sourceIds'])])
    def table(rows, widths, small=True):
        cooked=[[cell if isinstance(cell,Flowable) else p(cell,'small' if small else 'body') for cell in row] for row in rows]
        t=Table(cooked,colWidths=widths,repeatRows=1,hAlign='LEFT')
        t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),paper),('LINEBELOW',(0,0),(-1,-1),.4,line),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),6),('RIGHTPADDING',(0,0),(-1,-1),6),('TOPPADDING',(0,0),(-1,-1),5),('BOTTOMPADDING',(0,0),(-1,-1),4)]))
        return t
    def chart(title,unit,rows,note,ceiling=None):
        graph=SeriesChart(rows,ceiling=ceiling)
        story.extend([p(title,'h3'),p(unit,'caption'),graph,p(note,'small')])
    def source_case(c,index):
        story.append(HRFlowable(width='100%',thickness=.6,color=line,spaceBefore=13,spaceAfter=3))
        story.extend([markup(f'<a name="case-{c["id"]}"/>{index:02} · '+escape(report['kindLabels'][c['kind']].upper()),'label'),p(c['title'],'h2'),p(c['period'],'caption'),markup('<b>'+escape(c['number'])+'</b> · '+escape(c['numberLabel']),'stat'),p(c['lead'],'lead')])
        story.extend(p(text) for text in c['paragraphs'])
        story.extend([markup('<b>Il punto.</b> '+escape(c['conclusion'])),markup('<b>La correzione utile.</b> '+escape(c['improve']))])
        if c['math']:
            story.extend([p('Come leggere il calcolo','h3'),p(c['math']['explanation'])])
            if c['math']['rows']:
                rows=[['Confronto','Importo associato','Totale confrontato','Quota']]
                for row in c['math']['rows']:
                    rows.append([row['label'],it(number(report,row['numerator']))+' €',it(number(report,row['denominator']))+' €',it(number(report,row['result']))+'%'])
                story.append(table(rows,[width*.26,width*.27,width*.31,width*.16]))
            else:
                for key in c['math']['calculationIds']:
                    calc=next(x for x in report['calculations'] if x['id']==key)
                    story.append(p(formula(report,calc),'formula'))
        if c['chart']:
            ch=c['chart'];chart(ch['title'],ch['unit'],[(row['label'],number(report,row['metric'])) for row in ch['rows']],ch['note'],100 if ch['unit']=='%' else None)
        story.append(refs(c['sourceIds']))
    story.extend([p('DOSSIER CIVICO · SETTEMBRE 2026','label'),p(report['title'],'title'),p(report['summary'],'lead'),p(report['lead'])])
    cards=[]
    for key in ['discariche','bonus-edilizi','inps-registrazioni']:
        c=next(x for x in report['cases'] if x['id']==key)
        cards.append([p(c['number'],'number'),p(report['kindLabels'][c['kind']],'label'),p(c['numberLabel'],'small')])
    tiles=Table([cards],colWidths=[width/3]*3)
    tiles.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),paper),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),11),('RIGHTPADDING',(0,0),(-1,-1),11),('TOPPADDING',(0,0),(-1,-1),12),('BOTTOMPADDING',(0,0),(-1,-1),8)]))
    story.extend([Spacer(1,7),tiles,p('Costi pagati, stime economiche e correzioni di crediti: periodi e grandezze diversi. Non si sommano.','small')])
    heading('Leggere il bilancio senza contare due volte','01 · IL PERCORSO DEL DENARO')
    context('funding')
    rows=[['Bilancio dello Stato 2025','Miliardi €','Che cosa misura'],['Entrate finali accertate',it(number(report,'state-revenue')/1000),'Crediti riconosciuti nell’esercizio'],['Spese finali',it(number(report,'state-final')/1000),'Spese senza rimborso dei prestiti'],['Saldo netto da finanziare',it(number(report,'state-balance')/1000),'Saldo pubblicato di competenza'],['Rimborso di prestiti',it(number(report,'state-repay')/1000),'Restituzione di capitale, separata']]
    story.extend([table(rows,[width*.43,width*.18,width*.39]),Spacer(1,8)])
    chart('Da dove arrivano le entrate finali','Miliardi € · accertamenti 2025',[(label,number(report,key)/1000) for label,key in [('Imposte','state-tax'),('Entrate non tributarie','state-other'),('Alienazioni e riscossione di crediti','state-assets')]],'Il gettito fiscale pesa l’84,52%. Il credito accertato non coincide necessariamente con l’incasso.')
    chart('Dove sono impegnate le spese finali','Miliardi € · competenza 2025',[(label,number(report,key)/1000) for label,key in [('Spese correnti senza interessi','state-current'),('Interessi sul debito','state-interest'),('Conto capitale','state-capital')]],'Totale 902,96 miliardi. I 267,97 miliardi di rimborso prestiti non sono inclusi.')
    heading(report['audit']['execution']['title'],'02 · IMPEGNI E PAGAMENTI')
    context('execution')
    ranking=sorted(report['audit']['ministries'],key=lambda r:Decimal(r['remainingCpCents'])/Decimal(r['commitmentsCpCents']),reverse=True)
    rows=[['Ministero','Quota non pagata','%','Rimasto CP, mld €']]
    for r in ranking:
        share=Decimal(r['remainingCpCents'])/Decimal(r['commitmentsCpCents'])*100
        rows.append([r['label'],MiniBar(share),it(share),it(Decimal(r['remainingCpCents'])/Decimal('100000000000'))])
    story.extend([p('Quota degli impegni 2025 rimasta da pagare','h3'),p('Barre sulla scala 0-100%. I valori monetari impediscono di confondere una quota elevata con una somma elevata.','small'),table(rows,[width*.39,width*.21,width*.12,width*.28]),p('Il 71,19% del Turismo e il 38,90% delle Infrastrutture sono segnali di esecuzione. Per parlare di ritardo occorre la scadenza; per parlare di spreco, il costo senza risultato.','small')])
    heading(report['audit']['historyIntro']['title'],'03 · LA PROSPETTIVA STORICA')
    context('historyIntro');story.extend([p('Residui delle spese finali, 2015-2024','h3'),p('Stock al 31 dicembre · miliardi di euro nominali · scala da zero','caption'),HistoryChart()])
    rows=[['Anno','Totale','Correnti','Capitale','Nuova formazione']]
    for r in report['audit']['history']:rows.append([str(r['year'])]+[it(r[k],0) for k in ('totalMillion','currentMillion','capitalMillion','newMillion')])
    story.extend([Spacer(1,8),table(rows,[width*.12,width*.2,width*.2,width*.2,width*.28]),p('Tabella in milioni di euro. Nuova formazione è una componente dello stock, non un importo da aggiungere al totale.','small'),refs(['camera-residui'])])
    sr=report['spendingReview']
    heading(sr['title'],'DOSSIER · LA SPENDING REVIEW DAL 1981')
    story.extend(p(text) for text in sr['intro'])
    stages=[[p(st['label'],'h3'),p(st['text'],'small')] for st in sr['stages']]
    stage_table=Table([stages],colWidths=[width/4]*4,hAlign='LEFT')
    stage_table.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('BACKGROUND',(0,0),(-1,-1),paper),('LINEABOVE',(0,0),(-1,0),2,teal),('LEFTPADDING',(0,0),(-1,-1),8),('RIGHTPADDING',(0,0),(-1,-1),8),('BOTTOMPADDING',(0,0),(-1,-1),10)]))
    story.extend([Spacer(1,8),stage_table,Spacer(1,8)])
    for serie in sr['series']:
        chart(serie['title'],serie['unit']+' · scala 0-40',[(str(row['year'])+(' (previsione)' if row['status']=='previsione' else ' (proposta)' if row['status']=='proposta' else ''),number(report,row['metric'])) for row in serie['rows']],serie['note'],40)
        story.append(refs(serie['sourceIds']))
    heading('I lavori che hanno lasciato una traccia documentale')
    story.append(p(sr['scope'],'small'))
    for era in sr['chronology']:
        story.extend([p(era['period']+' · '+era['actor'],'h3'),p(era['title'],'lead'),p(era['text']),refs(era['sourceIds'])])
    heading(sr['result2024']['title'])
    story.extend(p(text) for text in sr['result2024']['paragraphs'])
    chart('Come si compongono i 205 piani monitorati','Numero di piani · esercizio 2024',[(label,number(report,key)) for label,key in [('Solo finalità oggetto di revisione','sr-pg-dedicated'),('Più finalità nello stesso conto','sr-pg-composite'),('Fondi da ripartire','sr-pg-funds')]],'107 + 69 + 29 = 205. Sono piani del monitoraggio 2024, non le 5.395 righe a capitolo del rendiconto 2025: anno e livello contabile non coincidono.')
    story.append(refs(sr['result2024']['sourceIds']))
    heading('Otto temi: dalla proposta al seguito documentato')
    for t in sr['tracker']:
        story.extend([p(t['theme'],'h3'),p(t['status'],'caption'),markup('<b>Proposta.</b> '+escape(t['proposal'])),markup('<b>Seguito.</b> '+escape(t['result'])),markup('<b>Misura utile.</b> '+escape(t['measure'])),refs(t['sourceIds'])])
    story.append(p(sr['conclusion'],'lead'))
    heading('Che cosa non funziona, e perché','04 · I RISCONTRI')
    for chapter in report['chapters'][:3]:
        heading(chapter['title']);story.append(p(chapter['intro']))
        if chapter['id']=='crediti-e-riscossione':
            story.append(p(report['audit']['inpsContext']['title'],'h3'));context('inpsContext')
            chart('Il portafoglio ADER-INPS a fine 2024','Miliardi € · stock di crediti',[(r['label'],Decimal(r['billion'])) for r in report['audit']['portfolios']],'Le categorie sommano 135,2 miliardi. I 18,1 di potenziale recupero sono lordi, non un incasso garantito.')
        for key in chapter['caseIds']:
            index=next(i for i,c in enumerate(report['cases'],1) if c['id']==key)
            source_case(report['cases'][index-1],index)
    heading(report['audit']['foreign']['title'],'05 · AIUTI E POLITICA ESTERA');context('foreign')
    chart('Risorse per l’aiuto pubblico allo sviluppo','Milioni € · stanziamenti iniziali 2024',[(r['label'],Decimal(r['million'])) for r in report['audit']['foreignRows']],'Dotazioni di bilancio, non flussi interamente pagati all’estero. EPF e APS sono perimetri diversi.')
    chapter=report['chapters'][3];heading(chapter['title'],'06 · LA QUALITÀ DEI DOCUMENTI');story.append(p(chapter['intro']))
    for key in chapter['caseIds']:
        index=next(i for i,c in enumerate(report['cases'],1) if c['id']==key);source_case(report['cases'][index-1],index)
    heading('Correggere il meccanismo, non soltanto il numero');story.append(p(report['audit']['readerOutcome'],'lead'))
    heading('Lo Stato non è tutta la pubblica amministrazione','CONTESTO · LE DIECI FUNZIONI')
    story.extend([p(report['macro']['note']),p(it(Decimal(report['macro']['totalCents'])/Decimal('100000000000'))+' miliardi € · '+str(report['macro']['year']),'number')])
    rows=[['Funzione','Miliardi €','Su 100 €','Scala 0-100']]
    for s in sorted(report['sectors'],key=lambda s:int(s['amountCents']),reverse=True):
        share=Decimal(s['amountCents'])/Decimal(report['macro']['totalCents'])*100
        rows.append([s['label'],it(Decimal(s['amountCents'])/Decimal('100000000000')),it(share),MiniBar(share)])
    story.extend([table(rows,[width*.44,width*.18,width*.16,width*.22]),refs(['cofog'])])
    for s in report['sectors']:story.extend([p(s['label'],'h3'),p(s['note']),p(s['reading'],'small')])
    heading(report['municipal']['title']);story.extend(p(text) for text in report['municipal']['paragraphs'])
    for ch in report['municipal']['charts']:chart(ch['title'],ch['unit'],[(r['label'],number(report,r['metric'])) for r in ch['rows']],ch['note'],100 if ch['unit']=='%' else None)
    story.append(refs(report['municipal']['sourceIds']))
    heading('Perimetro, verifiche e ipotesi scartate','APPENDICE · METODO')
    story.extend(p(text) for text in report['method'])
    for item in report['audit']['exclusions']:story.extend([p(item['title'],'h3'),p(item['reason'],'small')])
    story.extend([p('Copertura misurabile','h3'),p('15 aggregati ministeriali; 105 importi acquisiti; 45 identità contabili; 7 riconciliazioni di colonna; 10 osservazioni storiche con controllo delle componenti. Le identità passano; non dimostrano che ogni spesa sia efficiente.'),p('Il controllo automatico completo e le tabelle in centesimi sono nel JSON e nei CSV pubblici. Il comando con --require-upstream confronta le trascrizioni con il file RGS integrale della repository; il registro distingue questo passaggio dal controllo sui byte del CSV originario.','small')])
    heading('Calcoli riproducibili')
    story.append(p('Le formule seguenti completano quelle già presenti nei casi. Non aggregano costi di periodi o perimetri diversi.','small'))
    shown={key for c in report['cases'] if c['math'] for key in c['math']['calculationIds']}
    for c in report['calculations']:
        if c['id'] not in shown:
            story.append(KeepTogether([p(c['label'],'h3'),p(formula(report,c),'formula')]))
    heading('Le parole del bilancio')
    for g in report['glossary']:story.append(markup('<b>'+escape(g['term'])+'.</b> '+escape(g['definition']),'body'))
    heading('Spending review: documenti originali e archivi','APPENDICE · BIBLIOTECA RAGIONATA')
    story.append(p('I collegamenti distinguono testi letti, copie reperite e documenti individuati nei cataloghi. Una voce censita non è un rapporto integralmente rianalizzato.','small'))
    for d in sr['documents']:
        story.extend([markup('<b>'+escape(d['period'])+'</b> · <link href="'+escape(d['url'],{chr(34):'&quot;'})+'">'+escape(d['title'])+'</link>','h3'),p(d['reading'],'caption'),p(d['use'],'small')])
    heading('Le conclusioni che non ricaviamo dai documenti')
    for c in sr['corrections']:
        story.extend([p(c['claim'],'h3'),p(c['finding'])])
    for text in sr['notReconstructed']:story.append(p(text,'small'))
    heading('Documenti e riferimenti','FONTI')
    story.append(p('Ogni titolo apre la fonte. Periodi, modalità di lettura e limiti di accesso sono nel registro tecnico. Nessun hash del documento originale è inventato.','small'))
    for i,s in enumerate(report['sources'],1):
        title=markup(f'<a name="source-{s["id"]}"/>[{i}] <link href="{escape(s["url"],{chr(34):"&quot;"})}"><b>{escape(s["publisher"])}</b>: {escape(s["title"])}</link>','source')
        story.append(KeepTogether([title,p(s['locator'],'source'),Spacer(1,2)]))
    story.extend([p('Prove della prima analisi','h3'),markup(f'<link href="{report["legacyEvidenceUrl"]}">Archivio congelato: input, estratti, ricevute e calcoli della prima analisi.</link>','small')])
    def page(canvas, document):canvas.header(document)
    doc.build(story,onFirstPage=page,onLaterPages=page,canvasmaker=ReportCanvas)
    return {'logoPath':'public/brand/icon-48.png','logoSha256':hashlib.sha256(logo.read_bytes()).hexdigest(),
            'font':'Helvetica (PDF); token del progetto sul sito','layout':'continuous-flow; vector data charts; no forced case page breaks',
            'palette':{'ink':'#182b3a','teal':'#176575','accent':'#b42332','paper':'#f3f5f7'}}


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
