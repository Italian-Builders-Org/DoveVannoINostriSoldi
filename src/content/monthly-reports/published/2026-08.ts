import type { PublishedMonthlyReport } from "@/lib/monthly-reports-contract";

export const monthlyReport202608 = {
  "status": "published",
  "issueMonth": "2026-08",
  "title": "Imprese e territori",
  "dek": "Lo stock delle sedi di impresa rallenta, ma il dato nazionale nasconde differenze territoriali che chiedono prudenza e nuove domande.",
  "teaser": "Lo stock delle sedi attive scende rispetto a un anno prima. La mappa regionale mostra un segnale molto più ampio in Campania, senza dirci ancora perché.",
  "keywords": [
    "imprese",
    "territori",
    "dati pubblici"
  ],
  "publication": {
    "publishedOn": "2026-09-06",
    "dataCutoff": "2026-09-05"
  },
  "contentRevision": 1,
  "corrections": [],
  "inBrief": [
    "active-stock-latest",
    "public-debt-latest",
    "municipal-payments-ytd"
  ],
  "lead": {
    "title": "La storia del mese",
    "paragraphs": [
      {
        "text": "Quando diciamo che in Italia ci sono 5.022.940 imprese attive, la frase sembra più semplice del dato. La misura usata in questo report conta le sedi di impresa che risultano attive alla fine di luglio 2026. È uno stock amministrativo: una fotografia in una data precisa. Non è il fatturato prodotto dalle aziende, non conta i gruppi societari come soggetti economici unici e non misura quante persone lavorano. Una sede piccola e una grande entrano entrambe nel conteggio come una unità.",
        "evidenceIds": ["company-active-stock"]
      },
      {
        "text": "Questa distinzione è importante perché impedisce di attribuire al numero più significati di quanti ne abbia. Lo stock può cambiare per iscrizioni, cessazioni, trasformazioni e aggiornamenti amministrativi. Il confronto tra due mesi descrive quindi la differenza tra due fotografie, non il semplice totale delle aperture meno le chiusure avvenute nel mezzo. Per capire la vitalità economica servirebbero altre misure, per esempio occupazione, produzione e demografia d'impresa, ciascuna con il proprio perimetro.",
        "evidenceIds": ["company-active-stock"]
      },
      {
        "text": "La serie mensile comincia ad aprile 2025 con 5.052.299 sedi e raggiunge il valore più alto del periodo osservato a settembre 2025, con 5.066.352. Dopo la discesa che porta a 4.986.171 sedi nel gennaio 2026, il conteggio risale per sei mesi consecutivi e arriva a 5.022.940 a luglio. Il recupero rispetto a gennaio è visibile, ma il livello resta inferiore alle 5.063.930 sedi registrate nel luglio 2025.",
        "evidenceIds": ["company-active-stock"]
      },
      {
        "text": "Il confronto annuale chiude così con 40.990 sedi attive in meno, circa lo 0,81% dello stock iniziale. Il dato nazionale, però, è una somma di traiettorie regionali diverse. Proprio questa differenza di scala è il centro del primo numero: partire da un totale leggibile, poi aprirlo per territorio, senza confondere una variazione osservata con una spiegazione già trovata.",
        "evidenceIds": ["company-active-stock"]
      }
    ]
  },
  "facts": [
    {
      "id": "active-stock-latest",
      "label": "Sedi di impresa attive",
      "value": {
        "kind": "count",
        "value": 5022940,
        "unit": "sedi di impresa"
      },
      "plainLanguage": "Al 2026-07-31 risultano 5.022.940 sedi di impresa attive in Italia.",
      "referencePeriod": {
        "kind": "date",
        "date": "2026-07-31"
      },
      "perimeter": "Stock nazionale delle sedi di impresa attive, tutte le regioni e sezioni ATECO 2025.",
      "denominator": null,
      "caveat": "Conta sedi di impresa attive, non ricavi e non gruppi societari.",
      "evidenceIds": [
        "company-active-stock"
      ]
    },
    {
      "id": "active-stock-year-change",
      "label": "Variazione nazionale in un anno",
      "value": {
        "kind": "count",
        "value": -40990,
        "unit": "sedi di impresa"
      },
      "plainLanguage": "Tra 2025-07-31 e 2026-07-31 lo stock nazionale cambia di -40.990 sedi.",
      "referencePeriod": {
        "kind": "range",
        "from": "2025-07-31",
        "to": "2026-07-31",
        "completeness": "complete"
      },
      "perimeter": "Differenza tra due stock nazionali a fine mese.",
      "denominator": null,
      "caveat": "È una variazione dello stock: non equivale al saldo fra sole aperture e chiusure nel periodo.",
      "evidenceIds": [
        "company-active-stock"
      ]
    },
    {
      "id": "largest-territorial-signal",
      "label": "Segnale territoriale più ampio",
      "value": {
        "kind": "count",
        "value": -26641,
        "unit": "sedi di impresa"
      },
      "plainLanguage": "Campania mostra la maggiore variazione assoluta fra 2025-07-31 e 2026-07-31.",
      "referencePeriod": {
        "kind": "range",
        "from": "2025-07-31",
        "to": "2026-07-31",
        "completeness": "complete"
      },
      "perimeter": "Stock delle sedi attive nella regione Campania.",
      "denominator": null,
      "caveat": "Il confronto descrive un segnale e non ne identifica automaticamente la causa.",
      "evidenceIds": [
        "company-active-stock"
      ]
    },
    {
      "id": "public-debt-latest",
      "label": "Debito pubblico",
      "value": {
        "kind": "money",
        "cents": 320724730000000,
        "display": "compact"
      },
      "plainLanguage": "A fine giugno 2026 il debito pubblico è pari a circa 3.207,2 miliardi di euro.",
      "referencePeriod": {
        "kind": "date",
        "date": "2026-06-30"
      },
      "perimeter": "Debito lordo delle Amministrazioni pubbliche italiane.",
      "denominator": null,
      "caveat": "I dati recenti possono essere provvisori e soggetti a revisione. Il debito è uno stock a fine mese; gli interessi sono una spesa annuale e hanno una periodicità diversa.",
      "evidenceIds": [
        "public-debt-stock"
      ]
    },
    {
      "id": "municipal-payments-ytd",
      "label": "Pagamenti comunali registrati",
      "value": {
        "kind": "money",
        "cents": 7293920475907,
        "display": "compact"
      },
      "plainLanguage": "Da gennaio ad agosto 2026 i pagamenti comunali registrati ammontano a circa 72,9 miliardi di euro; agosto è parziale.",
      "referencePeriod": {
        "kind": "range",
        "from": "2026-01-01",
        "to": "2026-08-25",
        "completeness": "partial"
      },
      "perimeter": "pagamenti di cassa SIOPE dei Comuni",
      "denominator": null,
      "caveat": "Il totale regionale rappresenta i pagamenti dei Comuni con sede nella regione; non misura tutta la spesa pubblica effettuata fisicamente nel territorio. Il valore pro capite usa la popolazione dell'anagrafica SIOPE: turismo, pendolarismo, ricostruzioni e servizi sovracomunali possono alterare il confronto.",
      "evidenceIds": [
        "municipal-payments"
      ]
    }
  ],
  "rubrics": {
    "numbers": {
      "title": "Numeri da ricordare",
      "paragraphs": [
        {
          "text": "Il numero principale è lo stock di 5.022.940 sedi attive al 31 luglio 2026. Serve a descrivere la dimensione del registro in quel momento, non il valore economico delle imprese. La differenza rispetto al 31 luglio 2025 è negativa per 40.990 sedi. Grafico e tabella derivano dalle stesse sedici righe congelate in questa edizione: un aggiornamento futuro della fonte non cambierà la storia pubblicata.",
          "evidenceIds": ["company-active-stock"]
        },
        {
          "text": "Tra gli aggiornamenti arrivati entro il cutoff editoriale compare anche il debito pubblico: 3.207,2 miliardi di euro a fine giugno 2026. È uno stock delle Amministrazioni pubbliche, con un periodo diverso da quello delle imprese e dati recenti che possono essere rivisti. Lo riportiamo come numero autonomo, senza sommarlo né confrontarlo con conteggi di sedi, flussi comunali o altre grandezze incompatibili.",
          "evidenceIds": ["public-debt-stock"]
        },
        {
          "text": "I pagamenti di cassa registrati da SIOPE per i Comuni arrivano a 72,9 miliardi di euro da gennaio ad agosto 2026. Il dato è stato osservato il 25 agosto, quindi agosto era ancora parziale. Riguarda i Comuni e non tutta la spesa pubblica italiana; inoltre attribuisce territorialmente gli enti in base alla sede. Anche questo valore resta separato dagli altri due e conserva il proprio periodo incompleto.",
          "evidenceIds": ["municipal-payments"]
        }
      ]
    },
    "territories": {
      "title": "Territori",
      "paragraphs": [
        {
          "text": "Il confronto tra luglio 2025 e luglio 2026 copre tutte le venti regioni. La Campania passa da 503.614 a 476.973 sedi attive: 26.641 in meno, pari al 5,29% dello stock regionale iniziale. È la variazione assoluta e percentuale più ampia della tabella. Subito dopo, per riduzione assoluta, vengono Veneto, Emilia-Romagna e Toscana, ma con distanze molto inferiori e cali vicini all'1%.",
          "evidenceIds": ["company-active-stock"]
        },
        {
          "text": "Sei regioni mostrano invece una variazione positiva. Il Lazio registra l'aumento assoluto maggiore, con 1.769 sedi in più, mentre Valle d'Aosta e Trentino-Alto Adige hanno gli incrementi percentuali più alti, rispettivamente 0,76% e 0,73%. Valori assoluti e percentuali rispondono a domande diverse: il primo misura quante unità cambiano, il secondo rapporta la differenza alla dimensione iniziale della stessa regione.",
          "evidenceIds": ["company-active-stock"]
        },
        {
          "text": "La classifica non assegna voti ai territori. Una regione grande può avere una differenza assoluta rilevante ma piccola in proporzione; una regione piccola può mostrare l'opposto. Per questo la tabella conserva per ogni riga lo stock iniziale, quello finale, la differenza e la percentuale. Il denominatore della percentuale è sempre lo stock della stessa regione a luglio 2025.",
          "evidenceIds": ["company-active-stock"]
        }
      ]
    },
    "signal": {
      "title": "Un segnale da capire",
      "paragraphs": [
        {
          "text": "La discontinuità della Campania merita un approfondimento, non una causa pronta. Da questi dati non possiamo stabilire se il cambiamento dipenda soprattutto da cessazioni, riallineamenti del registro, trasformazioni giuridiche, riclassificazioni ATECO o altri fenomeni. Non possiamo nemmeno tradurlo direttamente in posti di lavoro persi o in minore produzione. Farlo significherebbe cambiare indicatore senza nuove prove.",
          "evidenceIds": ["company-active-stock"]
        },
        {
          "text": "Il modo corretto di trattare il segnale è formulare domande verificabili. La variazione è concentrata in alcuni settori? Compare anche nelle province? È visibile nelle serie di iscrizioni e cessazioni? Coincide con una nota metodologica o con un aggiornamento della fonte? Finché queste verifiche non sono disponibili, il report mostra l'anomalia, ne definisce il perimetro e si ferma prima dell'interpretazione causale.",
          "evidenceIds": ["company-active-stock"]
        }
      ]
    },
    "sources": {
      "title": "Fonti e limiti",
      "paragraphs": [
        {
          "text": "La storia principale usa lo stock mensile pubblicato dalla Camera di commercio delle Marche su dati InfoCamere. L'artefatto verificato contiene aggregati per regione, sezione ATECO 2025 e mese. Questa edizione congela le righe da aprile 2025 a luglio 2026, la revisione Git e l'impronta dell'artefatto. Nei dati pubblici del report non compaiono percorsi locali o collegamenti alla macchina usata per elaborarli.",
          "evidenceIds": ["company-active-stock"]
        },
        {
          "text": "Il conteggio riguarda sedi attive e non ricavi, gruppi societari o occupazione. La somma nazionale e i confronti regionali descrivono stock a fine mese. Non ricostruiamo flussi di apertura e chiusura e non deduciamo la salute economica di un territorio da un solo indicatore. Le percentuali regionali usano il valore di luglio 2025 come denominatore e sono arrotondate a due decimali nella presentazione.",
          "evidenceIds": ["company-active-stock"]
        },
        {
          "text": "Le due note brevi usano fonti e calendari autonomi. Il debito viene dalla Banca d'Italia ed è riferito a fine giugno 2026; i pagamenti comunali derivano da SIOPE e coprono il periodo da gennaio ad agosto 2026, ancora parziale al momento della verifica. Nessuno dei due entra nei grafici sulle imprese e nessuna delle tre misure viene sommata alle altre.",
          "evidenceIds": ["public-debt-stock", "municipal-payments"]
        }
      ]
    },
    "nextMonth": {
      "title": "Il mese prossimo",
      "paragraphs": [
        {
          "text": "Nel prossimo numero proveremo a seguire il segnale territoriale con fonti che distinguano meglio la dinamica d'impresa. Cercheremo serie comparabili su iscrizioni, cessazioni e distribuzione settoriale, mantenendo separati stock, flussi e indicatori del lavoro. Se le prove non saranno abbastanza solide entro il nuovo cutoff, lo diremo apertamente e sceglieremo una storia diversa.",
          "evidenceIds": []
        }
      ]
    }
  },
  "figures": [
    {
      "id": "national-active-stock",
      "kind": "time-series",
      "title": "Sedi di impresa attive, mese per mese",
      "takeaway": "Lo stock nazionale arriva a 5.022.940 sedi al 2026-07-31.",
      "accessibleSummary": "Serie mensile nazionale ordinata cronologicamente; i valori esatti sono nella tabella associata.",
      "referencePeriod": {
        "kind": "range",
        "from": "2025-04-01",
        "to": "2026-07-31",
        "completeness": "complete"
      },
      "perimeter": "Stock nazionale delle sedi di impresa attive.",
      "denominator": null,
      "caveat": "Conta sedi di impresa attive, non ricavi e non gruppi societari.",
      "evidenceIds": [
        "company-active-stock"
      ],
      "visualSeriesId": "active",
      "series": [
        {
          "id": "active",
          "label": "Sedi attive",
          "format": "count"
        }
      ],
      "rows": [
        {
          "key": "2025-04",
          "label": "2025-04",
          "values": {
            "active": {
              "kind": "count",
              "value": 5052299,
              "unit": "sedi di impresa"
            }
          }
        },
        {
          "key": "2025-05",
          "label": "2025-05",
          "values": {
            "active": {
              "kind": "count",
              "value": 5059334,
              "unit": "sedi di impresa"
            }
          }
        },
        {
          "key": "2025-06",
          "label": "2025-06",
          "values": {
            "active": {
              "kind": "count",
              "value": 5063175,
              "unit": "sedi di impresa"
            }
          }
        },
        {
          "key": "2025-07",
          "label": "2025-07",
          "values": {
            "active": {
              "kind": "count",
              "value": 5063930,
              "unit": "sedi di impresa"
            }
          }
        },
        {
          "key": "2025-08",
          "label": "2025-08",
          "values": {
            "active": {
              "kind": "count",
              "value": 5065117,
              "unit": "sedi di impresa"
            }
          }
        },
        {
          "key": "2025-09",
          "label": "2025-09",
          "values": {
            "active": {
              "kind": "count",
              "value": 5066352,
              "unit": "sedi di impresa"
            }
          }
        },
        {
          "key": "2025-10",
          "label": "2025-10",
          "values": {
            "active": {
              "kind": "count",
              "value": 5063311,
              "unit": "sedi di impresa"
            }
          }
        },
        {
          "key": "2025-11",
          "label": "2025-11",
          "values": {
            "active": {
              "kind": "count",
              "value": 5053280,
              "unit": "sedi di impresa"
            }
          }
        },
        {
          "key": "2025-12",
          "label": "2025-12",
          "values": {
            "active": {
              "kind": "count",
              "value": 5034652,
              "unit": "sedi di impresa"
            }
          }
        },
        {
          "key": "2026-01",
          "label": "2026-01",
          "values": {
            "active": {
              "kind": "count",
              "value": 4986171,
              "unit": "sedi di impresa"
            }
          }
        },
        {
          "key": "2026-02",
          "label": "2026-02",
          "values": {
            "active": {
              "kind": "count",
              "value": 4990808,
              "unit": "sedi di impresa"
            }
          }
        },
        {
          "key": "2026-03",
          "label": "2026-03",
          "values": {
            "active": {
              "kind": "count",
              "value": 5000391,
              "unit": "sedi di impresa"
            }
          }
        },
        {
          "key": "2026-04",
          "label": "2026-04",
          "values": {
            "active": {
              "kind": "count",
              "value": 5007220,
              "unit": "sedi di impresa"
            }
          }
        },
        {
          "key": "2026-05",
          "label": "2026-05",
          "values": {
            "active": {
              "kind": "count",
              "value": 5014964,
              "unit": "sedi di impresa"
            }
          }
        },
        {
          "key": "2026-06",
          "label": "2026-06",
          "values": {
            "active": {
              "kind": "count",
              "value": 5019166,
              "unit": "sedi di impresa"
            }
          }
        },
        {
          "key": "2026-07",
          "label": "2026-07",
          "values": {
            "active": {
              "kind": "count",
              "value": 5022940,
              "unit": "sedi di impresa"
            }
          }
        }
      ]
    },
    {
      "id": "regional-year-change",
      "kind": "ranked-bars",
      "title": "Differenza regionale in un anno",
      "takeaway": "Campania registra la variazione assoluta più ampia; è un segnale, non una spiegazione.",
      "accessibleSummary": "Le venti regioni sono ordinate dalla variazione assoluta più negativa alla più positiva; la tabella riporta entrambi gli stock, differenza e percentuale.",
      "referencePeriod": {
        "kind": "range",
        "from": "2025-07-31",
        "to": "2026-07-31",
        "completeness": "complete"
      },
      "perimeter": "Stock delle sedi di impresa attive nelle venti regioni italiane.",
      "denominator": "stock regionale delle sedi attive al mese iniziale",
      "caveat": "Le percentuali usano come denominatore lo stock della stessa regione nel mese iniziale.",
      "evidenceIds": [
        "company-active-stock"
      ],
      "visualSeriesId": "delta",
      "series": [
        {
          "id": "previous",
          "label": "2025-07-31",
          "format": "count",
          "tableOnly": true
        },
        {
          "id": "current",
          "label": "2026-07-31",
          "format": "count",
          "tableOnly": true
        },
        {
          "id": "delta",
          "label": "Differenza",
          "format": "count"
        },
        {
          "id": "change",
          "label": "Variazione",
          "format": "percentage",
          "tableOnly": true
        }
      ],
      "rows": [
        {
          "key": "15",
          "label": "Campania",
          "values": {
            "previous": {
              "kind": "count",
              "value": 503614,
              "unit": "sedi di impresa"
            },
            "current": {
              "kind": "count",
              "value": 476973,
              "unit": "sedi di impresa"
            },
            "delta": {
              "kind": "count",
              "value": -26641,
              "unit": "sedi di impresa"
            },
            "change": {
              "kind": "percentage",
              "basisPoints": -529
            }
          }
        },
        {
          "key": "05",
          "label": "Veneto",
          "values": {
            "previous": {
              "kind": "count",
              "value": 419444,
              "unit": "sedi di impresa"
            },
            "current": {
              "kind": "count",
              "value": 415419,
              "unit": "sedi di impresa"
            },
            "delta": {
              "kind": "count",
              "value": -4025,
              "unit": "sedi di impresa"
            },
            "change": {
              "kind": "percentage",
              "basisPoints": -96
            }
          }
        },
        {
          "key": "08",
          "label": "Emilia-Romagna",
          "values": {
            "previous": {
              "kind": "count",
              "value": 387440,
              "unit": "sedi di impresa"
            },
            "current": {
              "kind": "count",
              "value": 383820,
              "unit": "sedi di impresa"
            },
            "delta": {
              "kind": "count",
              "value": -3620,
              "unit": "sedi di impresa"
            },
            "change": {
              "kind": "percentage",
              "basisPoints": -93
            }
          }
        },
        {
          "key": "09",
          "label": "Toscana",
          "values": {
            "previous": {
              "kind": "count",
              "value": 342825,
              "unit": "sedi di impresa"
            },
            "current": {
              "kind": "count",
              "value": 339528,
              "unit": "sedi di impresa"
            },
            "delta": {
              "kind": "count",
              "value": -3297,
              "unit": "sedi di impresa"
            },
            "change": {
              "kind": "percentage",
              "basisPoints": -96
            }
          }
        },
        {
          "key": "13",
          "label": "Abruzzo",
          "values": {
            "previous": {
              "kind": "count",
              "value": 123054,
              "unit": "sedi di impresa"
            },
            "current": {
              "kind": "count",
              "value": 121562,
              "unit": "sedi di impresa"
            },
            "delta": {
              "kind": "count",
              "value": -1492,
              "unit": "sedi di impresa"
            },
            "change": {
              "kind": "percentage",
              "basisPoints": -121
            }
          }
        },
        {
          "key": "07",
          "label": "Liguria",
          "values": {
            "previous": {
              "kind": "count",
              "value": 133473,
              "unit": "sedi di impresa"
            },
            "current": {
              "kind": "count",
              "value": 132116,
              "unit": "sedi di impresa"
            },
            "delta": {
              "kind": "count",
              "value": -1357,
              "unit": "sedi di impresa"
            },
            "change": {
              "kind": "percentage",
              "basisPoints": -102
            }
          }
        },
        {
          "key": "01",
          "label": "Piemonte",
          "values": {
            "previous": {
              "kind": "count",
              "value": 375528,
              "unit": "sedi di impresa"
            },
            "current": {
              "kind": "count",
              "value": 374430,
              "unit": "sedi di impresa"
            },
            "delta": {
              "kind": "count",
              "value": -1098,
              "unit": "sedi di impresa"
            },
            "change": {
              "kind": "percentage",
              "basisPoints": -29
            }
          }
        },
        {
          "key": "10",
          "label": "Umbria",
          "values": {
            "previous": {
              "kind": "count",
              "value": 77904,
              "unit": "sedi di impresa"
            },
            "current": {
              "kind": "count",
              "value": 76849,
              "unit": "sedi di impresa"
            },
            "delta": {
              "kind": "count",
              "value": -1055,
              "unit": "sedi di impresa"
            },
            "change": {
              "kind": "percentage",
              "basisPoints": -135
            }
          }
        },
        {
          "key": "19",
          "label": "Sicilia",
          "values": {
            "previous": {
              "kind": "count",
              "value": 376105,
              "unit": "sedi di impresa"
            },
            "current": {
              "kind": "count",
              "value": 375183,
              "unit": "sedi di impresa"
            },
            "delta": {
              "kind": "count",
              "value": -922,
              "unit": "sedi di impresa"
            },
            "change": {
              "kind": "percentage",
              "basisPoints": -25
            }
          }
        },
        {
          "key": "16",
          "label": "Puglia",
          "values": {
            "previous": {
              "kind": "count",
              "value": 327339,
              "unit": "sedi di impresa"
            },
            "current": {
              "kind": "count",
              "value": 326872,
              "unit": "sedi di impresa"
            },
            "delta": {
              "kind": "count",
              "value": -467,
              "unit": "sedi di impresa"
            },
            "change": {
              "kind": "percentage",
              "basisPoints": -14
            }
          }
        },
        {
          "key": "17",
          "label": "Basilicata",
          "values": {
            "previous": {
              "kind": "count",
              "value": 51500,
              "unit": "sedi di impresa"
            },
            "current": {
              "kind": "count",
              "value": 51173,
              "unit": "sedi di impresa"
            },
            "delta": {
              "kind": "count",
              "value": -327,
              "unit": "sedi di impresa"
            },
            "change": {
              "kind": "percentage",
              "basisPoints": -63
            }
          }
        },
        {
          "key": "06",
          "label": "Friuli-Venezia Giulia",
          "values": {
            "previous": {
              "kind": "count",
              "value": 87029,
              "unit": "sedi di impresa"
            },
            "current": {
              "kind": "count",
              "value": 86702,
              "unit": "sedi di impresa"
            },
            "delta": {
              "kind": "count",
              "value": -327,
              "unit": "sedi di impresa"
            },
            "change": {
              "kind": "percentage",
              "basisPoints": -38
            }
          }
        },
        {
          "key": "14",
          "label": "Molise",
          "values": {
            "previous": {
              "kind": "count",
              "value": 29237,
              "unit": "sedi di impresa"
            },
            "current": {
              "kind": "count",
              "value": 29013,
              "unit": "sedi di impresa"
            },
            "delta": {
              "kind": "count",
              "value": -224,
              "unit": "sedi di impresa"
            },
            "change": {
              "kind": "percentage",
              "basisPoints": -77
            }
          }
        },
        {
          "key": "11",
          "label": "Marche",
          "values": {
            "previous": {
              "kind": "count",
              "value": 131105,
              "unit": "sedi di impresa"
            },
            "current": {
              "kind": "count",
              "value": 131054,
              "unit": "sedi di impresa"
            },
            "delta": {
              "kind": "count",
              "value": -51,
              "unit": "sedi di impresa"
            },
            "change": {
              "kind": "percentage",
              "basisPoints": -4
            }
          }
        },
        {
          "key": "02",
          "label": "Valle d'Aosta",
          "values": {
            "previous": {
              "kind": "count",
              "value": 10787,
              "unit": "sedi di impresa"
            },
            "current": {
              "kind": "count",
              "value": 10869,
              "unit": "sedi di impresa"
            },
            "delta": {
              "kind": "count",
              "value": 82,
              "unit": "sedi di impresa"
            },
            "change": {
              "kind": "percentage",
              "basisPoints": 76
            }
          }
        },
        {
          "key": "20",
          "label": "Sardegna",
          "values": {
            "previous": {
              "kind": "count",
              "value": 142880,
              "unit": "sedi di impresa"
            },
            "current": {
              "kind": "count",
              "value": 143297,
              "unit": "sedi di impresa"
            },
            "delta": {
              "kind": "count",
              "value": 417,
              "unit": "sedi di impresa"
            },
            "change": {
              "kind": "percentage",
              "basisPoints": 29
            }
          }
        },
        {
          "key": "18",
          "label": "Calabria",
          "values": {
            "previous": {
              "kind": "count",
              "value": 156010,
              "unit": "sedi di impresa"
            },
            "current": {
              "kind": "count",
              "value": 156433,
              "unit": "sedi di impresa"
            },
            "delta": {
              "kind": "count",
              "value": 423,
              "unit": "sedi di impresa"
            },
            "change": {
              "kind": "percentage",
              "basisPoints": 27
            }
          }
        },
        {
          "key": "03",
          "label": "Lombardia",
          "values": {
            "previous": {
              "kind": "count",
              "value": 816005,
              "unit": "sedi di impresa"
            },
            "current": {
              "kind": "count",
              "value": 816453,
              "unit": "sedi di impresa"
            },
            "delta": {
              "kind": "count",
              "value": 448,
              "unit": "sedi di impresa"
            },
            "change": {
              "kind": "percentage",
              "basisPoints": 5
            }
          }
        },
        {
          "key": "04",
          "label": "Trentino-Alto Adige",
          "values": {
            "previous": {
              "kind": "count",
              "value": 105645,
              "unit": "sedi di impresa"
            },
            "current": {
              "kind": "count",
              "value": 106419,
              "unit": "sedi di impresa"
            },
            "delta": {
              "kind": "count",
              "value": 774,
              "unit": "sedi di impresa"
            },
            "change": {
              "kind": "percentage",
              "basisPoints": 73
            }
          }
        },
        {
          "key": "12",
          "label": "Lazio",
          "values": {
            "previous": {
              "kind": "count",
              "value": 467006,
              "unit": "sedi di impresa"
            },
            "current": {
              "kind": "count",
              "value": 468775,
              "unit": "sedi di impresa"
            },
            "delta": {
              "kind": "count",
              "value": 1769,
              "unit": "sedi di impresa"
            },
            "change": {
              "kind": "percentage",
              "basisPoints": 38
            }
          }
        }
      ]
    }
  ],
  "evidence": [
    {
      "id": "company-active-stock",
      "datasetId": "company_active_enterprises",
      "publisher": "CCIAA Marche su dati InfoCamere",
      "title": "Imprese attive · stock mensile",
      "publicUrl": "https://opendata.marche.camcom.it/data/Stock-Imprese-Attive-Italia.json",
      "checkedOn": "2026-08-26",
      "referencePeriod": {
        "kind": "range",
        "from": "2025-04-01",
        "to": "2026-07-31",
        "completeness": "complete"
      },
      "perimeter": "Sedi di impresa attive per regione, settore ATECO 2025 e mese; ultimo periodo 31/07/2026.",
      "caveat": "Conta sedi di impresa attive, non ricavi e non gruppi societari.",
      "dataRevision": "d5ddc3a124b67b6254d6c8de0b9057e183b1935d",
      "artifactSha256": "3f4733d0418651a8c8a1eff4b55b58ff129c7d893065a2ad12263dcb1203354e"
    },
    {
      "id": "public-debt-stock",
      "datasetId": "public_debt",
      "publisher": "Banca d'Italia",
      "title": "Finanza pubblica: fabbisogno e debito",
      "publicUrl": "https://www.bancaditalia.it/pubblicazioni/finanza-pubblica/index.html",
      "checkedOn": "2026-08-24",
      "referencePeriod": {
        "kind": "date",
        "date": "2026-06-30"
      },
      "perimeter": "Debito lordo delle Amministrazioni pubbliche italiane a fine mese.",
      "caveat": "I dati recenti possono essere provvisori e soggetti a revisione.",
      "dataRevision": "c7ef754a9e0b298c10103c999a55780668c44823",
      "artifactSha256": "a326a78f2466f27413b801efb26ca532e1f1c9b6e9f97fae0af78277e6706054"
    },
    {
      "id": "municipal-payments",
      "datasetId": "siope_municipal_payments",
      "publisher": "Ragioneria Generale dello Stato · banca dati gestita da Banca d'Italia",
      "title": "Pagamenti di cassa SIOPE dei Comuni",
      "publicUrl": "https://www.siope.it/documenti/siope2/open/last/SIOPE_USCITE.2026.zip",
      "checkedOn": "2026-08-25",
      "referencePeriod": {
        "kind": "month",
        "month": "2026-08",
        "completeness": "partial"
      },
      "perimeter": "pagamenti di cassa SIOPE dei Comuni",
      "caveat": "Il totale regionale rappresenta i pagamenti dei Comuni con sede nella regione; non misura tutta la spesa pubblica effettuata fisicamente nel territorio. Il valore pro capite usa la popolazione dell'anagrafica SIOPE: turismo, pendolarismo, ricostruzioni e servizi sovracomunali possono alterare il confronto.",
      "dataRevision": "ecd8f6d77ad275250645f09fd984538a1f615a1e",
      "artifactSha256": "7153eef3eb18131e91301daa1a75a488f0b697fbf205213ef11ca7edcb2e67c8"
    }
  ],
  "reviewers": []
} as const satisfies PublishedMonthlyReport;
