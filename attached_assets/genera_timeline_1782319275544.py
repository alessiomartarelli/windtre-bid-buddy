"""
genera_timeline.py
Genera tracciamento_cliente.html — timeline cross-mese clienti Wind3.
Esegui con: python genera_timeline.py

MIN_MESI = 1 → tutti i clienti con FISCAL_CODE valido
MIN_MESI = 2 → solo clienti presenti in almeno 2 mesi distinti (cross-mese)
"""

import os, glob, json, re
import pandas as pd

CARTELLA    = os.path.dirname(os.path.abspath(__file__))
OUTPUT_FILE = os.path.join(CARTELLA, "tracciamento_cliente.html")
MIN_MESI    = 1   # abbassa a 1 per tutti, alza a 2 per solo cross-mese

NEGOZI_PDV = {
    "9001046475":"FIUMICINO",    "9001060855":"PARCO LEONARDO",
    "9001288594":"PORTA DI ROMA","9001290392":"POMEZIA",
    "9001393090":"SAN CESAREO",  "9001401037":"JESI",
    "9001402980":"PRENESTINA",   "9001408227":"TIBURTINA",
    "9001408258":"CANDIA",       "9001409452":"MIRALFIORE",
    "9001409453":"BRANCA",       "9001412252":"CIVITAVECCHIA",
    "9001426892":"CINECITTA'",   "9001212651":"TUSCOLANA",
    # codici storici (stessi negozi, codice cambiato nel tempo)
    "9001197646":"CIVITAVECCHIA","9001197647":"TIBURTINA",
    "9001288712":"CANDIA",
}

PRODOTTO_COLORE = {
    "MOBILE":"#3B82F6","FISSO":"#10B981",
    "ENERGIA":"#F59E0B","ASSICURAZIONI":"#8B5CF6","ALTRO":"#6B7280",
}
PRODOTTO_ICON = {
    "MOBILE":"M","FISSO":"F","ENERGIA":"E","ASSICURAZIONI":"A","ALTRO":"?",
}
MESE_IT = {
    "gennaio":"Gen","febbraio":"Feb","marzo":"Mar","aprile":"Apr",
    "maggio":"Mag","giugno":"Giu","luglio":"Lug","agosto":"Ago",
    "settembre":"Set","ottobre":"Ott","novembre":"Nov","dicembre":"Dic",
}
MESE_LABEL_MAP = {
    "202507":"Lug 2025","202508":"Ago 2025","202509":"Set 2025","202510":"Ott 2025",
    "202511":"Nov 2025","202512":"Dic 2025",
    "202601":"Gen 2026","202602":"Feb 2026","202603":"Mar 2026","202604":"Apr 2026",
    "202605":"Mag 2026","202606":"Giu 2026","202607":"Lug 2026","202608":"Ago 2026",
}

COLS_NEEDED = [
    "PERIOD","FISCAL_CODE","CLIENTE","COD_CLIENTE",
    "CODICE_CONTRATTO","CODICE_POS_ORIGINARIO","CODICE_NEGOZIO_COSY",
    "TIPO_FONIA","DESCRIZIONE_EVENTO","DATA_EVENTO","DT_ATTIVAZIONE",
    "DATA_FIRMA","IMPORTO","ITEM_CATEGORY","TIPO_LINEA",
    "DESCRIZIONE_PIANO_TARIFFARIO","MNP","NATURA","TIPO_COMPENSO","TIPO_ATTIVAZIONE",
]


def file_to_label(basename):
    b = basename.lower()
    for it, short in MESE_IT.items():
        if it in b:
            y = re.search(r"(20\d\d)", b)
            return f"{short} {y.group(1) if y else ''}"
    return os.path.splitext(basename)[0]


# ---------------------------------------------------------------------------
# Caricamento
# ---------------------------------------------------------------------------
def load_data():
    pattern = os.path.join(CARTELLA, "*_unificato*.xlsx")
    files   = sorted(glob.glob(pattern))
    frames  = []
    for path in files:
        xf    = pd.ExcelFile(path)
        sheet = xf.sheet_names[0]
        hdr   = pd.read_excel(path, sheet_name=sheet, nrows=0)
        cols  = [c for c in COLS_NEEDED if c in hdr.columns]
        df    = pd.read_excel(path, sheet_name=sheet, usecols=cols, dtype=str)
        df["_src"] = file_to_label(os.path.basename(path))
        frames.append(df)
        print(f"  {os.path.basename(path)}: {len(df):,} righe")

    df = pd.concat(frames, ignore_index=True)

    for c in ["DATA_EVENTO","DT_ATTIVAZIONE","DATA_FIRMA"]:
        if c in df.columns:
            df[c] = pd.to_datetime(df[c], errors="coerce")

    df["IMPORTO"] = pd.to_numeric(
        df.get("IMPORTO", pd.Series(dtype=float)), errors="coerce"
    )
    df["PERIOD"] = df["PERIOD"].astype(str).str.strip()

    df["PDV"] = df.get("CODICE_NEGOZIO_COSY", pd.Series(dtype=str)).apply(
        lambda c: "N/D" if pd.isna(c) else NEGOZI_PDV.get(str(c).strip(), f"PDV {c}")
    )

    is_mob   = df.get("TIPO_FONIA", pd.Series(dtype=str)) == "MOBILE"
    attiv_ym = pd.to_datetime(df.get("DT_ATTIVAZIONE"), errors="coerce")\
                 .dt.strftime("%Y%m").fillna("")
    df["IS_T0"]    = is_mob & (attiv_ym == df["PERIOD"].fillna(""))
    df["IS_STORNO"] = df.get("ITEM_CATEGORY", pd.Series(dtype=str))\
                        .str.contains("Addebito Negativo", case=False, na=False)

    fc = df.get("FISCAL_CODE", pd.Series(dtype=str)).astype(str).str.strip()
    df = df[fc.notna() & (fc != "") & (fc != "nan") & (fc != "NaN") & (fc != "None")].copy()
    df["FISCAL_CODE"] = df["FISCAL_CODE"].astype(str).str.strip()
    return df


# ---------------------------------------------------------------------------
# Costruzione dati (vettorizzata — niente iterrows)
# ---------------------------------------------------------------------------
def build_data(df):
    from collections import defaultdict

    mesi_all = sorted(df["PERIOD"].dropna().unique().tolist())

    # ── Colonne data → stringhe ────────────────────────────────────────────
    for col in ["DATA_EVENTO", "DT_ATTIVAZIONE", "DATA_FIRMA"]:
        df[col + "_str"] = (df[col].dt.strftime("%Y-%m-%d")
                            if col in df.columns and pd.api.types.is_datetime64_any_dtype(df[col])
                            else "")
        df[col + "_str"] = df[col + "_str"].fillna("")

    df["IMPORTO_f"] = pd.to_numeric(
        df.get("IMPORTO", pd.Series(dtype=float)), errors="coerce"
    ).fillna(0.0).round(2)

    for col in ["DESCRIZIONE_EVENTO", "TIPO_LINEA", "DESCRIZIONE_PIANO_TARIFFARIO",
                "MNP", "CODICE_POS_ORIGINARIO", "TIPO_FONIA",
                "CODICE_CONTRATTO", "CLIENTE", "COD_CLIENTE",
                "NATURA", "TIPO_COMPENSO", "TIPO_ATTIVAZIONE"]:
        if col not in df.columns:
            df[col] = ""
        df[col] = df[col].fillna("").astype(str).str.strip()

    # ── Filtro MIN_MESI ────────────────────────────────────────────────────
    nm_series = df.groupby("FISCAL_CODE")["PERIOD"].nunique()
    fc_validi  = set(nm_series[nm_series >= MIN_MESI].index.tolist())
    df_f = df[df["FISCAL_CODE"].isin(fc_validi)].copy()
    print(f"  Clienti validi (>= {MIN_MESI} mesi): {len(fc_validi):,}")

    # ── Indice clienti (solo .first() e .size — tutto nativo pandas) ──────
    print("  Calcolo indice clienti…")

    # nome: prima occorrenza non vuota per FC
    nome_s = (df_f[df_f["CLIENTE"] != ""]
              .sort_values("CLIENTE")
              .groupby("FISCAL_CODE")["CLIENTE"].first())

    # cod_cliente: prima occorrenza non vuota
    cod_s  = (df_f[df_f["COD_CLIENTE"] != ""]
              .groupby("FISCAL_CODE")["COD_CLIENTE"].first())

    # pdv: prima occorrenza non vuota
    pdv_s  = (df_f[df_f["PDV"] != ""]
              .groupby("FISCAL_CODE")["PDV"].first())

    # n_mesi
    nm_s = df_f.groupby("FISCAL_CODE")["PERIOD"].nunique()

    # n_contratti unici
    nc_s = df_f.groupby("FISCAL_CODE")["CODICE_CONTRATTO"].nunique()

    # T0: primo mese con IS_T0
    t0_s = (df_f[df_f["IS_T0"]]
            .groupby("FISCAL_CODE")["PERIOD"].min())

    # PDV principale: PDV del T0 se esiste, altrimenti primo evento cronologico
    t0_pdv_s    = (df_f[df_f["IS_T0"] & (df_f["PDV"] != "")]
                   .sort_values("DATA_EVENTO")
                   .groupby("FISCAL_CODE")["PDV"].first())
    first_pdv_s = (df_f[df_f["PDV"] != ""]
                   .sort_values("DATA_EVENTO")
                   .groupby("FISCAL_CODE")["PDV"].first())
    pdvp_s = t0_pdv_s.combine_first(first_pdv_s)

    # mesi presenti: raggruppa i valori unici
    mesi_s = (df_f.groupby("FISCAL_CODE")["PERIOD"]
                  .unique()
                  .apply(lambda a: sorted(a.tolist())))

    # prodotti: contratti unici per FISCAL_CODE × TIPO_FONIA
    prod_pivot = (df_f[df_f["TIPO_FONIA"] != ""]
                  .groupby(["FISCAL_CODE", "TIPO_FONIA"])["CODICE_CONTRATTO"]
                  .nunique()
                  .unstack(fill_value=0))

    idx_df = pd.DataFrame({
        "nome": nome_s,
        "cod":  cod_s,
        "pdv":  pdv_s,
        "nm":   nm_s,
        "nc":   nc_s,
        "t0":   t0_s,
        "mesi": mesi_s,
        "pdvp": pdvp_s,
    }).fillna({"nome":"N/D","cod":"","pdv":"N/D","t0":"","nc":0,"pdvp":"N/D"})

    clienti_idx = []
    for fc, row in idx_df.iterrows():
        prodotti = {}
        if fc in prod_pivot.index:
            for col in prod_pivot.columns:
                v = int(prod_pivot.at[fc, col])
                if v > 0:
                    prodotti[col] = v
        clienti_idx.append({
            "fc":   fc,
            "nome": str(row["nome"]),
            "cod":  str(row["cod"]),
            "pdv":  str(row["pdv"]),
            "nm":   int(row["nm"]),
            "nc":   int(row["nc"]),
            "t0":   str(row["t0"]),
            "mesi": list(row["mesi"]) if hasattr(row["mesi"], "__iter__") else [],
            "p":    prodotti,
            "pdvp": str(row["pdvp"]),
        })

    clienti_idx.sort(key=lambda x: (-x["nc"], x["nome"].upper()))
    print(f"  Indice clienti: {len(clienti_idx):,}")

    # ── Dettaglio eventi per (FISCAL_CODE, CODICE_CONTRATTO) ─────────────
    print("  Costruzione eventi…")

    # meta per contratto: tipo e pdv dominante (primo non vuoto)
    cc_tipo = (df_f[df_f["TIPO_FONIA"] != ""]
               .groupby(["FISCAL_CODE","CODICE_CONTRATTO"])["TIPO_FONIA"].first()
               .fillna("ALTRO"))
    cc_pdv  = (df_f[df_f["PDV"] != ""]
               .sort_values("DATA_EVENTO")
               .groupby(["FISCAL_CODE","CODICE_CONTRATTO"])["PDV"].first()
               .fillna("N/D"))
    cc_pos  = (df_f[df_f["CODICE_POS_ORIGINARIO"] != ""]
               .groupby(["FISCAL_CODE","CODICE_CONTRATTO"])["CODICE_POS_ORIGINARIO"].first()
               .fillna(""))

    # tutti gli eventi come lista di record (to_dict è veloce)
    ev_cols = ["FISCAL_CODE","CODICE_CONTRATTO","PERIOD",
               "DATA_EVENTO_str","DT_ATTIVAZIONE_str","DATA_FIRMA_str",
               "DESCRIZIONE_EVENTO","IMPORTO_f","IS_T0","IS_STORNO",
               "TIPO_LINEA","DESCRIZIONE_PIANO_TARIFFARIO","MNP","NATURA",
               "TIPO_COMPENSO","TIPO_ATTIVAZIONE"]
    ev_cols = [c for c in ev_cols if c in df_f.columns]
    records = df_f[ev_cols].to_dict("records")

    ev_by_key = defaultdict(list)
    for r in records:
        ev_by_key[(r["FISCAL_CODE"], r["CODICE_CONTRATTO"])].append({
            "m":   r.get("PERIOD",""),
            "d":   r.get("DATA_EVENTO_str",""),
            "da":  r.get("DT_ATTIVAZIONE_str",""),
            "df":  r.get("DATA_FIRMA_str",""),
            "e":   r.get("DESCRIZIONE_EVENTO",""),
            "i":   float(r.get("IMPORTO_f",0)),
            "t0":  bool(r.get("IS_T0",False)),
            "st":  bool(r.get("IS_STORNO",False)),
            "tl":  r.get("TIPO_LINEA",""),
            "pt":  r.get("DESCRIZIONE_PIANO_TARIFFARIO",""),
            "mnp": r.get("MNP",""),
            "na":  r.get("NATURA",""),
            "tc":  r.get("TIPO_COMPENSO",""),
            "ta":  r.get("TIPO_ATTIVAZIONE",""),
        })

    # converti Series multi-indice in dict per lookup O(1)
    cc_tipo_d = cc_tipo.to_dict()
    cc_pdv_d  = cc_pdv.to_dict()
    cc_pos_d  = cc_pos.to_dict()

    # raggruppa eventi per FISCAL_CODE → {cc: [events]}
    ev_by_fc = defaultdict(dict)
    for (fc, cc), evs in ev_by_key.items():
        ev_by_fc[fc][cc] = evs

    # assembla det per cliente (tutto O(n_events) totale)
    clienti_det = {}
    for fc in fc_validi:
        contratti = {}
        for cc, evs in ev_by_fc.get(fc, {}).items():
            contratti[cc] = {
                "tipo": str(cc_tipo_d.get((fc, cc), "ALTRO")),
                "pdv":  str(cc_pdv_d.get((fc, cc),  "N/D")),
                "pos":  str(cc_pos_d.get((fc, cc),   "")),
                "ev":   evs,
            }
        clienti_det[fc] = contratti

    def _vals(col):
        if col not in df_f.columns: return []
        return sorted([v for v in df_f[col].dropna().unique().tolist() if v])

    print("  Dettagli pronti.")
    return {
        "clienti":      clienti_idx,
        "det":          clienti_det,
        "mesi":         mesi_all,
        "ml":           {m: MESE_LABEL_MAP.get(m, m) for m in mesi_all},
        "pc":           PRODOTTO_COLORE,
        "pi":           PRODOTTO_ICON,
        "naturas":      _vals("NATURA"),
        "compensi":     _vals("TIPO_COMPENSO"),
        "attivazioni":  _vals("TIPO_ATTIVAZIONE"),
    }


# ---------------------------------------------------------------------------
# HTML template (placeholder __DATA__ verrà sostituito col JSON)
# ---------------------------------------------------------------------------
HTML_TEMPLATE = r"""<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tracciamento Cliente — Wind3</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Helvetica Neue',sans-serif;
     background:#0a0f1e;color:#e2e8f0;height:100vh;display:flex;flex-direction:column;overflow:hidden}

/* TOP BAR */
#topbar{position:relative;z-index:300;background:#0d1526;
        border-bottom:1px solid #1e2d4a;padding:10px 20px;
        display:flex;align-items:center;gap:12px;flex-wrap:wrap;flex-shrink:0}
.logo{font-size:16px;font-weight:800;color:#fff;white-space:nowrap}
.logo span{color:#3b82f6}
.nav-link{color:#60a5fa;font-size:12px;text-decoration:none;padding:5px 12px;
          border:1px solid #1e3a5f;border-radius:7px;white-space:nowrap;transition:background .15s}
.nav-link:hover{background:#1e3a5f}
#stat-txt{font-size:11px;color:#475569;margin-left:auto;white-space:nowrap}

/* MAIN */
#main{display:flex;flex:1;overflow:hidden}

/* LEFT PANEL */
#left{width:310px;min-width:310px;background:#0d1526;
      border-right:1px solid #1e2d4a;display:flex;flex-direction:column;overflow:hidden}
#search-wrap{padding:12px 14px 8px;flex-shrink:0}
#search{width:100%;background:#111827;border:1px solid #1e2d4a;color:#e2e8f0;
        border-radius:8px;padding:8px 12px;font-size:13px;outline:none;transition:border-color .15s}
#search:focus{border-color:#3b82f6}
#search::placeholder{color:#475569}
#sel-bar{display:flex;align-items:center;justify-content:space-between;
         padding:0 14px 8px;flex-shrink:0;gap:8px}
#sel-info{font-size:11px;color:#64748b}
#sel-info em{color:#60a5fa;font-style:normal;font-weight:600}
.btn-sm{background:none;border:1px solid #1e2d4a;color:#64748b;font-size:10px;
        padding:3px 9px;border-radius:6px;cursor:pointer;transition:all .15s;white-space:nowrap}
.btn-sm:hover{border-color:#3b82f6;color:#93c5fd}
#legend{display:flex;gap:7px;flex-wrap:wrap;padding:0 14px 10px;flex-shrink:0}
.leg-item{display:flex;align-items:center;gap:4px;font-size:10px;color:#94a3b8}
.leg-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}
.leg-sq{width:10px;height:10px;border-radius:2px;flex-shrink:0}

/* CLIENT LIST */
#client-list{flex:1;overflow-y:auto;scrollbar-width:thin;scrollbar-color:#1e2d4a #0d1526}
#client-list::-webkit-scrollbar{width:4px}
#client-list::-webkit-scrollbar-track{background:#0d1526}
#client-list::-webkit-scrollbar-thumb{background:#1e2d4a;border-radius:2px}
.cl-item{padding:9px 14px;border-bottom:1px solid #0f1829;cursor:pointer;
         transition:background .1s;user-select:none;border-left:2px solid transparent}
.cl-item:hover{background:#111827}
.cl-item.sel{background:#0c1e38;border-left-color:#3b82f6}
.cl-name{font-size:12px;font-weight:600;color:#e2e8f0;
         white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:260px}
.cl-item.sel .cl-name{color:#93c5fd}
.cl-meta{display:flex;align-items:center;gap:6px;margin-top:3px;flex-wrap:wrap}
.cl-fc{font-size:10px;color:#475569;font-family:'Courier New',monospace}
.cl-mesi{font-size:10px;color:#64748b}
.cl-badges{display:flex;gap:3px;margin-top:5px;flex-wrap:wrap}
.cl-pdvp{display:inline-block;font-size:9px;font-weight:600;color:#fef3c7;background:#78350f;
         padding:1px 6px;border-radius:8px;margin-top:3px;white-space:nowrap}
.badge{font-size:9px;font-weight:700;padding:2px 6px;border-radius:9px;color:#fff;white-space:nowrap}
.no-results{padding:24px 14px;text-align:center;color:#475569;font-size:12px;line-height:1.6}

/* RIGHT PANEL */
#right{flex:1;overflow-y:auto;padding:16px 20px 40px;
       scrollbar-width:thin;scrollbar-color:#1e2d4a #0a0f1e}
#right::-webkit-scrollbar{width:6px}
#right::-webkit-scrollbar-track{background:#0a0f1e}
#right::-webkit-scrollbar-thumb{background:#1e2d4a;border-radius:3px}

/* EMPTY STATE */
#empty-state{display:flex;flex-direction:column;align-items:center;justify-content:center;
             height:100%;color:#475569;gap:14px;text-align:center;padding:40px}
#empty-state .icon{font-size:52px;opacity:.3}
#empty-state p{font-size:13px;max-width:320px;line-height:1.7}
#empty-state small{font-size:11px;color:#374151}

/* CLIENT SECTION */
.cl-section{background:#111827;border:1px solid #1e2d4a;border-radius:13px;
            margin-bottom:20px;overflow:hidden}
.cl-sec-head{background:#0d1526;padding:12px 16px;display:flex;align-items:flex-start;
             gap:12px;border-bottom:1px solid #1e2d4a}
.cl-sec-info{flex:1;min-width:0}
.cl-sec-title{font-size:14px;font-weight:700;color:#e2e8f0;
              white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cl-sec-sub{font-size:10px;color:#475569;font-family:'Courier New',monospace;margin-top:2px}
.cl-sec-pdv{font-size:10px;color:#64748b;margin-top:2px}
.cl-sec-badges{display:flex;gap:5px;margin-top:6px;flex-wrap:wrap}
.cl-sec-close{background:none;border:none;color:#475569;cursor:pointer;font-size:18px;
              padding:2px 6px;border-radius:4px;transition:color .15s;flex-shrink:0;line-height:1}
.cl-sec-close:hover{color:#ef4444}

/* TIMELINE TABLE */
.tl-wrap{overflow-x:auto}
.tl-table{border-collapse:collapse;width:100%}
.tl-hdr td{padding:7px 4px;text-align:center;font-size:10px;font-weight:700;
           color:#475569;text-transform:uppercase;letter-spacing:.6px;
           border-bottom:1px solid #1e2d4a;background:#0d1526}
.tl-hdr .lbl-cell{text-align:left;padding-left:14px}
.tl-row td{border-bottom:1px solid #0f1829;vertical-align:middle}
.tl-row:last-child td{border-bottom:none}

/* LABEL CELL */
.lbl-cell{width:210px;min-width:210px;padding:10px 10px 10px 14px}
.tl-tipo-badge{font-size:9px;font-weight:700;padding:2px 7px;border-radius:6px;
               color:#fff;display:inline-block;margin-bottom:3px}
.tl-cc{font-size:10px;color:#64748b;font-family:'Courier New',monospace;
       white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:180px}
.tl-pdv-small{font-size:9px;color:#374151;margin-top:2px}

/* MONTH CELL */
.m-cell{min-width:180px;width:180px;padding:8px 6px}
.tl-track{position:relative;height:32px;display:flex;align-items:center}
.tl-bar-bg{position:absolute;left:8px;right:8px;height:3px;border-radius:2px;background:#1e2d4a}
.tl-bar-fill{position:absolute;left:8px;right:8px;height:3px;border-radius:2px;opacity:.35}
.tl-events{display:flex;align-items:center;gap:5px;position:relative;z-index:1;
           padding:0 8px;flex-wrap:wrap;justify-content:center}
.m-empty{opacity:.06;border-left:1px dashed #334155;height:32px;width:100%}

/* EVENT DOT */
.ev-dot{width:16px;height:16px;border-radius:50%;cursor:pointer;flex-shrink:0;
        transition:transform .12s,box-shadow .12s;border:2px solid rgba(0,0,0,.3)}
.ev-dot:hover{transform:scale(1.5);z-index:20;box-shadow:0 2px 10px rgba(0,0,0,.6)}
.ev-dot.t0{border-radius:4px;border-color:rgba(251,191,36,.7)}
.ev-dot.t0::after{content:'T0';position:absolute;top:-14px;left:50%;
                  transform:translateX(-50%);font-size:7px;font-weight:700;
                  color:#fbbf24;white-space:nowrap;pointer-events:none}
.ev-dot{position:relative}
.ev-dot.storno{opacity:.4}

/* TOOLTIP */
#tooltip{position:fixed;z-index:9999;background:#1e293b;border:1px solid #334155;
         border-radius:10px;padding:11px 15px;font-size:11px;color:#e2e8f0;
         pointer-events:none;max-width:300px;line-height:1.8;
         box-shadow:0 8px 32px rgba(0,0,0,.6);display:none}
.tt-title{font-weight:700;font-size:12px;margin-bottom:5px;word-break:break-word}
.tt-r{color:#94a3b8}.tt-r strong{color:#e2e8f0}
.tt-t0{color:#fbbf24;font-size:10px;margin-top:5px}
.tt-storno{color:#ef4444;font-size:10px;margin-top:5px}

/* SUMMARY */
.cl-summary{display:flex;gap:16px;padding:10px 16px;border-top:1px solid #1e2d4a;
            flex-wrap:wrap;background:#0a1020}
.sum-item{font-size:11px;color:#64748b}
.sum-item strong{color:#93c5fd}

/* SUMMARY TIMELINE BAND */
.sv-section{padding:12px 16px 0}
.sv-label{font-size:10px;font-weight:700;color:#334155;text-transform:uppercase;
          letter-spacing:.6px;margin-bottom:6px}
.sv-track{position:relative;height:52px;background:#0b1220;
          border:1px solid #1e2d4a;border-radius:8px 8px 0 0;overflow:visible}
.sv-grid-line{position:absolute;top:0;bottom:0;width:1px;background:#1e2d4a;z-index:1}
.sv-grid-line:first-child{display:none}
.sv-dots-layer{position:absolute;inset:0;z-index:2}
.sv-dot{position:absolute;width:13px;height:13px;border-radius:50%;
        cursor:pointer;border:2px solid rgba(0,0,0,.35);
        transform:translate(-50%,-50%);
        transition:transform .12s,box-shadow .12s;z-index:5}
.sv-dot:hover{transform:translate(-50%,-50%) scale(1.7);z-index:20;
              box-shadow:0 2px 10px rgba(0,0,0,.7)}
.sv-dot.t0{border-radius:3px;border-color:rgba(251,191,36,.8)}
.sv-dot.storno{opacity:.35}
.sv-months{display:flex;height:22px;border:1px solid #1e2d4a;border-top:none;
           border-radius:0 0 8px 8px;overflow:hidden;background:#090e1a}
.sv-mseg{position:absolute;top:0;bottom:0;border-left:1px solid #1e2d4a;
         display:flex;align-items:center;padding-left:7px;overflow:hidden}
.sv-mseg:first-child{border-left:none}
.sv-mseg span{font-size:10px;color:#475569;font-weight:700;text-transform:uppercase;
              letter-spacing:.5px;white-space:nowrap}
.sv-months-rel{position:relative;width:100%;height:100%}

/* NATURA FILTER BAR */
#natura-bar{position:sticky;top:0;z-index:100;background:#0a0f1e;
            border-bottom:1px solid #1e2d4a;padding:9px 20px;
            display:flex;flex-direction:column;gap:7px;flex-shrink:0}
.nf-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.nf-label{font-size:11px;color:#475569;white-space:nowrap;min-width:70px}
.nf-pill{background:none;border:1px solid #1e2d4a;color:#64748b;font-size:11px;
         padding:4px 13px;border-radius:20px;cursor:pointer;transition:all .15s;white-space:nowrap}
.nf-pill:hover{border-color:#3b82f6;color:#93c5fd}
.nf-pill.active{background:#1e3a5f;border-color:#3b82f6;color:#93c5fd;font-weight:600}
</style>
</head>
<body>

<div id="topbar">
  <div class="logo">Wind3 <span>Tracciamento Cliente</span></div>
  <a href="portafoglio_negozio.html" class="nav-link">Portafoglio Negozio</a>
  <div id="stat-txt"></div>
</div>

<div id="main">
  <div id="left">
    <div id="search-wrap">
      <input id="search" type="text" placeholder="Cerca nome o codice fiscale..." autocomplete="off">
    </div>
    <div id="sel-bar">
      <div id="sel-info">Nessuna selezione</div>
      <button class="btn-sm" id="btn-clear">Deseleziona tutti</button>
    </div>
    <div id="legend">
      <div class="leg-item"><div class="leg-dot" style="background:#3B82F6"></div>Mobile</div>
      <div class="leg-item"><div class="leg-dot" style="background:#10B981"></div>Fisso</div>
      <div class="leg-item"><div class="leg-dot" style="background:#F59E0B"></div>Energia</div>
      <div class="leg-item"><div class="leg-dot" style="background:#8B5CF6"></div>Assicur.</div>
      <div class="leg-item"><div class="leg-sq" style="background:#3B82F6;opacity:.6"></div>T0</div>
      <div class="leg-item"><div class="leg-dot" style="background:#ef4444;opacity:.4"></div>Storno</div>
    </div>
    <div id="client-list"></div>
  </div>

  <div id="right">
    <div id="natura-bar"></div>
    <div id="empty-state">
      <div class="icon">&#128100;</div>
      <p>Seleziona uno o piu clienti dalla lista per visualizzare la <strong>timeline cross-mese</strong></p>
      <small>Cerca per nome o codice fiscale</small>
    </div>
    <div id="timelines" style="display:none"></div>
  </div>
</div>

<div id="tooltip"></div>

<script>
const DATA = __DATA__;
const MESI = DATA.mesi;
const ML   = DATA.ml;
const PC   = DATA.pc;
const PI   = DATA.pi;

let selected    = new Set();
let searchQ     = "";
let naturaFilter    = new Set();
let foniaFilter     = new Set();
let compensoFilter  = new Set();
let attivazioneFilter = new Set();
let dataFilter      = false;
let t0JulFilter     = false;

const TL_MSTART = {
  "202507":"2025-07-01","202508":"2025-08-01","202509":"2025-09-01",
  "202510":"2025-10-01","202511":"2025-11-01","202512":"2025-12-01",
  "202601":"2026-01-01","202602":"2026-02-01","202603":"2026-03-01",
  "202604":"2026-04-01","202605":"2026-05-01","202606":"2026-06-01",
  "202607":"2026-07-01","202608":"2026-08-01","202609":"2026-09-01",
  "202610":"2026-10-01","202611":"2026-11-01","202612":"2026-12-01",
};
const TL_MDAYS = {
  "202507":31,"202508":31,"202509":30,"202510":31,"202511":30,"202512":31,
  "202601":31,"202602":28,"202603":31,"202604":30,"202605":31,"202606":30,
  "202607":31,"202608":31,"202609":30,"202610":31,"202611":30,"202612":31,
};

function init() {
  const n     = DATA.clienti.length;
  const cross = DATA.clienti.filter(c => c.nm >= 2).length;
  document.getElementById('stat-txt').textContent =
    n.toLocaleString('it-IT') + ' clienti  |  ' +
    cross.toLocaleString('it-IT') + ' cross-mese (>=2 mesi)';

  document.getElementById('search').addEventListener('input', e => {
    searchQ = e.target.value.trim().toLowerCase();
    renderList();
  });
  document.getElementById('btn-clear').addEventListener('click', () => {
    selected.clear(); renderList(); renderTimelines();
  });
  renderFilters();
  renderList();
}

/* ── NATURA + FONIA FILTERS ──────────────────── */
function renderFilters() {
  const bar = document.getElementById('natura-bar');

  // row 1: Natura
  const naturas   = DATA.naturas || [];
  const allNatura = naturaFilter.size === 0;
  const row1 =
    '<div class="nf-row">' +
    '<span class="nf-label">Natura:</span>' +
    `<button class="nf-pill nf-natura${allNatura?' active':''}" data-n="">Tutti</button>` +
    naturas.map(n =>
      `<button class="nf-pill nf-natura${naturaFilter.has(n)?' active':''}" data-n="${n}">${n}</button>`
    ).join('') + '</div>';

  // row 2: Tipo Fonia (usa colori prodotto)
  const fonias   = Object.keys(PC);
  const allFonia = foniaFilter.size === 0;
  const row2 =
    '<div class="nf-row">' +
    '<span class="nf-label">Tipo Fonia:</span>' +
    `<button class="nf-pill nf-fonia${allFonia?' active':''}" data-f="">Tutti</button>` +
    fonias.map(f => {
      const isAct = foniaFilter.has(f);
      const col   = PC[f];
      const style = isAct ? `background:${col}22;border-color:${col};color:${col}` : '';
      return `<button class="nf-pill nf-fonia" data-f="${f}" style="${style}">${f}</button>`;
    }).join('') + '</div>';

  // row 3: Tipo Compenso
  const compensi   = DATA.compensi || [];
  const allCompenso = compensoFilter.size === 0;
  const row3 =
    '<div class="nf-row">' +
    '<span class="nf-label">Compenso:</span>' +
    `<button class="nf-pill nf-compenso${allCompenso?' active':''}" data-c="">Tutti</button>` +
    compensi.map(c =>
      `<button class="nf-pill nf-compenso${compensoFilter.has(c)?' active':''}" data-c="${c}">${c}</button>`
    ).join('') + '</div>';

  // row 4: Tipo Attivazione
  const attivazioni   = DATA.attivazioni || [];
  const allAttivazione = attivazioneFilter.size === 0;
  const row4 =
    '<div class="nf-row">' +
    '<span class="nf-label">Attivazione:</span>' +
    `<button class="nf-pill nf-attivazione${allAttivazione?' active':''}" data-a="">Tutti</button>` +
    attivazioni.map(a =>
      `<button class="nf-pill nf-attivazione${attivazioneFilter.has(a)?' active':''}" data-a="${a}">${a}</button>`
    ).join('') + '</div>';

  const row5 =
    '<div class="nf-row"><span class="nf-label">Periodo:</span>' +
    `<button class="nf-pill nf-data${dataFilter?' active':''}">T0 da luglio</button>` +
    `<button class="nf-pill nf-t0jul${t0JulFilter?' active':''}">Primo T0 a luglio</button>` +
    '</div>';

  bar.innerHTML = row1 + row2 + row3 + row4 + row5;

  bar.querySelectorAll('.nf-natura').forEach(btn => {
    btn.addEventListener('click', () => {
      const n = btn.dataset.n;
      if (n === '') naturaFilter.clear();
      else { if (naturaFilter.has(n)) naturaFilter.delete(n); else naturaFilter.add(n); }
      renderFilters(); renderTimelines();
    });
  });
  bar.querySelectorAll('.nf-fonia').forEach(btn => {
    btn.addEventListener('click', () => {
      const f = btn.dataset.f;
      if (f === '') foniaFilter.clear();
      else { if (foniaFilter.has(f)) foniaFilter.delete(f); else foniaFilter.add(f); }
      renderFilters(); renderTimelines();
    });
  });
  bar.querySelectorAll('.nf-compenso').forEach(btn => {
    btn.addEventListener('click', () => {
      const c = btn.dataset.c;
      if (c === '') compensoFilter.clear();
      else { if (compensoFilter.has(c)) compensoFilter.delete(c); else compensoFilter.add(c); }
      renderFilters(); renderTimelines();
    });
  });
  bar.querySelectorAll('.nf-attivazione').forEach(btn => {
    btn.addEventListener('click', () => {
      const a = btn.dataset.a;
      if (a === '') attivazioneFilter.clear();
      else { if (attivazioneFilter.has(a)) attivazioneFilter.delete(a); else attivazioneFilter.add(a); }
      renderFilters(); renderTimelines();
    });
  });
  bar.querySelector('.nf-data').addEventListener('click', () => {
    dataFilter = !dataFilter;
    renderFilters(); renderList(); renderTimelines();
  });
  bar.querySelector('.nf-t0jul').addEventListener('click', () => {
    t0JulFilter = !t0JulFilter;
    renderFilters(); renderList(); renderTimelines();
  });
}

/* ── LISTA CLIENTI ───────────────────────────── */
function renderList() {
  const list  = document.getElementById('client-list');
  const items = DATA.clienti.filter(c => {
    if (dataFilter && (!c.t0 || c.t0 < "202507")) return false;
    if (t0JulFilter) {
      const det2 = DATA.det[c.fc] || {};
      const hasT0Jul = Object.values(det2).some(cd => cd.ev.some(ev => ev.t0 && ev.m === "202507"));
      if (!hasT0Jul) return false;
    }
    if (!searchQ) return true;
    return c.nome.toLowerCase().includes(searchQ) ||
           c.fc.toLowerCase().includes(searchQ)   ||
           c.cod.toLowerCase().includes(searchQ);
  });

  if (!items.length) {
    list.innerHTML = '<div class="no-results">Nessun cliente trovato.<br>Prova un altro termine.</div>';
    updateSelInfo(); return;
  }

  list.innerHTML = items.map(c => {
    const isSel  = selected.has(c.fc);
    const badges = Object.entries(c.p).map(([t,n]) =>
      `<span class="badge" style="background:${PC[t]||PC.ALTRO}">${PI[t]||'?'} ${n}</span>`
    ).join('');
    const ncTxt   = c.nc === 1 ? '1 contratto' : `${c.nc} contratti`;
    const nmTxt   = c.nm === 1 ? '1 mese' : `${c.nm} mesi`;
    const t0Txt   = c.t0 ? ` · T0: ${ML[c.t0]||c.t0}` : '';
    const fcD     = c.fc.length > 18 ? c.fc.slice(0,16)+'...' : c.fc;
    const pdvpTxt = (c.pdvp && c.pdvp!=='N/D') ? `<span class="cl-pdvp">${c.pdvp}</span>` : '';
    return `<div class="cl-item${isSel?' sel':''}" data-fc="${c.fc}">
      <div class="cl-name" title="${c.nome}">${c.nome}</div>
      <div class="cl-meta">
        <span class="cl-fc" title="${c.fc}">${fcD}</span>
        <span class="cl-mesi">${ncTxt} · ${nmTxt}${t0Txt}</span>
      </div>
      ${pdvpTxt}
      <div class="cl-badges">${badges}</div>
    </div>`;
  }).join('');

  list.querySelectorAll('.cl-item').forEach(el => {
    el.addEventListener('click', () => {
      const fc = el.dataset.fc;
      selected.has(fc) ? selected.delete(fc) : selected.add(fc);
      el.classList.toggle('sel', selected.has(fc));
      updateSelInfo(); renderTimelines();
    });
  });
  updateSelInfo();
}

function updateSelInfo() {
  const n = selected.size;
  document.getElementById('sel-info').innerHTML = n === 0
    ? 'Nessuna selezione'
    : `<em>${n}</em> selezionat${n===1?'o':'i'}`;
}

/* ── TIMELINE ────────────────────────────────── */
function renderTimelines() {
  const cont  = document.getElementById('timelines');
  const empty = document.getElementById('empty-state');
  if (!selected.size) {
    cont.style.display='none'; empty.style.display='flex'; return;
  }
  empty.style.display='none'; cont.style.display='block';
  cont.innerHTML = [...selected].map(fc => {
    const c   = DATA.clienti.find(x => x.fc===fc);
    if (!c) return '';
    if (dataFilter && (!c.t0 || c.t0 < "202507")) return '';
    if (t0JulFilter) {
      const det2 = DATA.det[fc] || {};
      const hasT0Jul = Object.values(det2).some(cd => cd.ev.some(ev => ev.t0 && ev.m === "202507"));
      if (!hasT0Jul) return '';
    }
    const det = DATA.det[fc] || {};
    return renderSection(c, det);
  }).join('');
  attachTooltips();
  cont.querySelectorAll('.cl-sec-close').forEach(btn => {
    btn.addEventListener('click', () => {
      const fc = btn.dataset.fc;
      selected.delete(fc);
      document.querySelectorAll(`.cl-item[data-fc="${fc}"]`)
              .forEach(el => el.classList.remove('sel'));
      updateSelInfo(); renderTimelines();
    });
  });
}

/* ── SUMMARY TIMELINE BAND ───────────────────── */
function renderSummaryTimeline(det) {
  if (!MESI.length) return '';

  // time range: first day of first month → last day of last month
  const tStart = new Date(TL_MSTART[MESI[0]] || '2026-01-01').getTime();
  const lastM  = MESI[MESI.length - 1];
  const tEnd   = new Date(TL_MSTART[lastM] || '2026-04-01').getTime()
                 + ((TL_MDAYS[lastM] || 30) - 1) * 86400000;
  const tRange = tEnd - tStart || 1;

  function toPos(dateStr) {
    if (!dateStr) return null;
    const t = new Date(dateStr).getTime();
    if (isNaN(t)) return null;
    const p = (t - tStart) / tRange * 100;
    return p < 0 || p > 101 ? null : Math.min(99.5, Math.max(0.5, p));
  }

  // collect events (respecting natura filter)
  const evs = [];
  for (const [cc, cd] of Object.entries(det)) {
    for (const ev of cd.ev) {
      if (naturaFilter.size > 0     && !naturaFilter.has(ev.na))    continue;
      if (foniaFilter.size  > 0     && !foniaFilter.has(cd.tipo))  continue;
      if (compensoFilter.size > 0   && !compensoFilter.has(ev.tc)) continue;
      if (attivazioneFilter.size > 0 && !attivazioneFilter.has(ev.ta)) continue;
      const useAttiv = (cd.tipo==='FISSO' || cd.tipo==='ENERGIA');
      const pos = useAttiv ? (toPos(ev.da) ?? toPos(ev.d)) : (toPos(ev.d) ?? toPos(ev.da));
      if (pos !== null)
        evs.push({ ...ev, cc, tipo: cd.tipo, pdv: cd.pdv, _pos: pos });
    }
  }

  // vertical stagger for overlapping dots (3 lanes)
  evs.sort((a, b) => a._pos - b._pos);
  const VTOPS = [18, 50, 82];   // % top within track
  let lastPos = -999, lane = 0;
  for (const ev of evs) {
    if (Math.abs(ev._pos - lastPos) < 1.8) { lane = (lane + 1) % 3; }
    else { lane = 1; }           // middle lane default
    ev._lane = lane;
    lastPos  = ev._pos;
  }

  const dotsHtml = evs.map(ev => {
    const col = ev.st ? '#ef4444' : (PC[ev.tipo] || PC.ALTRO);
    const cls = 'sv-dot' + (ev.t0 ? ' t0' : '') + (ev.st ? ' storno' : '');
    const enc = encodeURIComponent(JSON.stringify(ev));
    return `<div class="${cls}" style="left:${ev._pos.toFixed(2)}%;top:${VTOPS[ev._lane]}%;background:${col}" data-ev="${enc}"></div>`;
  }).join('');

  // month segment dividers
  const segsHtml = MESI.map(m => {
    const ms  = new Date(TL_MSTART[m] || '2026-01-01').getTime();
    const pct = ((ms - tStart) / tRange * 100).toFixed(2);
    const w   = ((TL_MDAYS[m] || 30) * 86400000 / tRange * 100).toFixed(2);
    return `<div class="sv-mseg" style="left:${pct}%;width:${w}%"><span>${ML[m]||m}</span></div>`;
  }).join('');

  const nEv = evs.length;
  return `<div class="sv-section">
  <div class="sv-label">Panoramica &mdash; ${nEv} event${nEv===1?'o':'i'} sull\'asse temporale</div>
  <div class="sv-track"><div class="sv-dots-layer">${dotsHtml}</div></div>
  <div class="sv-months"><div class="sv-months-rel">${segsHtml}</div></div>
</div>`;
}

function renderSection(c, det) {
  const badges  = Object.entries(c.p).map(([t,n]) =>
    `<span class="badge" style="background:${PC[t]||PC.ALTRO}">${PI[t]||'?'} ${n}</span>`
  ).join('');
  const pdvTxt  = (c.pdvp && c.pdvp!=='N/D') ? `PDV principale: ${c.pdvp}` : '';
  const t0Txt   = c.t0 ? `T0: ${ML[c.t0]||c.t0}` : '';
  const nContr  = Object.keys(det).length;
  const nEv     = Object.values(det).reduce((s,x)=>s+x.ev.length,0);
  const totImp  = Object.values(det).reduce((s,x)=>s+x.ev.reduce((ss,e)=>ss+(e.i||0),0),0);
  const mesiStr = c.mesi.map(m=>ML[m]||m).join(' > ');
  return `<div class="cl-section">
  <div class="cl-sec-head">
    <div class="cl-sec-info">
      <div class="cl-sec-title" title="${c.nome}">${c.nome}</div>
      <div class="cl-sec-sub">${c.fc}${c.cod?' | '+c.cod:''}</div>
      <div class="cl-sec-pdv">${[pdvTxt,t0Txt].filter(Boolean).join(' | ')}</div>
      <div class="cl-sec-badges">${badges}</div>
    </div>
    <button class="cl-sec-close" data-fc="${c.fc}">x</button>
  </div>
  ${renderSummaryTimeline(det)}
  ${renderTimeline(det)}
  <div class="cl-summary">
    <div class="sum-item">Contratti: <strong>${nContr}</strong></div>
    <div class="sum-item">Eventi: <strong>${nEv}</strong></div>
    <div class="sum-item">Importo totale: <strong>EUR ${totImp.toLocaleString('it-IT',{minimumFractionDigits:2,maximumFractionDigits:2})}</strong></div>
    <div class="sum-item">Percorso: <strong>${mesiStr}</strong></div>
  </div>
</div>`;
}

function renderTimeline(det) {
  const hdrCols = MESI.map(m =>
    `<td class="m-cell" style="text-align:center">${ML[m]||m}</td>`
  ).join('');

  const rows = Object.entries(det).map(([cc,cd]) => {
    const col = PC[cd.tipo] || PC.ALTRO;
    const ccS = cc.length>16 ? cc.slice(0,14)+'...' : cc;
    const cells = MESI.map(m => {
      const evs = cd.ev.filter(e => e.m===m
        && (naturaFilter.size===0    || naturaFilter.has(e.na))
        && (foniaFilter.size===0     || foniaFilter.has(cd.tipo))
        && (compensoFilter.size===0  || compensoFilter.has(e.tc))
        && (attivazioneFilter.size===0 || attivazioneFilter.has(e.ta)));
      if (!evs.length)
        return `<td class="m-cell"><div class="tl-track"><div class="tl-bar-bg"></div><div class="m-empty"></div></div></td>`;
      const dots = evs.map(ev => {
        const dCol = ev.st ? '#ef4444' : col;
        const cls  = 'ev-dot'+(ev.t0?' t0':'')+(ev.st?' storno':'');
        const enc  = encodeURIComponent(JSON.stringify({...ev,cc,pdv:cd.pdv,tipo:cd.tipo}));
        return `<div class="${cls}" style="background:${dCol}" data-ev="${enc}"></div>`;
      }).join('');
      return `<td class="m-cell"><div class="tl-track">
        <div class="tl-bar-bg"></div>
        <div class="tl-bar-fill" style="background:${col}"></div>
        <div class="tl-events">${dots}</div>
      </div></td>`;
    }).join('');

    return `<tr class="tl-row">
      <td class="lbl-cell">
        <span class="tl-tipo-badge" style="background:${col}">${PI[cd.tipo]||'?'} ${cd.tipo}</span>
        <div class="tl-cc" title="${cc}">${ccS}</div>
        ${cd.pdv&&cd.pdv!=='N/D'?`<div class="tl-pdv-small">${cd.pdv}</div>`:''}
        ${cd.pos?`<div class="tl-pdv-small" style="color:#2d3748">POS: ${cd.pos}</div>`:''}
      </td>${cells}</tr>`;
  }).join('');

  return `<div class="tl-wrap"><table class="tl-table">
    <tr class="tl-hdr">
      <td class="lbl-cell" style="font-size:10px;color:#374151;padding-left:14px">Contratto</td>
      ${hdrCols}
    </tr>${rows}
  </table></div>`;
}

/* ── TOOLTIP ─────────────────────────────────── */
const ttEl = document.getElementById('tooltip');

function attachTooltips() {
  document.querySelectorAll('.ev-dot, .sv-dot').forEach(dot => {
    dot.addEventListener('mouseenter', e => showTT(e,dot));
    dot.addEventListener('mouseleave', ()=>{ ttEl.style.display='none'; });
    dot.addEventListener('mousemove', positionTT);
  });
}

function showTT(e, dot) {
  const ev  = JSON.parse(decodeURIComponent(dot.dataset.ev));
  const col = PC[ev.tipo] || PC.ALTRO;
  let h = `<div class="tt-title" style="color:${col}">${ev.e || 'Evento'}</div>`;
  if (ev.tipo && ev.tipo !== 'ALTRO') h += `<div class="tt-r"><strong>Tipo Fonia:</strong> <span style="color:${col};font-weight:600">${ev.tipo}</span></div>`;
  h += `<div class="tt-r"><strong>Contratto:</strong> ${ev.cc}</div>`;
  h += `<div class="tt-r"><strong>Mese:</strong> ${ML[ev.m]||ev.m}</div>`;
  if (ev.d)   h += `<div class="tt-r"><strong>Data evento:</strong> ${ev.d}</div>`;
  if (ev.da)  h += `<div class="tt-r"><strong>Data attivazione:</strong> ${ev.da}</div>`;
  if (ev.df)  h += `<div class="tt-r"><strong>Data firma:</strong> ${ev.df}</div>`;
  if (ev.tl)  h += `<div class="tt-r"><strong>Tipo linea:</strong> ${ev.tl}</div>`;
  if (ev.pt)  h += `<div class="tt-r"><strong>Piano:</strong> ${ev.pt}</div>`;
  if (ev.na)  h += `<div class="tt-r"><strong>Natura:</strong> ${ev.na}</div>`;
  if (ev.tc)  h += `<div class="tt-r"><strong>Tipo compenso:</strong> ${ev.tc}</div>`;
  if (ev.ta)  h += `<div class="tt-r"><strong>Tipo attivazione:</strong> ${ev.ta}</div>`;
  if (ev.mnp && ev.mnp!=='nan') h += `<div class="tt-r"><strong>Portabilita:</strong> ${ev.mnp}</div>`;
  if (ev.pdv && ev.pdv!=='N/D') h += `<div class="tt-r"><strong>Negozio:</strong> ${ev.pdv}</div>`;
  h += `<div class="tt-r"><strong>Importo:</strong> EUR ${(ev.i||0).toLocaleString('it-IT',{minimumFractionDigits:2,maximumFractionDigits:2})}</div>`;
  if (ev.t0) h += `<div class="tt-t0">Prima attivazione MOBILE (T0)</div>`;
  if (ev.st) h += `<div class="tt-storno">Storno / Addebito Negativo</div>`;
  ttEl.innerHTML = h;
  ttEl.style.display = 'block';
  positionTT(e);
}

function positionTT(e) {
  const vw=window.innerWidth, vh=window.innerHeight;
  const tw=ttEl.offsetWidth,  th=ttEl.offsetHeight;
  let x=e.clientX+16, y=e.clientY+16;
  if (x+tw>vw-8) x=e.clientX-tw-16;
  if (y+th>vh-8) y=e.clientY-th-16;
  ttEl.style.left=x+'px'; ttEl.style.top=y+'px';
}

init();
</script>
</body>
</html>"""


def generate_html(data):
    dj = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
    return HTML_TEMPLATE.replace('__DATA__', dj)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    print("=== Tracciamento Cliente — Generatore ===")
    print(f"Cartella: {CARTELLA}")
    print(f"Filtro MIN_MESI = {MIN_MESI}\n")

    print("Caricamento file Excel...")
    df = load_data()
    print(f"\nRighe totali:  {len(df):,}")
    print(f"FISCAL_CODE:   {df['FISCAL_CODE'].nunique():,} unici\n")

    print("Costruzione dati...")
    data = build_data(df)

    print("\nGenerazione HTML...")
    html = generate_html(data)

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        f.write(html)

    size_mb = os.path.getsize(OUTPUT_FILE) / 1024 / 1024
    print(f"\nSalvato: {OUTPUT_FILE}")
    print(f"Dimensione file: {size_mb:.1f} MB")
    print(f"Clienti nel file: {len(data['clienti']):,}")
    print("\nFatto. Apri tracciamento_cliente.html nel browser.")
