# Fase 2 — Architettura Tecnica su Replit

## Struttura del progetto

```
/
├── app.py                    # Entry point Flask/FastAPI
├── data/
│   └── excel/                # File Excel mensili caricati (da lug 2026)
├── src/
│   ├── data_loader.py        # Caricamento e normalizzazione Excel (logica da genera_*.py)
│   ├── business_logic.py     # T0, pdvp, PDV mapping, storni, journey
│   ├── db.py                 # Connessione e query al database interno
│   └── auth.py               # Autenticazione (admin / addetto)
├── templates/
│   ├── base.html             # Layout comune
│   ├── portafoglio_negozio.html
│   ├── tracciamento_cliente.html
│   └── portafoglio_addetto.html   # NUOVA — fase 2
├── static/
│   └── style.css
├── requirements.txt
└── REPLIT_PROMPT.md
```

---

## Modulo `data_loader.py`

Estrae la logica di caricamento da `genera_portafoglio.py` e `genera_timeline.py`.

```python
import os, glob, pandas as pd
from business_logic import NEGOZI_PDV, COLS_NEEDED

def load_all_excel(cartella="data/excel"):
    files = sorted(glob.glob(f"{cartella}/*_unificato*.xlsx"))
    files = [f for f in files if not os.path.basename(f).startswith("~$")]
    frames = []
    for path in files:
        xf    = pd.ExcelFile(path)
        sheet = xf.sheet_names[0]
        hdr   = pd.read_excel(path, sheet_name=sheet, nrows=0)
        cols  = [c for c in COLS_NEEDED if c in hdr.columns]
        df    = pd.read_excel(path, sheet_name=sheet, usecols=cols, dtype=str)
        frames.append(df)
    if not frames:
        return pd.DataFrame(columns=COLS_NEEDED)
    df = pd.concat(frames, ignore_index=True)
    return normalize(df)

def normalize(df):
    for c in ["DATA_EVENTO","DT_ATTIVAZIONE","DATA_FIRMA"]:
        if c in df.columns:
            df[c] = pd.to_datetime(df[c], errors="coerce")
    df["IMPORTO"]  = pd.to_numeric(df.get("IMPORTO"), errors="coerce")
    df["PERIOD"]   = df["PERIOD"].astype(str).str.strip()
    df["PDV"]      = df.get("CODICE_NEGOZIO_COSY","").apply(
        lambda c: "N/D" if pd.isna(c) else NEGOZI_PDV.get(str(c).strip(), f"PDV {c}")
    )
    is_mob    = df.get("TIPO_FONIA","") == "MOBILE"
    attiv_ym  = pd.to_datetime(df.get("DT_ATTIVAZIONE"), errors="coerce").dt.strftime("%Y%m").fillna("")
    df["IS_T0"]     = is_mob & (attiv_ym == df["PERIOD"].fillna(""))
    df["IS_STORNO"] = df.get("ITEM_CATEGORY","").str.contains("Addebito Negativo", case=False, na=False)
    fc = df.get("FISCAL_CODE","").astype(str).str.strip()
    df = df[fc.notna() & (fc != "") & (fc.str.lower() != "nan")].copy()
    df["FISCAL_CODE"] = df["FISCAL_CODE"].astype(str).str.strip()
    return df
```

---

## Modulo `db.py`

Connessione al database interno Replit per recuperare gli abbinamenti addetto→vendita.

```python
import os
from sqlalchemy import create_engine, text
import pandas as pd

# La stringa di connessione viene da variabile d'ambiente Replit
DATABASE_URL = os.environ.get("DATABASE_URL")
engine = create_engine(DATABASE_URL)

def get_addetti():
    """Restituisce la lista degli addetti con le loro credenziali."""
    with engine.connect() as conn:
        return pd.read_sql("SELECT * FROM addetti", conn)

def get_vendite_addetto(codice_addetto):
    """
    Restituisce le vendite abbinate a un addetto specifico.
    Le chiavi di join candidate: CODICE_CONTRATTO, COD_CLIENTE, CODICE_POS_ORIGINARIO
    Da verificare quale copre meglio il match con i file Wind3.
    """
    query = text("""
        SELECT codice_contratto, cod_cliente, codice_pos, fiscal_code
        FROM vendite
        WHERE codice_addetto = :addetto
    """)
    with engine.connect() as conn:
        return pd.read_sql(query, conn, params={"addetto": codice_addetto})

def join_wind3_db(df_wind3, df_db):
    """
    Abbina i dati Wind3 con il database interno.
    Strategia: prova prima CODICE_CONTRATTO, poi COD_CLIENTE, poi CODICE_POS_ORIGINARIO.
    I non-abbinati vengono marcati ma non eliminati.
    """
    # Join principale su CODICE_CONTRATTO
    merged = df_wind3.merge(
        df_db[["codice_contratto","codice_addetto"]],
        left_on="CODICE_CONTRATTO",
        right_on="codice_contratto",
        how="left"
    )
    # Fallback su COD_CLIENTE per le righe non abbinate
    mask = merged["codice_addetto"].isna()
    if mask.any() and "cod_cliente" in df_db.columns:
        fallback = df_wind3[mask].merge(
            df_db[["cod_cliente","codice_addetto"]],
            left_on="COD_CLIENTE", right_on="cod_cliente", how="left"
        )
        merged.loc[mask, "codice_addetto"] = fallback["codice_addetto"].values

    merged["ABBINATO"] = merged["codice_addetto"].notna()
    return merged
```

---

## Modulo `auth.py`

```python
from flask_login import UserMixin

class User(UserMixin):
    def __init__(self, id, nome, ruolo, codice_addetto=None):
        self.id              = id
        self.nome            = nome
        self.ruolo           = ruolo          # "admin" o "addetto"
        self.codice_addetto  = codice_addetto # None per admin

    @property
    def is_admin(self):
        return self.ruolo == "admin"
```

---

## Endpoints Flask (`app.py`)

```python
from flask import Flask, render_template, redirect, url_for
from flask_login import login_required, current_user

app = Flask(__name__)

@app.route("/")
@login_required
def index():
    if current_user.is_admin:
        return redirect(url_for("portafoglio_negozio"))
    else:
        return redirect(url_for("portafoglio_addetto"))

@app.route("/portafoglio-negozio")
@login_required
def portafoglio_negozio():
    # Solo admin
    if not current_user.is_admin:
        return redirect(url_for("portafoglio_addetto"))
    data = build_portafoglio_data()
    return render_template("portafoglio_negozio.html", data=data)

@app.route("/tracciamento-cliente")
@login_required
def tracciamento_cliente():
    # Solo admin
    if not current_user.is_admin:
        return redirect(url_for("portafoglio_addetto"))
    data = build_timeline_data()
    return render_template("tracciamento_cliente.html", data=data)

@app.route("/portafoglio-addetto")
@login_required
def portafoglio_addetto():
    # Admin vede tutto, addetto vede solo i propri clienti
    codice = None if current_user.is_admin else current_user.codice_addetto
    data = build_portafoglio_addetto_data(codice)
    return render_template("portafoglio_addetto.html", data=data)

@app.route("/upload", methods=["GET","POST"])
@login_required
def upload_excel():
    # Solo admin — upload di nuovi file Excel mensili
    if not current_user.is_admin:
        return redirect(url_for("index"))
    # gestione upload file
    ...
```

---

## Vista Portafoglio Addetto (da progettare)

### Pannello sinistro
- Lista clienti dell'addetto, ordinati per numero di contratti
- Badge prodotto per ogni cliente (M/F/E/A) — contratti unici per tipo
- Indicatore visivo dei **gap**: prodotti mancanti rispetto al bundle completo

### Pannello destro — cliente selezionato
- Timeline identica a quella del tracciamento_cliente.html
- Sezione "Opportunità cross-selling":
  - Se ha solo MOBILE → suggerisce FISSO, ENERGIA, ASSICURAZIONI
  - Se ha MOBILE+FISSO → suggerisce ENERGIA, ASSICURAZIONI
  - ecc.
- Footer: contratti attivi, importo totale, mese T0, percorso prodotti

### Logica gap prodotti
```javascript
const BUNDLE_COMPLETO = ["MOBILE","FISSO","ENERGIA","ASSICURAZIONI"];
function calcolaGap(prodotti) {
  // prodotti = oggetto {MOBILE: 2, FISSO: 1, ...}
  return BUNDLE_COMPLETO.filter(p => !prodotti[p]);
}
```

---

## Gestione upload Excel su Replit

```python
import os
from werkzeug.utils import secure_filename

UPLOAD_FOLDER = "data/excel"
ALLOWED_EXTENSIONS = {"xlsx"}

def allowed_file(filename):
    return "." in filename and filename.rsplit(".",1)[1].lower() in ALLOWED_EXTENSIONS

@app.route("/upload", methods=["POST"])
@login_required
def upload():
    if not current_user.is_admin:
        return {"error": "Non autorizzato"}, 403
    file = request.files.get("file")
    if file and allowed_file(file.filename):
        filename = secure_filename(file.filename)
        file.save(os.path.join(UPLOAD_FOLDER, filename))
        # Invalida la cache dei dati
        cache.clear()
        return {"ok": True, "filename": filename}
    return {"error": "File non valido"}, 400
```

---

## Caching dei dati (importante per performance)

Il caricamento degli Excel è lento (~30 secondi per 10 file). Va messo in cache.

```python
from flask_caching import Cache

cache = Cache(app, config={"CACHE_TYPE": "SimpleCache", "CACHE_DEFAULT_TIMEOUT": 3600})

@cache.cached(timeout=3600, key_prefix="all_data")
def get_data():
    df = load_all_excel()
    return build_data(df)
```

---

## Variabili d'ambiente su Replit (Secrets)

```
DATABASE_URL=postgresql://...    # Stringa connessione DB
SECRET_KEY=...                   # Chiave Flask per sessioni
```

---

## Priorità di sviluppo fase 2

1. Configurare Flask + upload Excel funzionante
2. Verificare struttura database interno e chiavi di join
3. Implementare join Wind3 ↔ DB con gestione non-abbinati
4. Autenticazione base (admin/addetto)
5. Migrare portafoglio_negozio e tracciamento_cliente come pagine dinamiche
6. Costruire portafoglio_addetto con logica gap cross-selling
7. UI addetto (semplificata, orientata all'uso quotidiano)
