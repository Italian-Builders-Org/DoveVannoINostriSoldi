#!/usr/bin/env python3
"""Offline chapter-level screening of the locked RGS 2025 CSV.

The CLI accepts only the exact documented source bytes. It never downloads data,
changes the published report or interprets a flag as fraud/waste. Unit tests use
synthetic rows through analyse_rows(), not through a production unlock switch.
"""
from __future__ import annotations
import argparse
import csv
import hashlib
import io
import json
import os
import re
from collections import Counter, defaultdict
from decimal import Decimal
from pathlib import Path

SOURCE_URL = 'https://bdap-opendata.rgs.mef.gov.it/export/csv/2025---Rendiconto-Pubblicato-Elaborabile-Spese-Capitolo.csv'
EXPECTED_SHA256 = '2887db4905d30445abc795083f2861f969173baf235a56917932c9fcc242e368'
EXPECTED_BYTES = 4196648
EXPECTED_ROWS = 5395
DIMENSIONS = ['Esercizio Finanziario','Stato di Previsione','Amministrazione',
    'Unità di voto 1° livello','Unità di voto 2° livello','Numero Capitolo di Spesa',
    'Capitolo di Spesa','Codice Titolo','Titolo','Codice Categoria','Categoria',
    'Codice Puntato CE','Codice Missione','Missione','Codice Programma','Programma',
    'Codice Centro Responsabilità','Centro Responsabilità','Codice Azione','Azione']
AMOUNTS = ['Previsioni Iniziali RS','Previsioni Iniziali CP','Previsioni Iniziali CS',
    'Variazioni RS','Variazioni CP','Variazioni CS','Previsioni Definitive RS',
    'Previsioni Definitive CP','Previsioni Definitive CS','Pagato RS','Pagato CP',
    'Pagato CS','Rimasto da Pagare RS','Rimasto da Pagare CP','Totale RS','Totale CP',
    'Totale CS','Economie-Maggiori Spese RS','Economie-Maggiori Spese CP',
    'Economie-Maggiori Spese CS','RS al 31/12']
HEADERS = DIMENSIONS + AMOUNTS
# Each row can be checked independently. Economie are Totale - definitive;
# their negative sign is not a negative payment or an arithmetic error.
IDENTITIES = []
for basis in ('RS','CP','CS'):
    IDENTITIES.append((f'definitive-{basis}', f'Previsioni Definitive {basis}',
                       [(1,f'Previsioni Iniziali {basis}'),(1,f'Variazioni {basis}')]))
IDENTITIES += [
    ('pagato-CS','Pagato CS',[(1,'Pagato CP'),(1,'Pagato RS')]),
    ('totale-RS','Totale RS',[(1,'Pagato RS'),(1,'Rimasto da Pagare RS')]),
    ('totale-CP','Totale CP',[(1,'Pagato CP'),(1,'Rimasto da Pagare CP')]),
    ('totale-CS','Totale CS',[(1,'Pagato CS')]),
]
for basis in ('RS','CP','CS'):
    IDENTITIES.append((f'economie-{basis}',f'Economie-Maggiori Spese {basis}',
                       [(1,f'Totale {basis}'),(-1,f'Previsioni Definitive {basis}')]))
IDENTITIES.append(('residui-fine','RS al 31/12',[(1,'Rimasto da Pagare CP'),(1,'Rimasto da Pagare RS')]))


def cents(raw: str) -> int:
    """Strict integer-cent parsing; blank/ambiguous/more-than-cent values fail."""
    value = raw.strip().replace('\u00a0','')
    if re.fullmatch(r'[+-]?\d+', value):
        normalized = value
    elif re.fullmatch(r'[+-]?(?:\d+|\d{1,3}(?:\.\d{3})+),\d{1,2}', value):
        normalized = value.replace('.','').replace(',','.')
    elif re.fullmatch(r'[+-]?\d+\.\d{1,2}',value):
        normalized = value
    else:
        raise ValueError('Importo assente o ambiguo: '+repr(raw))
    return int(Decimal(normalized)*100)


def analyse_rows(rows: list[dict[str,str]], materiality_cents: int = 100000000,
                 ratio_percent: int = 80) -> dict:
    if not rows or materiality_cents <= 0 or not 1 <= ratio_percent <= 100:
        raise ValueError('Parametri di screening non validi')
    mismatches, signals, duplicates = [], [], []
    seen = {}; totals = defaultdict(lambda: defaultdict(int)); counts = Counter()
    for line_no,row in enumerate(rows,2):
        if set(row) != set(HEADERS) or any(value is None for value in row.values()):
            raise ValueError(f'Schema non valido, riga {line_no}')
        if row['Esercizio Finanziario'].strip() != '2025':
            raise ValueError('Anno diverso dal perimetro 2025')
        # Preserve codes as strings. A chapter number is NOT globally unique.
        key = tuple(row[k].strip() for k in DIMENSIONS)
        if key in seen:
            duplicates.append({'line':line_no,'firstLine':seen[key], 'meaning':'dimensioni identiche; non prova di doppio pagamento'})
        else: seen[key]=line_no
        values = {key:cents(row[key]) for key in AMOUNTS}
        ministry = row['Stato di Previsione']; title = row['Codice Titolo']
        group = ministry+'|'+title
        counts[group]+=1
        for field,value in values.items():totals[group][field]+=value
        pointer={'line':line_no,'ministry':ministry,'chapter':row['Numero Capitolo di Spesa'],
                 'title':title,'mission':row['Codice Missione'],'program':row['Codice Programma'],
                 'action':row['Codice Azione'],'description':row['Capitolo di Spesa']}
        for name,left,terms in IDENTITIES:
            expected=sum(coefficient*values[field] for coefficient,field in terms)
            if values[left] != expected:
                mismatches.append({**pointer,'rule':name,'leftCents':str(values[left]),
                                   'rightCents':str(expected),'differenceCents':str(values[left]-expected)})
        committed=values['Totale CP']; remaining=values['Rimasto da Pagare CP']
        if committed>0 and remaining>=materiality_cents and remaining*100 >= committed*ratio_percent:
            signals.append({**pointer,'rule':'quota-impegni-non-pagata','amountCents':str(remaining),
                            'denominatorCents':str(committed),'meaning':'screening di esecuzione; scadenza contrattuale non disponibile'})
        initial=values['Previsioni Iniziali CP']; variation=values['Variazioni CP']
        if initial>0 and abs(variation)>=materiality_cents and abs(variation)*100>=initial*ratio_percent:
            signals.append({**pointer,'rule':'variazione-materiale-competenza','amountCents':str(variation),
                            'denominatorCents':str(initial),'meaning':'variazione da collegare all’atto; non spreco accertato'})
        if values['Economie-Maggiori Spese CP']>0:
            signals.append({**pointer,'rule':'maggiori-spese-competenza','amountCents':str(values['Economie-Maggiori Spese CP']),
                            'denominatorCents':str(values['Previsioni Definitive CP']),
                            'meaning':'eccedenza rispetto alla previsione definitiva; verificare la natura contabile'})
    return {'schemaVersion':1,'year':2025,'rowsProcessed':len(rows),'monetaryCells':len(rows)*len(AMOUNTS),
            'arithmeticChecks':len(rows)*len(IDENTITIES),'arithmeticMismatches':mismatches,
            'duplicateDimensions':duplicates,'signals':signals,
            'screening':{'materialityCents':str(materiality_cents),'ratioPercent':ratio_percent,
                         'notFraudOrWasteClassifier':True,'deadlinesKnown':False},
            'totalsByMinistryAndTitle':[{'ministry':key.split('|')[0],'title':key.split('|')[1],
                                       'rowCount':counts[key],'amountsCents':{field:str(value) for field,value in sorted(amounts.items())}}
                                      for key,amounts in sorted(totals.items())],
            'scope':'Righe del Rendiconto dello Stato: non fatture, non tutta la PA. CP/CS/RS non si sommano. Titoli di spesa separati; il rimborso prestiti non è spesa finale.'}


def load_locked(path: Path) -> tuple[bytes,list[dict[str,str]]]:
    if path.stat().st_size != EXPECTED_BYTES: raise ValueError('Dimensione diversa dalla fonte congelata')
    raw=path.read_bytes()
    if hashlib.sha256(raw).hexdigest()!=EXPECTED_SHA256:raise ValueError('SHA-256 diverso: serve una revisione esplicita della fonte')
    reader=csv.DictReader(io.StringIO(raw.decode('cp1252')),delimiter=';')
    if reader.fieldnames != HEADERS: raise ValueError('Intestazioni diverse dal contratto RGS: nessun adattamento silenzioso')
    rows=list(reader)
    if len(rows)!=EXPECTED_ROWS:raise ValueError('Numero di righe inatteso')
    return raw,rows


def main() -> None:
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('csv',type=Path);parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--materiality-euros',type=int,default=1000000)
    parser.add_argument('--ratio-percent',type=int,default=80)
    args=parser.parse_args()
    if args.output.exists():raise ValueError('Output già esistente: usare un nuovo file per non sovrascrivere prove')
    raw,rows=load_locked(args.csv)
    result=analyse_rows(rows,args.materiality_euros*100,args.ratio_percent)
    result['source']={'url':SOURCE_URL,'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw),'originalBytesVerified':True}
    args.output.parent.mkdir(parents=True,exist_ok=True)
    # Exclusive creation prevents replacing an output after the preflight check.
    with args.output.open('x',encoding='utf-8') as stream:
        json.dump(result,stream,ensure_ascii=False,indent=2);stream.write('\n');stream.flush();os.fsync(stream.fileno())
    print(json.dumps({'rows':len(rows),'checks':result['arithmeticChecks'],
                      'mismatches':len(result['arithmeticMismatches']),'signals':len(result['signals']),
                      'publishedReportChanged':False}))
    if result['arithmeticMismatches'] or result['duplicateDimensions']:
        raise SystemExit(2)

if __name__=='__main__':
    try:main()
    except (OSError,ValueError,UnicodeError,csv.Error) as error:raise SystemExit('STOP: '+str(error))
