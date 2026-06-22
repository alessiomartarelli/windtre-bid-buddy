import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// Test suite per il conteggio live di Accessori/Servizi BiSuite nelle gare
// addetto (Task #174).
//
// Funzione sotto test: `aggregateAccessoriServizi` in server/storage.ts. Legge
// le vendite BiSuite (`bisuite_sales.raw_data->'articoli'`) e somma gli importi
// (`dettaglio.prezzo`) per addetto, raggruppando per categoria Accessori
// (catAcc) e Servizi (catServ). Regole critiche verificate qui:
//   - somma per addetto, una riga per addetto (GROUP BY lower(trim(nome_addetto)));
//   - separazione catAcc vs catServ in base a `articolo.categoria.id`;
//   - esclusione delle vendite con stato ANNULLATA;
//   - filtro per intervallo di date (data_vendita tra from e to);
//   - addetto con sole vendite di categorie non mappate => acc/serv = 0;
//   - più addetti distinti, grouping case-insensitive.
//
// È un test DB-backed ma NON passa dall'HTTP: chiama direttamente la funzione di
// storage via loader `tsx`, usando lo stesso pool `pg` del server per il setup.
// Richiede solo DATABASE_URL (non il dev server).

const { storage } = await import('../server/storage.ts');
const { pool } = await import('../server/db.ts');

// Categorie di test: due id per gli Accessori, due per i Servizi. Gli id usati
// negli articoli ma NON in queste liste devono finire fuori dalle somme.
const CAT_ACC = [100, 101];
const CAT_SERV = [200, 201];
const CAT_OTHER = 555; // categoria non mappata né acc né serv

const FROM = '2026-07-01';
const TO = '2026-07-31';
const IN_RANGE = '2026-07-15T10:00:00.000Z';
const OUT_OF_RANGE = '2026-06-30T10:00:00.000Z';

function uniq(prefix) {
  return `${prefix}_${crypto.randomBytes(4).toString('hex')}`;
}

after(async () => {
  await pool.end().catch(() => {});
});

async function createOrg() {
  const name = uniq('AccServ');
  const r = await pool.query(
    `INSERT INTO organizations (name) VALUES ($1) RETURNING id`,
    [name],
  );
  return r.rows[0].id;
}

// Inserisce una vendita BiSuite. `articoli` è un array di { catId, prezzo }.
async function insertSale(orgId, { addetto, stato = 'ATTIVO', dataVendita = IN_RANGE, articoli }) {
  const bisuiteId = Math.floor(Math.random() * 2_000_000_000);
  const raw = {
    addetto: { nominativo: addetto },
    articoli: articoli.map(({ catId, prezzo }) => ({
      categoria: { id: catId },
      dettaglio: { prezzo: String(prezzo) },
    })),
  };
  await pool.query(
    `INSERT INTO bisuite_sales
       (organization_id, bisuite_id, data_vendita, nome_addetto, stato, raw_data)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [orgId, bisuiteId, dataVendita, addetto, stato, JSON.stringify(raw)],
  );
}

async function cleanupOrg(orgId) {
  await pool.query(`DELETE FROM bisuite_sales WHERE organization_id = $1`, [orgId]).catch(() => {});
  await pool.query(`DELETE FROM organizations WHERE id = $1`, [orgId]).catch(() => {});
}

function byName(rows) {
  const m = new Map();
  for (const r of rows) m.set(r.name.toLowerCase().trim(), r);
  return m;
}

// ===========================================================================
// SCENARIO 1: somma per addetto separata catAcc vs catServ, su più vendite.
// ===========================================================================
test('scenario 1: sums per addetto split between catAcc and catServ', async () => {
  const orgId = await createOrg();
  try {
    // MARIO ROSSI: due vendite ATTIVO.
    //   vendita A: acc 50 (cat 100) + serv 30 (cat 200)
    //   vendita B: acc 20 (cat 101)
    // Totale atteso MARIO: acc 70, serv 30.
    await insertSale(orgId, {
      addetto: 'MARIO ROSSI',
      articoli: [
        { catId: 100, prezzo: 50 },
        { catId: 200, prezzo: 30 },
      ],
    });
    await insertSale(orgId, {
      addetto: 'MARIO ROSSI',
      articoli: [{ catId: 101, prezzo: 20 }],
    });

    const rows = await storage.aggregateAccessoriServizi(orgId, FROM, TO, CAT_ACC, CAT_SERV);
    const map = byName(rows);
    const mario = map.get('mario rossi');
    assert.ok(mario, 'MARIO ROSSI must appear in the aggregation');
    assert.equal(mario.acc, 70, 'acc must sum catAcc articles (50 + 20)');
    assert.equal(mario.serv, 30, 'serv must sum catServ articles (30)');
    // Una sola riga per addetto.
    assert.equal(rows.filter((r) => r.name.toLowerCase().trim() === 'mario rossi').length, 1);
  } finally {
    await cleanupOrg(orgId);
  }
});

// ===========================================================================
// SCENARIO 2: le vendite ANNULLATA vengono escluse dalle somme.
// ===========================================================================
test('scenario 2: ANNULLATA sales are excluded', async () => {
  const orgId = await createOrg();
  try {
    await insertSale(orgId, {
      addetto: 'ANNA BIANCHI',
      articoli: [{ catId: 100, prezzo: 40 }],
    });
    // Stessa addetto, vendita ANNULLATA con importo enorme: NON deve contare.
    await insertSale(orgId, {
      addetto: 'ANNA BIANCHI',
      stato: 'ANNULLATA',
      articoli: [
        { catId: 100, prezzo: 9999 },
        { catId: 200, prezzo: 9999 },
      ],
    });

    const rows = await storage.aggregateAccessoriServizi(orgId, FROM, TO, CAT_ACC, CAT_SERV);
    const anna = byName(rows).get('anna bianchi');
    assert.ok(anna, 'ANNA BIANCHI must appear (has a valid ATTIVO sale)');
    assert.equal(anna.acc, 40, 'ANNULLATA acc amount must be excluded');
    assert.equal(anna.serv, 0, 'ANNULLATA serv amount must be excluded');
  } finally {
    await cleanupOrg(orgId);
  }
});

// ===========================================================================
// SCENARIO 3: addetto con sole categorie non mappate => acc/serv = 0; e le
// vendite fuori intervallo di date sono escluse.
// ===========================================================================
test('scenario 3: unmapped categories give 0 and out-of-range dates excluded', async () => {
  const orgId = await createOrg();
  try {
    // Addetto con sola categoria non mappata (555): compare con 0/0.
    await insertSale(orgId, {
      addetto: 'GIULIA NERI',
      articoli: [{ catId: CAT_OTHER, prezzo: 99 }],
    });
    // Addetto con una vendita valida ma fuori intervallo (giugno): esclusa,
    // quindi NON deve comparire affatto.
    await insertSale(orgId, {
      addetto: 'FUORI RANGE',
      dataVendita: OUT_OF_RANGE,
      articoli: [{ catId: 100, prezzo: 500 }],
    });

    const rows = await storage.aggregateAccessoriServizi(orgId, FROM, TO, CAT_ACC, CAT_SERV);
    const map = byName(rows);

    const giulia = map.get('giulia neri');
    assert.ok(giulia, 'GIULIA NERI must appear even with only unmapped categories');
    assert.equal(giulia.acc, 0, 'unmapped category must not count as acc');
    assert.equal(giulia.serv, 0, 'unmapped category must not count as serv');

    assert.equal(map.has('fuori range'), false, 'out-of-range sale must be excluded entirely');
  } finally {
    await cleanupOrg(orgId);
  }
});

// ===========================================================================
// SCENARIO 4: più addetti distinti, grouping case-insensitive sul nominativo.
// ===========================================================================
test('scenario 4: multiple distinct addetti, case-insensitive grouping', async () => {
  const orgId = await createOrg();
  try {
    // PAOLO con due grafie diverse (case) => una sola riga, somma unita.
    await insertSale(orgId, {
      addetto: 'paolo gialli',
      articoli: [{ catId: 100, prezzo: 10 }],
    });
    await insertSale(orgId, {
      addetto: 'PAOLO GIALLI',
      articoli: [{ catId: 101, prezzo: 5 }],
    });
    // Un secondo addetto distinto.
    await insertSale(orgId, {
      addetto: 'SARA VIOLA',
      articoli: [{ catId: 200, prezzo: 25 }],
    });

    const rows = await storage.aggregateAccessoriServizi(orgId, FROM, TO, CAT_ACC, CAT_SERV);
    const map = byName(rows);

    // Due addetti distinti (PAOLO unito, SARA).
    assert.equal(map.size, 2, `expected 2 distinct addetti, got ${rows.map((r) => r.name).join(', ')}`);

    const paolo = map.get('paolo gialli');
    assert.ok(paolo, 'PAOLO GIALLI (case-insensitive) must be a single grouped row');
    assert.equal(paolo.acc, 15, 'PAOLO acc must merge both case variants (10 + 5)');
    assert.equal(paolo.serv, 0);

    const sara = map.get('sara viola');
    assert.ok(sara, 'SARA VIOLA must appear');
    assert.equal(sara.acc, 0);
    assert.equal(sara.serv, 25);
  } finally {
    await cleanupOrg(orgId);
  }
});
