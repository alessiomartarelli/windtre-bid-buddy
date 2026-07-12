import { test } from 'node:test';
import assert from 'node:assert/strict';

// Test suite "Coupon Caring esclusi dai totali CB" (Task #290, regressione di
// Task #289).
//
// Verifica end-to-end (partendo da un dataset BiSuite grezzo come quello
// scaricato dal sync reale) che le offerte "coupon caring" (COUPON CARING TIED
// / COUPON CARING UNTIED):
//   (a) NON entrino nei totali della card Customer Base (conteggio pezzi,
//       premio stimato, punti) — `calcoloCBPerPdv` in `client/src/lib/calcoloCB.ts`;
//   (b) vengano contate correttamente nella card dedicata "Caring utilizzate"
//       per PDV e per Ragione Sociale (stessa logica di aggregazione della
//       useMemo `caringStats` in DashboardGaraReale.tsx);
//   (c) NON generino un gemello Partnership (`synthesizePartnershipTwins`
//       esclude `coupon_caring`), a differenza dei veri eventi CB
//       (rivincoli/untied) che invece il gemello lo ottengono.
//
// In più, il percorso di MIGRAZIONE: un'org con regole salvate VECCHIE (caring
// mappato sotto cambio_offerta_rivincoli/untied) deve, dopo
// `retargetCaringSavedRules` + `mergeWithDefaultRules`, spostare il caring sotto
// `coupon_caring` senza duplicare le regole né creare gemelli partnership.
//
// Logica pura: `shared/bisuiteMapping.ts` (import relativi) e
// `client/src/lib/calcoloCB.ts` (import via alias @/, risolto da tsx). NON
// serve né dev server né DB.

const {
  getDefaultMappingRules,
  mergeWithDefaultRules,
  mapBiSuiteSale,
  retargetCaringSavedRules,
  COUPON_CARING_CATEGORY,
  COUPON_CARING_LABEL,
} = await import('../shared/bisuiteMapping.ts');

const { calcoloCBPerPdv } = await import('../client/src/lib/calcoloCB.ts');

const COUPON_CARING_TIPOLOGIE_UPPER = ['COUPON CARING TIED', 'COUPON CARING UNTIED'];

// ---------------------------------------------------------------------------
// Helpers per costruire articoli/vendite BiSuite grezzi.
// ---------------------------------------------------------------------------
function articolo(categoria, tipologia) {
  return { categoria: { nome: categoria }, tipologia: { nome: tipologia } };
}
function sale(articoli, clienteTipo = 'PRIVATO') {
  return { cliente: { clienteTipo }, articoli };
}

// Articoli chiave e come devono essere mappati sulla pista CB.
const ART_RIVINCOLO = articolo('RIVINCOLO', 'RIVINCOLO VOCE'); // -> cambio_offerta_rivincoli
const ART_MIA_TIED = articolo('MIA TIED', 'MIA EASYPAY STANDARD'); // -> cambio_offerta_rivincoli
const ART_MIA_UNTIED = articolo('MIA UNTIED', 'MIA UNTIED STANDARD'); // -> cambio_offerta_untied
const ART_CARING_TIED = articolo('MIA TIED', 'COUPON CARING TIED'); // -> coupon_caring
const ART_CARING_UNTIED = articolo('MIA UNTIED', 'COUPON CARING UNTIED'); // -> coupon_caring

// Regole effettive usate dal motore (default + gemelli partnership sintetici).
const RULES = mergeWithDefaultRules(getDefaultMappingRules());

// Aggrega gli articoli mappati di un insieme di vendite in item {pista,
// targetCategory, pezzi}, replicando `byPdv[...].items` costruito dal server.
function aggregateItems(sales) {
  const map = new Map();
  for (const s of sales) {
    for (const m of mapBiSuiteSale(s, RULES)) {
      const key = `${m.pista}:${m.targetCategory}`;
      map.set(key, (map.get(key) || 0) + 1);
    }
  }
  return Array.from(map.entries()).map(([key, pezzi]) => {
    const [pista, targetCategory] = key.split(':');
    return { pista, targetCategory, pezzi };
  });
}

// Stessa condizione della dashboard: caring = pista cb + coupon_caring.
function isCaringItem(pista, targetCategory) {
  return pista === 'cb' && targetCategory === COUPON_CARING_CATEGORY;
}

// ===========================================================================
// MAPPING — le tipologie caring finiscono su cb:coupon_caring e SOLO lì.
// ===========================================================================
test('mapping: caring articles map to cb:coupon_caring only (no other pista)', () => {
  for (const art of [ART_CARING_TIED, ART_CARING_UNTIED]) {
    const mapped = mapBiSuiteSale(sale([art]), RULES);
    assert.equal(mapped.length, 1, 'caring article should map to exactly one category');
    assert.equal(mapped[0].pista, 'cb');
    assert.equal(mapped[0].targetCategory, COUPON_CARING_CATEGORY);
    assert.equal(mapped[0].targetLabel, COUPON_CARING_LABEL);
    assert.ok(
      !mapped.some((m) => m.pista === 'partnership'),
      'caring must NOT produce a partnership twin',
    );
  }
});

test('mapping: real CB events (rivincoli/untied) DO get a partnership twin', () => {
  // Sanity: conferma che il gemello partnership esiste per i veri eventi CB,
  // così l'assenza di gemello sul caring è un comportamento mirato e non un
  // difetto generale della sintesi dei gemelli.
  for (const [art, cat] of [
    [ART_RIVINCOLO, 'cambio_offerta_rivincoli'],
    [ART_MIA_UNTIED, 'cambio_offerta_untied'],
  ]) {
    const mapped = mapBiSuiteSale(sale([art]), RULES);
    assert.ok(mapped.some((m) => m.pista === 'cb' && m.targetCategory === cat), `cb:${cat} atteso`);
    assert.ok(
      mapped.some((m) => m.pista === 'partnership' && m.targetCategory === cat),
      `partnership twin per ${cat} atteso`,
    );
  }
});

// ===========================================================================
// CB TOTALS — calcoloCBPerPdv ignora il caring (conteggio, premio, punti).
// ===========================================================================
test('calcoloCBPerPdv: caring items add zero to count, premio and punti', () => {
  const cluster = 'Cluster 2';
  // Dataset misto: 2 rivincoli + 1 untied + 3 caring in un PDV.
  const cbItems = aggregateItems([
    sale([ART_RIVINCOLO]),
    sale([ART_MIA_TIED]),
    sale([ART_MIA_UNTIED]),
    sale([ART_CARING_TIED]),
    sale([ART_CARING_TIED]),
    sale([ART_CARING_UNTIED]),
  ])
    .filter((i) => i.pista === 'cb')
    .map((i) => ({ targetCategory: i.targetCategory, count: i.pezzi }));

  const caringCount = cbItems
    .filter((i) => i.targetCategory === COUPON_CARING_CATEGORY)
    .reduce((s, i) => s + i.count, 0);
  assert.equal(caringCount, 3, 'il dataset contiene 3 caring');

  const withoutCaring = cbItems.filter((i) => i.targetCategory !== COUPON_CARING_CATEGORY);

  const resWith = calcoloCBPerPdv(cbItems, cluster);
  const resWithout = calcoloCBPerPdv(withoutCaring, cluster);

  assert.deepEqual(resWith, resWithout, 'il caring non deve cambiare NESSUN totale CB');
  // puntiTotali = pezzi conteggiati = solo i 3 veri eventi CB (2 rivincoli + 1 untied).
  assert.equal(resWith.puntiTotali, 3, 'i 3 caring non gonfiano il conteggio pezzi');
  assert.ok(resWith.premioStimato > 0, 'i veri eventi CB producono comunque premio');
});

test('calcoloCBPerPdv: a caring-only PDV yields zero premio and zero punti', () => {
  const items = aggregateItems([
    sale([ART_CARING_TIED]),
    sale([ART_CARING_UNTIED]),
  ])
    .filter((i) => i.pista === 'cb')
    .map((i) => ({ targetCategory: i.targetCategory, count: i.pezzi }));

  const res = calcoloCBPerPdv(items, 'Cluster 3');
  assert.equal(res.premioStimato, 0, 'PDV con solo caring => nessun premio CB');
  assert.equal(res.puntiTotali, 0, 'PDV con solo caring => nessun pezzo CB');
});

// ===========================================================================
// CARD "CARING UTILIZZATE" — pezzi corretti per PDV e per Ragione Sociale.
// ===========================================================================
test('caring card: correct pezzi per PDV and per Ragione Sociale', () => {
  // Costruisce un mappedData.pdvList realistico: 4 PDV su 2 RS.
  const pdvList = [
    {
      codicePos: 'POS-A',
      nomeNegozio: 'Negozio A',
      ragioneSociale: 'Alpha Srl',
      // 3 caring + 2 rivincoli + 1 untied
      items: aggregateItems([
        sale([ART_CARING_TIED]), sale([ART_CARING_TIED]), sale([ART_CARING_UNTIED]),
        sale([ART_RIVINCOLO]), sale([ART_MIA_TIED]), sale([ART_MIA_UNTIED]),
      ]),
    },
    {
      codicePos: 'POS-B',
      nomeNegozio: 'Negozio B',
      ragioneSociale: 'Alpha Srl',
      // 2 caring + 1 rivincolo
      items: aggregateItems([
        sale([ART_CARING_UNTIED]), sale([ART_CARING_TIED]),
        sale([ART_RIVINCOLO]),
      ]),
    },
    {
      codicePos: 'POS-C',
      nomeNegozio: 'Negozio C',
      ragioneSociale: 'Beta Snc',
      // 5 caring + 3 untied
      items: aggregateItems([
        sale([ART_CARING_TIED]), sale([ART_CARING_TIED]), sale([ART_CARING_TIED]),
        sale([ART_CARING_UNTIED]), sale([ART_CARING_UNTIED]),
        sale([ART_MIA_UNTIED]), sale([ART_MIA_UNTIED]), sale([ART_MIA_UNTIED]),
      ]),
    },
    {
      codicePos: 'POS-D',
      nomeNegozio: 'Negozio D',
      ragioneSociale: 'Beta Snc',
      // Nessun caring, solo rivincoli => deve essere escluso dalla card.
      items: aggregateItems([sale([ART_RIVINCOLO]), sale([ART_MIA_TIED])]),
    },
  ];

  // Replica esatta della useMemo `caringStats` (DashboardGaraReale.tsx).
  const perPdv = [];
  const rsMap = new Map();
  let totale = 0;
  for (const pdv of pdvList) {
    const pezzi = pdv.items
      .filter((i) => isCaringItem(i.pista, i.targetCategory))
      .reduce((s, i) => s + i.pezzi, 0);
    if (pezzi <= 0) continue;
    perPdv.push({ codicePos: pdv.codicePos, ragioneSociale: pdv.ragioneSociale, pezzi });
    const existing = rsMap.get(pdv.ragioneSociale);
    if (existing) existing.pezzi += pezzi;
    else rsMap.set(pdv.ragioneSociale, { ragioneSociale: pdv.ragioneSociale, pezzi });
    totale += pezzi;
  }
  perPdv.sort((a, b) => b.pezzi - a.pezzi);
  const perRs = Array.from(rsMap.values()).sort((a, b) => b.pezzi - a.pezzi);

  // Totale caring = 3 + 2 + 5 = 10.
  assert.equal(totale, 10, 'totale caring atteso 10');

  // Per PDV (ordinati per pezzi desc); POS-D escluso perché senza caring.
  assert.equal(perPdv.length, 3, 'solo i 3 PDV con caring compaiono');
  assert.ok(!perPdv.some((p) => p.codicePos === 'POS-D'), 'POS-D (senza caring) escluso');
  const pdvMap = Object.fromEntries(perPdv.map((p) => [p.codicePos, p.pezzi]));
  assert.equal(pdvMap['POS-A'], 3);
  assert.equal(pdvMap['POS-B'], 2);
  assert.equal(pdvMap['POS-C'], 5);

  // Per RS: Alpha = 3 + 2 = 5, Beta = 5.
  const rsPezzi = Object.fromEntries(perRs.map((r) => [r.ragioneSociale, r.pezzi]));
  assert.equal(rsPezzi['Alpha Srl'], 5);
  assert.equal(rsPezzi['Beta Snc'], 5);
  assert.equal(perRs.reduce((s, r) => s + r.pezzi, 0), totale, 'somma per-RS == totale');
});

// ===========================================================================
// MIGRAZIONE — regole salvate VECCHIE (caring sotto cambio_offerta_*) migrano
// verso coupon_caring senza duplicati né gemelli partnership.
// ===========================================================================
function oldSavedRules() {
  // Simula un'org che aveva salvato il caring sotto le categorie CB "normali"
  // prima di Task #289, più una vera regola rivincoli (che NON va toccata).
  return [
    { id: 's1', pista: 'cb', targetCategory: 'cambio_offerta_rivincoli', targetLabel: 'Cambio Offerta Rivincoli', conditions: { categoriaBiSuite: 'MIA TIED', tipologiaBiSuite: 'COUPON CARING TIED' }, priority: 10, enabled: true, ruleType: 'base' },
    { id: 's2', pista: 'cb', targetCategory: 'cambio_offerta_untied', targetLabel: 'Cambio Offerta Untied', conditions: { categoriaBiSuite: 'MIA UNTIED', tipologiaBiSuite: 'COUPON CARING UNTIED' }, priority: 10, enabled: true, ruleType: 'base' },
    { id: 's3', pista: 'cb', targetCategory: 'cambio_offerta_rivincoli', targetLabel: 'Cambio Offerta Rivincoli', conditions: { categoriaBiSuite: 'RIVINCOLO', tipologiaBiSuite: 'RIVINCOLO VOCE' }, priority: 10, enabled: true, ruleType: 'base' },
  ];
}

test('retargetCaringSavedRules: migrates old caring rules to coupon_caring', () => {
  const { rules, changed } = retargetCaringSavedRules(oldSavedRules());
  assert.equal(changed, true, 'deve segnalare la migrazione');

  const caringTied = rules.find((r) => r.conditions.tipologiaBiSuite === 'COUPON CARING TIED');
  const caringUntied = rules.find((r) => r.conditions.tipologiaBiSuite === 'COUPON CARING UNTIED');
  assert.equal(caringTied.targetCategory, COUPON_CARING_CATEGORY);
  assert.equal(caringTied.targetLabel, COUPON_CARING_LABEL);
  assert.equal(caringUntied.targetCategory, COUPON_CARING_CATEGORY);

  // La vera regola rivincoli NON deve cambiare.
  const rivincolo = rules.find((r) => r.conditions.tipologiaBiSuite === 'RIVINCOLO VOCE');
  assert.equal(rivincolo.targetCategory, 'cambio_offerta_rivincoli');

  // Idempotenza: rieseguire non cambia più nulla.
  const second = retargetCaringSavedRules(rules);
  assert.equal(second.changed, false, 'seconda esecuzione idempotente');
});

test('mergeWithDefaultRules: migrated org has no coupon_caring partnership twin and no duplicates', () => {
  const merged = mergeWithDefaultRules(oldSavedRules());

  // (c) Nessun gemello partnership per coupon_caring.
  assert.ok(
    !merged.some((r) => r.pista === 'partnership' && r.targetCategory === COUPON_CARING_CATEGORY),
    'coupon_caring non deve avere gemello partnership',
  );

  // Nessun duplicato: ciascuna tipologia caring compare in UNA sola regola CB
  // (quella migrata dal salvato coincide con la default => niente re-inject).
  for (const tip of ['COUPON CARING TIED', 'COUPON CARING UNTIED']) {
    const dupes = merged.filter(
      (r) => r.pista === 'cb' && (r.conditions.tipologiaBiSuite || '').toUpperCase() === tip,
    );
    assert.equal(dupes.length, 1, `una sola regola CB per ${tip}, trovate ${dupes.length}`);
    assert.equal(dupes[0].targetCategory, COUPON_CARING_CATEGORY);
  }

  // Ogni regola CB caring risultante è mappata su coupon_caring (nessuna
  // residua sotto cambio_offerta_*).
  const strayCaring = merged.filter(
    (r) =>
      r.pista === 'cb' &&
      r.targetCategory !== COUPON_CARING_CATEGORY &&
      COUPON_CARING_TIPOLOGIE_UPPER.includes((r.conditions.tipologiaBiSuite || '').toUpperCase()),
  );
  assert.equal(strayCaring.length, 0, 'nessuna regola caring residua sotto categorie CB normali');

  // Sanity: il vero rivincoli mantiene il suo gemello partnership.
  assert.ok(
    merged.some((r) => r.pista === 'partnership' && r.targetCategory === 'cambio_offerta_rivincoli'),
    'il vero rivincoli deve conservare il gemello partnership',
  );
});
