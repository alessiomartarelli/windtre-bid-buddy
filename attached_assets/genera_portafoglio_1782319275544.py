"""
genera_portafoglio.py
Genera portafoglio_negozio.html — clienti raggruppati per negozio Wind3.
Esegui con: python genera_portafoglio.py
"""

import os, glob, json, re
import pandas as pd
from collections import defaultdict

CARTELLA    = os.path.dirname(os.path.abspath(__file__))
OUTPUT_FILE = os.path.join(CARTELLA, "portafoglio_negozio.html")
MIN_MESI    = 1

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
    df["IMPORTO"] = pd.to_numeric(df.get("IMPORTO", pd.Series(dtype=float)), errors="coerce")
    df["PERIOD"]  = df["PERIOD"].astype(str).str.strip()
    df["PDV"] = df.get("CODICE_NEGOZIO_COSY", pd.Series(dtype=str)).apply(
        lambda c: "N/D" if pd.isna(c) else NEGOZI_PDV.get(str(c).strip(), f"PDV {c}")
    )
    is_mob   = df.get("TIPO_FONIA", pd.Series(dtype=str)) == "MOBILE"
    attiv_ym = pd.to_datetime(df.get("DT_ATTIVAZIONE"), errors="coerce").dt.strftime("%Y%m").fillna("")
    df["IS_T0"]     = is_mob & (attiv_ym == df["PERIOD"].fillna(""))
    df["IS_STORNO"] = df.get("ITEM_CATEGORY", pd.Series(dtype=str))\
                        .str.contains("Addebito Negativo", case=False, na=False)
    fc = df.get("FISCAL_CODE", pd.Series(dtype=str)).astype(str).str.strip()
    df = df[fc.notna() & (fc != "") & (fc != "nan") & (fc != "NaN") & (fc != "None")].copy()
    df["FISCAL_CODE"] = df["FISCAL_CODE"].astype(str).str.strip()
    return df


def build_data(df):
    mesi_all = sorted(df["PERIOD"].dropna().unique().tolist())

    for col in ["DATA_EVENTO","DT_ATTIVAZIONE","DATA_FIRMA"]:
        df[col+"_str"] = (df[col].dt.strftime("%Y-%m-%d")
                          if col in df.columns and pd.api.types.is_datetime64_any_dtype(df[col])
                          else "")
        df[col+"_str"] = df[col+"_str"].fillna("")

    df["IMPORTO_f"] = pd.to_numeric(df.get("IMPORTO", pd.Series(dtype=float)),
                                     errors="coerce").fillna(0.0).round(2)
    for col in ["DESCRIZIONE_EVENTO","TIPO_LINEA","DESCRIZIONE_PIANO_TARIFFARIO",
                "MNP","CODICE_POS_ORIGINARIO","TIPO_FONIA","CODICE_CONTRATTO",
                "CLIENTE","COD_CLIENTE","NATURA","TIPO_COMPENSO","TIPO_ATTIVAZIONE"]:
        if col not in df.columns: df[col] = ""
        df[col] = df[col].fillna("").astype(str).str.strip()

    nm_series = df.groupby("FISCAL_CODE")["PERIOD"].nunique()
    fc_validi  = set(nm_series[nm_series >= MIN_MESI].index.tolist())
    df_f = df[df["FISCAL_CODE"].isin(fc_validi)].copy()
    print(f"  Clienti validi: {len(fc_validi):,}")

    print("  Calcolo indice clienti...")
    nome_s = df_f[df_f["CLIENTE"]!=""].sort_values("CLIENTE").groupby("FISCAL_CODE")["CLIENTE"].first()
    cod_s  = df_f[df_f["COD_CLIENTE"]!=""].groupby("FISCAL_CODE")["COD_CLIENTE"].first()
    pdv_s  = df_f[df_f["PDV"]!=""].groupby("FISCAL_CODE")["PDV"].first()
    nm_s   = df_f.groupby("FISCAL_CODE")["PERIOD"].nunique()
    nc_s   = df_f.groupby("FISCAL_CODE")["CODICE_CONTRATTO"].nunique()
    t0_s   = df_f[df_f["IS_T0"]].groupby("FISCAL_CODE")["PERIOD"].min()
    # PDV principale: PDV del T0 se esiste, altrimenti primo evento cronologico
    t0_pdv_s    = (df_f[df_f["IS_T0"] & (df_f["PDV"] != "")]
                   .sort_values("DATA_EVENTO")
                   .groupby("FISCAL_CODE")["PDV"].first())
    first_pdv_s = (df_f[df_f["PDV"] != ""]
                   .sort_values("DATA_EVENTO")
                   .groupby("FISCAL_CODE")["PDV"].first())
    pdvp_s = t0_pdv_s.combine_first(first_pdv_s)
    mesi_s = df_f.groupby("FISCAL_CODE")["PERIOD"].unique().apply(lambda a: sorted(a.tolist()))
    prod_pivot = (df_f[df_f["TIPO_FONIA"]!=""]
                  .groupby(["FISCAL_CODE","TIPO_FONIA"])["CODICE_CONTRATTO"]
                  .nunique().unstack(fill_value=0))

    idx_df = pd.DataFrame({
        "nome":nome_s,"cod":cod_s,"pdv":pdv_s,
        "nm":nm_s,"nc":nc_s,"t0":t0_s,"mesi":mesi_s,"pdvp":pdvp_s,
    }).fillna({"nome":"N/D","cod":"","pdv":"N/D","t0":"","nc":0,"pdvp":"N/D"})

    clienti_idx = []
    clienti_map_py = {}
    for fc, row in idx_df.iterrows():
        prodotti = {}
        if fc in prod_pivot.index:
            for col in prod_pivot.columns:
                v = int(prod_pivot.at[fc, col])
                if v > 0: prodotti[col] = v
        obj = {
            "fc":fc, "nome":str(row["nome"]), "cod":str(row["cod"]), "pdv":str(row["pdv"]),
            "nm":int(row["nm"]), "nc":int(row["nc"]), "t0":str(row["t0"]),
            "mesi":list(row["mesi"]) if hasattr(row["mesi"],"__iter__") else [],
            "p":prodotti, "pdvp":str(row["pdvp"]),
        }
        clienti_idx.append(obj)
        clienti_map_py[fc] = obj
    print(f"  Indice clienti: {len(clienti_idx):,}")

    print("  Costruzione eventi...")
    cc_tipo_d = (df_f[df_f["TIPO_FONIA"]!=""]
                 .groupby(["FISCAL_CODE","CODICE_CONTRATTO"])["TIPO_FONIA"]
                 .first().fillna("ALTRO")).to_dict()
    cc_pdv_d  = (df_f[df_f["PDV"]!=""]
                 .sort_values("DATA_EVENTO")
                 .groupby(["FISCAL_CODE","CODICE_CONTRATTO"])["PDV"]
                 .first().fillna("N/D")).to_dict()
    cc_pos_d  = (df_f[df_f["CODICE_POS_ORIGINARIO"]!=""]
                 .groupby(["FISCAL_CODE","CODICE_CONTRATTO"])["CODICE_POS_ORIGINARIO"]
                 .first().fillna("")).to_dict()

    ev_cols = ["FISCAL_CODE","CODICE_CONTRATTO","PERIOD",
               "DATA_EVENTO_str","DT_ATTIVAZIONE_str","DATA_FIRMA_str",
               "DESCRIZIONE_EVENTO","IMPORTO_f","IS_T0","IS_STORNO",
               "TIPO_LINEA","DESCRIZIONE_PIANO_TARIFFARIO","MNP",
               "NATURA","TIPO_COMPENSO","TIPO_ATTIVAZIONE"]
    ev_cols  = [c for c in ev_cols if c in df_f.columns]
    records  = df_f[ev_cols].to_dict("records")

    ev_by_key = defaultdict(list)
    for r in records:
        ev_by_key[(r["FISCAL_CODE"],r["CODICE_CONTRATTO"])].append({
            "m":r.get("PERIOD",""), "d":r.get("DATA_EVENTO_str",""),
            "da":r.get("DT_ATTIVAZIONE_str",""), "df":r.get("DATA_FIRMA_str",""),
            "e":r.get("DESCRIZIONE_EVENTO",""), "i":float(r.get("IMPORTO_f",0)),
            "t0":bool(r.get("IS_T0",False)), "st":bool(r.get("IS_STORNO",False)),
            "tl":r.get("TIPO_LINEA",""), "pt":r.get("DESCRIZIONE_PIANO_TARIFFARIO",""),
            "mnp":r.get("MNP",""), "na":r.get("NATURA",""),
            "tc":r.get("TIPO_COMPENSO",""), "ta":r.get("TIPO_ATTIVAZIONE",""),
        })

    ev_by_fc = defaultdict(dict)
    for (fc, cc), evs in ev_by_key.items():
        ev_by_fc[fc][cc] = evs

    clienti_det = {}
    for fc in fc_validi:
        contratti = {}
        for cc, evs in ev_by_fc.get(fc,{}).items():
            contratti[cc] = {
                "tipo":str(cc_tipo_d.get((fc,cc),"ALTRO")),
                "pdv": str(cc_pdv_d.get((fc,cc),"N/D")),
                "pos": str(cc_pos_d.get((fc,cc),"")),
                "ev":  evs,
            }
        clienti_det[fc] = contratti

    print("  Costruzione indice negozi...")
    negozio_fcs = {}
    for pdv, group in df_f.groupby("PDV"):
        if not pdv or pdv == "N/D" or str(pdv).startswith("PDV "):
            continue
        fcs_raw    = [fc for fc in group["FISCAL_CODE"].unique().tolist() if fc in fc_validi]
        fcs_sorted = sorted(fcs_raw, key=lambda f: clienti_map_py.get(f,{}).get("nome","").upper())
        negozio_fcs[pdv] = fcs_sorted

    negozi = []
    for pdv, fcs in negozio_fcs.items():
        n_propri = sum(1 for fc in fcs if clienti_map_py.get(fc, {}).get("pdvp", "") == pdv)
        n_altri  = len(fcs) - n_propri
        negozi.append({"pdv": pdv, "n_fc": len(fcs), "n_propri": n_propri, "n_altri": n_altri})
    negozi.sort(key=lambda x: -x["n_fc"])
    print(f"  Negozi con clienti: {len(negozi)}")

    def _vals(col):
        if col not in df_f.columns: return []
        return sorted([v for v in df_f[col].dropna().unique().tolist() if v])

    print("  Dati pronti.")
    return {
        "clienti":     clienti_idx,
        "det":         clienti_det,
        "negozi":      negozi,
        "n_fcs":       negozio_fcs,
        "mesi":        mesi_all,
        "ml":          {m: MESE_LABEL_MAP.get(m,m) for m in mesi_all},
        "pc":          PRODOTTO_COLORE,
        "pi":          PRODOTTO_ICON,
        "naturas":     _vals("NATURA"),
        "compensi":    _vals("TIPO_COMPENSO"),
        "attivazioni": _vals("TIPO_ATTIVAZIONE"),
    }


HTML_TEMPLATE = r"""<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Portafoglio Negozio — Wind3</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Helvetica Neue',sans-serif;
     background:#0a0f1e;color:#e2e8f0;height:100vh;display:flex;flex-direction:column;overflow:hidden}

/* TOPBAR */
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

/* LEFT PANEL — negozi */
#left{width:240px;min-width:240px;background:#0d1526;
      border-right:1px solid #1e2d4a;display:flex;flex-direction:column;overflow:hidden}
#left-title{padding:12px 14px 8px;font-size:11px;font-weight:700;color:#334155;
            text-transform:uppercase;letter-spacing:.6px;flex-shrink:0}
#negozio-list{flex:1;overflow-y:auto;scrollbar-width:thin;scrollbar-color:#1e2d4a #0d1526}
#negozio-list::-webkit-scrollbar{width:4px}
#negozio-list::-webkit-scrollbar-thumb{background:#1e2d4a;border-radius:2px}
.ng-item{padding:10px 14px;border-bottom:1px solid #0f1829;cursor:pointer;
         transition:background .1s;border-left:3px solid transparent;
         display:flex;align-items:center;justify-content:space-between;gap:8px}
.ng-item:hover{background:#111827}
.ng-item.sel{background:#0c1e38;border-left-color:#3b82f6}
.ng-name{font-size:12px;font-weight:600;color:#cbd5e1}
.ng-item.sel .ng-name{color:#93c5fd}
.ng-counts{display:flex;flex-direction:column;align-items:flex-end;gap:2px;flex-shrink:0}
.ng-count{font-size:10px;font-weight:700;padding:1px 7px;border-radius:10px;white-space:nowrap}
.ng-count-propri{color:#60a5fa;background:#0c1e38;border:1px solid #1e3a5f}
.ng-count-altri{color:#fbbf24;background:#1c1107;border:1px solid #78350f}
.ng-item.sel .ng-count-propri{color:#93c5fd;border-color:#3b82f6}

/* RIGHT PANEL */
#right{flex:1;display:flex;flex-direction:column;overflow:hidden}

/* FILTER BAR */
#filter-bar{background:#0a0f1e;border-bottom:1px solid #1e2d4a;padding:8px 20px;
            display:flex;flex-direction:column;gap:6px;flex-shrink:0}
.nf-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.nf-label{font-size:11px;color:#475569;white-space:nowrap;min-width:75px}
.nf-pill{background:none;border:1px solid #1e2d4a;color:#64748b;font-size:11px;
         padding:3px 11px;border-radius:20px;cursor:pointer;transition:all .15s;white-space:nowrap}
.nf-pill:hover{border-color:#3b82f6;color:#93c5fd}
.nf-pill.active{background:#1e3a5f;border-color:#3b82f6;color:#93c5fd;font-weight:600}

/* NEGOZIO CONTENT */
#negozio-content{flex:1;overflow-y:auto;display:flex;flex-direction:column;
                 scrollbar-width:thin;scrollbar-color:#1e2d4a #0a0f1e}
#negozio-content::-webkit-scrollbar{width:6px}
#negozio-content::-webkit-scrollbar-thumb{background:#1e2d4a;border-radius:3px}

/* SUMMARY BAR */
#summary-bar{background:#0d1526;border-bottom:2px solid #1e2d4a;padding:12px 20px;
             display:flex;align-items:center;gap:16px;flex-wrap:wrap;flex-shrink:0;
             position:sticky;top:0;z-index:50}
#summary-pdv{font-size:15px;font-weight:800;color:#e2e8f0;white-space:nowrap}
.sum-chip{display:flex;align-items:center;gap:5px;background:#111827;
          border:1px solid #1e2d4a;border-radius:8px;padding:4px 10px}
.sum-chip .sc-val{font-size:14px;font-weight:700;color:#93c5fd}
.sum-chip .sc-lbl{font-size:10px;color:#94a3b8}
.sum-chip .sc-sub{font-size:9px;color:#64748b;white-space:nowrap}
.sum-tipo{display:flex;align-items:center;gap:4px;font-size:11px;font-weight:600}
.sum-tipo .st-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}

/* CLIENT SEARCH */
#client-search-wrap{padding:10px 20px 6px;flex-shrink:0}
#client-search{width:100%;max-width:400px;background:#111827;border:1px solid #1e2d4a;
               color:#e2e8f0;border-radius:8px;padding:7px 12px;font-size:13px;
               outline:none;transition:border-color .15s}
#client-search:focus{border-color:#3b82f6}
#client-search::placeholder{color:#475569}
#search-info{font-size:11px;color:#475569;margin-top:4px}

/* CLIENT ACCORDION */
#client-accordion{flex:1;padding:0 20px 40px}

/* COMPACT CLIENT ROW */
.acc-row{background:#111827;border:1px solid #1e2d4a;border-radius:10px;
         margin-bottom:8px;overflow:hidden}
.acc-head{padding:10px 14px;display:flex;align-items:center;gap:10px;cursor:pointer;
          transition:background .1s;user-select:none}
.acc-head:hover{background:#0c1a2e}
.acc-head.open{background:#0c1e38;border-bottom:1px solid #1e2d4a}
.acc-arrow{font-size:10px;color:#334155;flex-shrink:0;transition:transform .15s;width:12px}
.acc-head.open .acc-arrow{transform:rotate(90deg);color:#60a5fa}
.acc-name{font-size:12px;font-weight:700;color:#e2e8f0;
          white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:180px;flex:1}
.acc-head.open .acc-name{color:#93c5fd}
.acc-fc{font-size:10px;color:#64748b;font-family:'Courier New',monospace;white-space:nowrap}
.acc-meta{font-size:10px;color:#94a3b8;white-space:nowrap}
.acc-badges{display:flex;gap:3px;flex-wrap:wrap}
.badge{font-size:9px;font-weight:700;padding:2px 6px;border-radius:9px;color:#fff;white-space:nowrap}
.acc-pdvp-tag{font-size:9px;font-weight:600;padding:2px 7px;border-radius:9px;
              background:#78350f;color:#fef3c7;white-space:nowrap;flex-shrink:0}

/* EXPANDED SECTION */
.acc-body{padding:0 0 4px}

/* TIMELINE (same as tracciamento_cliente) */
.sv-section{padding:10px 14px 0}
.sv-label{font-size:10px;font-weight:700;color:#334155;text-transform:uppercase;
          letter-spacing:.6px;margin-bottom:5px}
.sv-track{position:relative;height:52px;background:#0b1220;
          border:1px solid #1e2d4a;border-radius:8px 8px 0 0;overflow:visible}
.sv-dots-layer{position:absolute;inset:0;z-index:2}
.sv-dot{position:absolute;width:13px;height:13px;border-radius:50%;
        cursor:pointer;border:2px solid rgba(0,0,0,.35);
        transform:translate(-50%,-50%);transition:transform .12s;z-index:5}
.sv-dot:hover{transform:translate(-50%,-50%) scale(1.7);z-index:20;
              box-shadow:0 2px 10px rgba(0,0,0,.7)}
.sv-dot.t0{border-radius:3px;border-color:rgba(251,191,36,.8)}
.sv-dot.storno{opacity:.35}
.sv-months{display:flex;height:22px;border:1px solid #1e2d4a;border-top:none;
           border-radius:0 0 8px 8px;overflow:hidden;background:#090e1a}
.sv-months-rel{position:relative;width:100%;height:100%}
.sv-mseg{position:absolute;top:0;bottom:0;border-left:1px solid #1e2d4a;
         display:flex;align-items:center;padding-left:7px;overflow:hidden}
.sv-mseg:first-child{border-left:none}
.sv-mseg span{font-size:10px;color:#cbd5e1;font-weight:700;text-transform:uppercase;
              letter-spacing:.5px;white-space:nowrap}

.tl-wrap{overflow-x:auto;padding:0 14px 8px}
.tl-table{border-collapse:collapse;width:100%}
.tl-hdr td{padding:6px 4px;text-align:center;font-size:10px;font-weight:700;
           color:#cbd5e1;text-transform:uppercase;letter-spacing:.6px;
           border-bottom:1px solid #1e2d4a;background:#0d1526}
.tl-hdr .lbl-cell{text-align:left;padding-left:14px}
.tl-row td{border-bottom:1px solid #0f1829;vertical-align:middle}
.tl-row:last-child td{border-bottom:none}
.lbl-cell{width:200px;min-width:200px;padding:9px 10px 9px 14px}
.tl-tipo-badge{font-size:9px;font-weight:700;padding:2px 7px;border-radius:6px;
               color:#fff;display:inline-block;margin-bottom:3px}
.tl-cc{font-size:10px;color:#94a3b8;font-family:'Courier New',monospace;
       white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:170px}
.tl-pdv-small{font-size:9px;color:#64748b;margin-top:2px}
/* OTHER STORE MARKER */
.lbl-other{border-left:3px solid #f59e0b !important;
           background:rgba(245,158,11,.04) !important}
.other-pdv-tag{display:inline-block;font-size:9px;font-weight:600;color:#f59e0b;
               border:1px solid rgba(245,158,11,.35);border-radius:4px;
               padding:1px 6px;margin-top:3px;white-space:nowrap}
.m-cell{min-width:170px;width:170px;padding:7px 6px}
.tl-track{position:relative;height:30px;display:flex;align-items:center}
.tl-bar-bg{position:absolute;left:8px;right:8px;height:3px;border-radius:2px;background:#1e2d4a}
.tl-bar-fill{position:absolute;left:8px;right:8px;height:3px;border-radius:2px;opacity:.35}
.tl-events{display:flex;align-items:center;gap:5px;position:relative;z-index:1;
           padding:0 8px;flex-wrap:wrap;justify-content:center}
.m-empty{opacity:.06;border-left:1px dashed #334155;height:30px;width:100%}
.ev-dot{width:14px;height:14px;border-radius:50%;cursor:pointer;flex-shrink:0;
        transition:transform .12s;border:2px solid rgba(0,0,0,.3);position:relative}
.ev-dot:hover{transform:scale(1.5);z-index:20;box-shadow:0 2px 10px rgba(0,0,0,.6)}
.ev-dot.t0{border-radius:4px;border-color:rgba(251,191,36,.7)}
.ev-dot.storno{opacity:.4}

/* CLIENT SUMMARY FOOTER */
.acc-footer{display:flex;gap:14px;padding:8px 14px;border-top:1px solid #1e2d4a;
            flex-wrap:wrap;background:#0a1020;align-items:center}
.sum-item{font-size:11px;color:#64748b}
.sum-item strong{color:#93c5fd}
.fi-breakdown{display:flex;gap:8px;flex-wrap:wrap;width:100%;padding-top:6px;
              border-top:1px solid #0f1829;margin-top:2px}
.fi-tipo{display:flex;align-items:center;gap:5px;padding:3px 10px;border-radius:8px;
         border:1px solid #1e2d4a;font-size:11px;background:#111827}
.fi-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}

/* TOOLTIP */
#tooltip{position:fixed;z-index:9999;background:#1e293b;border:1px solid #334155;
         border-radius:10px;padding:11px 15px;font-size:11px;color:#e2e8f0;
         pointer-events:none;max-width:300px;line-height:1.8;
         box-shadow:0 8px 32px rgba(0,0,0,.6);display:none}
.tt-title{font-weight:700;font-size:12px;margin-bottom:5px;word-break:break-word}
.tt-r{color:#94a3b8}.tt-r strong{color:#e2e8f0}
.tt-t0{color:#fbbf24;font-size:10px;margin-top:5px}
.tt-storno{color:#ef4444;font-size:10px;margin-top:5px}

/* EMPTY STATE */
#empty-state{display:flex;flex-direction:column;align-items:center;justify-content:center;
             height:100%;color:#475569;gap:14px;text-align:center;padding:40px;flex:1}
#empty-state .icon{font-size:52px;opacity:.3}
#empty-state p{font-size:13px;max-width:320px;line-height:1.7}
</style>
</head>
<body>

<div id="topbar">
  <div class="logo">Wind3 <span>Portafoglio Negozio</span></div>
  <a href="tracciamento_cliente.html" class="nav-link">Tracciamento Cliente</a>
  <div id="stat-txt"></div>
</div>

<div id="main">
  <div id="left">
    <div id="left-title">Negozi</div>
    <div id="negozio-list"></div>
  </div>

  <div id="right">
    <div id="filter-bar"></div>
    <div id="empty-state">
      <div class="icon">&#127978;</div>
      <p>Seleziona un negozio dalla lista per visualizzare il <strong>portafoglio clienti</strong></p>
    </div>
    <div id="negozio-content" style="display:none">
      <div id="summary-bar"></div>
      <div id="client-search-wrap">
        <input id="client-search" type="text" placeholder="Cerca cliente per nome o codice fiscale..." autocomplete="off">
        <div id="search-info"></div>
      </div>
      <div id="client-accordion"></div>
    </div>
  </div>
</div>

<div id="tooltip"></div>

<script>
const DATA = __DATA__;
const MESI = DATA.mesi;
const ML   = DATA.ml;
const PC   = DATA.pc;
const PI   = DATA.pi;

// build fast FC lookup
DATA.cmap = {};
for (const c of DATA.clienti) DATA.cmap[c.fc] = c;

let selectedPdv    = null;
let clientSearchQ  = "";
let expandedFcs    = new Set();
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
  "202607":"2026-07-01","202608":"2026-08-01",
};
const TL_MDAYS = {
  "202507":31,"202508":31,"202509":30,"202510":31,"202511":30,"202512":31,
  "202601":31,"202602":28,"202603":31,"202604":30,
  "202605":31,"202606":30,"202607":31,"202608":31,
};

/* ── INIT ─────────────────────────────────────── */
function init() {
  const tot = DATA.negozi.reduce((s,n) => s + n.n_fc, 0);
  document.getElementById('stat-txt').textContent =
    DATA.negozi.length + ' negozi  |  ' +
    DATA.clienti.length.toLocaleString('it-IT') + ' clienti totali';

  document.getElementById('client-search').addEventListener('input', e => {
    clientSearchQ = e.target.value.trim().toLowerCase();
    if (selectedPdv) renderClientAccordion();
  });

  renderFilters();
  renderNegozioList();
}

/* ── FILTERS ─────────────────────────────────── */
function renderFilters() {
  const bar = document.getElementById('filter-bar');

  const naturas    = DATA.naturas || [];
  const allNatura  = naturaFilter.size === 0;
  const row1 = '<div class="nf-row"><span class="nf-label">Natura:</span>' +
    `<button class="nf-pill nf-natura${allNatura?' active':''}" data-n="">Tutti</button>` +
    naturas.map(n => `<button class="nf-pill nf-natura${naturaFilter.has(n)?' active':''}" data-n="${n}">${n}</button>`).join('') +
    '</div>';

  const fonias   = Object.keys(PC);
  const allFonia = foniaFilter.size === 0;
  const row2 = '<div class="nf-row"><span class="nf-label">Tipo Fonia:</span>' +
    `<button class="nf-pill nf-fonia${allFonia?' active':''}" data-f="">Tutti</button>` +
    fonias.map(f => {
      const isAct = foniaFilter.has(f);
      const col   = PC[f];
      const style = isAct ? `background:${col}22;border-color:${col};color:${col}` : '';
      return `<button class="nf-pill nf-fonia" data-f="${f}" style="${style}">${f}</button>`;
    }).join('') + '</div>';

  const compensi    = DATA.compensi || [];
  const allCompenso = compensoFilter.size === 0;
  const row3 = '<div class="nf-row"><span class="nf-label">Compenso:</span>' +
    `<button class="nf-pill nf-compenso${allCompenso?' active':''}" data-c="">Tutti</button>` +
    compensi.map(c => `<button class="nf-pill nf-compenso${compensoFilter.has(c)?' active':''}" data-c="${c}">${c}</button>`).join('') +
    '</div>';

  const attivazioni    = DATA.attivazioni || [];
  const allAttivazione = attivazioneFilter.size === 0;
  const row4 = '<div class="nf-row"><span class="nf-label">Attivazione:</span>' +
    `<button class="nf-pill nf-attivazione${allAttivazione?' active':''}" data-a="">Tutti</button>` +
    attivazioni.map(a => `<button class="nf-pill nf-attivazione${attivazioneFilter.has(a)?' active':''}" data-a="${a}">${a}</button>`).join('') +
    '</div>';

  const row5 = '<div class="nf-row"><span class="nf-label">Periodo:</span>' +
    `<button class="nf-pill nf-data${dataFilter?' active':''}">T0 da luglio</button>` +
    `<button class="nf-pill nf-t0jul${t0JulFilter?' active':''}">Primo T0 a luglio</button>` +
    '</div>';

  bar.innerHTML = row1 + row2 + row3 + row4 + row5;

  bar.querySelectorAll('.nf-natura').forEach(btn => {
    btn.addEventListener('click', () => {
      const n = btn.dataset.n;
      if (n==='') naturaFilter.clear(); else { naturaFilter.has(n)?naturaFilter.delete(n):naturaFilter.add(n); }
      renderFilters(); renderNegozioList(); if (selectedPdv) { renderSummary(); renderClientAccordion(); }
    });
  });
  bar.querySelectorAll('.nf-fonia').forEach(btn => {
    btn.addEventListener('click', () => {
      const f = btn.dataset.f;
      if (f==='') foniaFilter.clear(); else { foniaFilter.has(f)?foniaFilter.delete(f):foniaFilter.add(f); }
      renderFilters(); renderNegozioList(); if (selectedPdv) { renderSummary(); renderClientAccordion(); }
    });
  });
  bar.querySelectorAll('.nf-compenso').forEach(btn => {
    btn.addEventListener('click', () => {
      const c = btn.dataset.c;
      if (c==='') compensoFilter.clear(); else { compensoFilter.has(c)?compensoFilter.delete(c):compensoFilter.add(c); }
      renderFilters(); renderNegozioList(); if (selectedPdv) { renderSummary(); renderClientAccordion(); }
    });
  });
  bar.querySelectorAll('.nf-attivazione').forEach(btn => {
    btn.addEventListener('click', () => {
      const a = btn.dataset.a;
      if (a==='') attivazioneFilter.clear(); else { attivazioneFilter.has(a)?attivazioneFilter.delete(a):attivazioneFilter.add(a); }
      renderFilters(); renderNegozioList(); if (selectedPdv) { renderSummary(); renderClientAccordion(); }
    });
  });
  bar.querySelector('.nf-data').addEventListener('click', () => {
    dataFilter = !dataFilter;
    renderFilters(); renderNegozioList(); if (selectedPdv) { renderSummary(); renderClientAccordion(); }
  });
  bar.querySelector('.nf-t0jul').addEventListener('click', () => {
    t0JulFilter = !t0JulFilter;
    renderFilters(); renderNegozioList(); if (selectedPdv) { renderSummary(); renderClientAccordion(); }
  });
}

function evPassesFilters(ev, tipo) {
  return (naturaFilter.size===0     || naturaFilter.has(ev.na))
      && (foniaFilter.size===0      || foniaFilter.has(tipo))
      && (compensoFilter.size===0   || compensoFilter.has(ev.tc))
      && (attivazioneFilter.size===0 || attivazioneFilter.has(ev.ta));
}

/* ── NEGOZIO LIST ────────────────────────────── */
function renderNegozioList() {
  const list = document.getElementById('negozio-list');
  const hasFilters = naturaFilter.size > 0 || foniaFilter.size > 0 ||
                     compensoFilter.size > 0 || attivazioneFilter.size > 0 || dataFilter || t0JulFilter;
  list.innerHTML = DATA.negozi.map(ng => {
    let nPropri, nAltri;
    if (hasFilters) {
      nPropri = 0; nAltri = 0;
      for (const fc of (DATA.n_fcs[ng.pdv] || [])) {
        if (!clientPassesFilters(fc, ng.pdv)) continue;
        const c = DATA.cmap[fc];
        if (c && c.pdvp === ng.pdv) nPropri++; else nAltri++;
      }
    } else {
      nPropri = ng.n_propri;
      nAltri  = ng.n_altri;
    }
    const altriHtml = nAltri > 0
      ? `<span class="ng-count ng-count-altri">${nAltri} altri</span>`
      : '';
    return `<div class="ng-item${ng.pdv===selectedPdv?' sel':''}" data-pdv="${ng.pdv}">
      <span class="ng-name">${ng.pdv}</span>
      <div class="ng-counts">
        <span class="ng-count ng-count-propri">${nPropri} propri</span>
        ${altriHtml}
      </div>
    </div>`;
  }).join('');
  list.querySelectorAll('.ng-item').forEach(el => {
    el.addEventListener('click', () => selectNegozio(el.dataset.pdv));
  });
}

function selectNegozio(pdv) {
  selectedPdv = pdv;
  expandedFcs.clear();
  clientSearchQ = "";
  document.getElementById('client-search').value = "";
  renderNegozioList();
  document.getElementById('empty-state').style.display = 'none';
  document.getElementById('negozio-content').style.display = 'flex';
  document.getElementById('negozio-content').style.flexDirection = 'column';
  renderSummary();
  renderClientAccordion();
}

/* ── SUMMARY (filter-responsive) ─────────────── */
function computeSummary(pdv) {
  const fcs = DATA.n_fcs[pdv] || [];
  const clientiSet  = new Set();
  const propri      = new Set();
  const ccPerTipo   = {};
  const impPerTipo  = {};

  for (const fc of fcs) {
    const det = DATA.det[fc] || {};
    for (const [cc, cd] of Object.entries(det)) {
      if (cd.pdv !== pdv) continue;
      const visEvs = cd.ev.filter(ev => evPassesFilters(ev, cd.tipo));
      if (visEvs.length > 0) {
        clientiSet.add(fc);
        const cObj = DATA.cmap[fc];
        if (cObj && cObj.pdvp === pdv) propri.add(fc);
        if (!ccPerTipo[cd.tipo]) { ccPerTipo[cd.tipo] = new Set(); impPerTipo[cd.tipo] = 0; }
        ccPerTipo[cd.tipo].add(cc);
        impPerTipo[cd.tipo] += visEvs.reduce((s, ev) => s + (ev.i || 0), 0);
      }
    }
  }
  return {
    nFc:    clientiSet.size,
    nPropri: propri.size,
    tipi: Object.entries(ccPerTipo)
                .map(([t,s]) => ({tipo:t, n:s.size, imp: impPerTipo[t]||0}))
                .sort((a,b) => b.n - a.n),
  };
}

function renderSummary() {
  const s   = computeSummary(selectedPdv);
  const bar = document.getElementById('summary-bar');

  const fmtImp = v => {
    if (Math.abs(v) >= 1000) return '€' + (v/1000).toLocaleString('it-IT',{minimumFractionDigits:1,maximumFractionDigits:1}) + 'k';
    return '€' + v.toLocaleString('it-IT',{minimumFractionDigits:0,maximumFractionDigits:0});
  };

  const totImp = s.tipi.reduce((sum,t) => sum + t.imp, 0);

  const tipiHtml = s.tipi.map(({tipo,n,imp}) =>
    `<div class="sum-tipo">
      <div class="st-dot" style="background:${PC[tipo]||PC.ALTRO}"></div>
      <span style="color:${PC[tipo]||PC.ALTRO};font-weight:700">${tipo}</span>
      <span style="color:#e2e8f0;font-weight:700">${n}cc</span>
      <span style="color:#94a3b8;font-size:10px">${fmtImp(imp)}</span>
    </div>`
  ).join('<span style="color:#1e2d4a;margin:0 2px">|</span>');

  const propTag = s.nPropri < s.nFc
    ? `<span class="sc-sub">(${s.nPropri} propri, ${s.nFc-s.nPropri} da altri PDV)</span>` : '';
  bar.innerHTML =
    `<div id="summary-pdv">${selectedPdv}</div>` +
    `<div class="sum-chip"><span class="sc-val">${s.nFc}</span><span class="sc-lbl">clienti</span>${propTag}</div>` +
    `<div class="sum-chip"><span class="sc-val">${fmtImp(totImp)}</span><span class="sc-lbl">totale</span></div>` +
    `<div class="sum-chip" style="gap:10px;flex-wrap:wrap">${tipiHtml}</div>`;
}

/* ── CLIENT ACCORDION ────────────────────────── */
function clientPassesFilters(fc, pdv) {
  if (dataFilter) {
    const c = DATA.cmap[fc];
    if (!c || !c.t0 || c.t0 < "202507") return false;
  }
  if (t0JulFilter) {
    const det2 = DATA.det[fc] || {};
    const hasT0Jul = Object.values(det2).some(cd => cd.ev.some(ev => ev.t0 && ev.m === "202507"));
    if (!hasT0Jul) return false;
  }
  const det = DATA.det[fc] || {};
  return Object.values(det).some(cd =>
    cd.pdv === pdv && cd.ev.some(ev => evPassesFilters(ev, cd.tipo))
  );
}

function renderClientAccordion() {
  const fcs    = DATA.n_fcs[selectedPdv] || [];
  const hasFilters = naturaFilter.size > 0 || foniaFilter.size > 0 ||
                     compensoFilter.size > 0 || attivazioneFilter.size > 0 || dataFilter || t0JulFilter;

  const filtered = fcs.filter(fc => {
    const c = DATA.cmap[fc];
    if (!c) return false;
    if (clientSearchQ && !c.nome.toLowerCase().includes(clientSearchQ) &&
                         !c.fc.toLowerCase().includes(clientSearchQ)) return false;
    if (hasFilters && !clientPassesFilters(fc, selectedPdv)) return false;
    return true;
  });

  const infoBase = hasFilters
    ? `${filtered.length} su ${fcs.length} clienti (filtri attivi)`
    : `${fcs.length} clienti nel portafoglio`;
  document.getElementById('search-info').textContent =
    clientSearchQ ? `${filtered.length} su ${fcs.length} clienti` : infoBase;

  const cont = document.getElementById('client-accordion');
  if (!filtered.length) {
    cont.innerHTML = '<div style="padding:24px;text-align:center;color:#475569;font-size:12px">Nessun cliente trovato.</div>';
    return;
  }

  cont.innerHTML = filtered.map(fc => renderAccordionItem(fc)).join('');

  cont.querySelectorAll('.acc-head').forEach(head => {
    head.addEventListener('click', () => {
      const fc = head.dataset.fc;
      if (expandedFcs.has(fc)) expandedFcs.delete(fc);
      else expandedFcs.add(fc);
      // re-render just this item
      const row = head.closest('.acc-row');
      const c   = DATA.cmap[fc];
      if (c) row.outerHTML = renderAccordionItem(fc);
      // re-attach listeners for this item only
      const newRow = cont.querySelector(`.acc-row[data-fc="${fc}"]`);
      if (newRow) {
        newRow.querySelector('.acc-head').addEventListener('click', () => {
          const fc2 = fc;
          if (expandedFcs.has(fc2)) expandedFcs.delete(fc2); else expandedFcs.add(fc2);
          const row2 = cont.querySelector(`.acc-row[data-fc="${fc2}"]`);
          if (row2) row2.outerHTML = renderAccordionItem(fc2);
          cont.querySelectorAll('.acc-head').forEach(h2 => {
            h2.addEventListener('click', accHeadClick);
          });
          attachTooltips();
        });
        attachTooltips();
      }
    });
  });
  attachTooltips();
}

function accHeadClick(e) {
  const head = e.currentTarget;
  const fc   = head.dataset.fc;
  const cont = document.getElementById('client-accordion');
  if (expandedFcs.has(fc)) expandedFcs.delete(fc); else expandedFcs.add(fc);
  const row = cont.querySelector(`.acc-row[data-fc="${fc}"]`);
  if (row) {
    row.outerHTML = renderAccordionItem(fc);
    cont.querySelectorAll('.acc-head').forEach(h => h.addEventListener('click', accHeadClick));
    attachTooltips();
  }
}

function renderAccordionItem(fc) {
  const c       = DATA.cmap[fc];
  const det     = DATA.det[fc] || {};
  const isOpen  = expandedFcs.has(fc);
  if (!c) return '';

  const badges = Object.entries(c.p).map(([t,n]) =>
    `<span class="badge" style="background:${PC[t]||PC.ALTRO}">${PI[t]||'?'} ${n}</span>`
  ).join('');
  const ncTxt = c.nc===1?'1 contratto':`${c.nc} contratti`;
  const nmTxt = c.nm===1?'1 mese':`${c.nm} mesi`;
  const t0Txt = c.t0 ? ` · T0: ${ML[c.t0]||c.t0}` : '';
  const fcD   = c.fc.length>16 ? c.fc.slice(0,14)+'...' : c.fc;
  const isProprio = !c.pdvp || c.pdvp==='N/D' || c.pdvp===selectedPdv;
  const pdvpTag = isProprio ? '' :
    `<span class="acc-pdvp-tag" title="Negozio principale: ${c.pdvp}">&#8599; ${c.pdvp}</span>`;

  const bodyHtml = isOpen ? `<div class="acc-body">
    ${renderSummaryBand(det)}
    ${renderContractTable(det, selectedPdv)}
    ${renderClientFooter(c, det)}
  </div>` : '';

  return `<div class="acc-row" data-fc="${fc}">
  <div class="acc-head${isOpen?' open':''}" data-fc="${fc}">
    <span class="acc-arrow">&#9658;</span>
    <span class="acc-name" title="${c.nome}">${c.nome}</span>
    <span class="acc-fc" title="${c.fc}">${fcD}</span>
    ${pdvpTag}
    <span class="acc-meta">${ncTxt} · ${nmTxt}${t0Txt}</span>
    <div class="acc-badges">${badges}</div>
  </div>
  ${bodyHtml}
</div>`;
}

/* ── SUMMARY BAND (asse temporale) ───────────── */
function renderSummaryBand(det) {
  if (!MESI.length) return '';
  const tStart = new Date(TL_MSTART[MESI[0]]||'2026-01-01').getTime();
  const lastM  = MESI[MESI.length-1];
  const tEnd   = new Date(TL_MSTART[lastM]||'2026-04-01').getTime() + ((TL_MDAYS[lastM]||30)-1)*86400000;
  const tRange = tEnd - tStart || 1;

  function toPos(s) {
    if (!s) return null;
    const t = new Date(s).getTime();
    if (isNaN(t)) return null;
    const p = (t-tStart)/tRange*100;
    return p<0||p>101 ? null : Math.min(99.5,Math.max(0.5,p));
  }

  const evs = [];
  for (const [cc,cd] of Object.entries(det)) {
    for (const ev of cd.ev) {
      if (!evPassesFilters(ev, cd.tipo)) continue;
      const useAttiv = (cd.tipo==='FISSO' || cd.tipo==='ENERGIA');
      const pos = useAttiv ? (toPos(ev.da) ?? toPos(ev.d)) : (toPos(ev.d) ?? toPos(ev.da));
      if (pos!==null) evs.push({...ev,cc,tipo:cd.tipo,pdv:cd.pdv,_pos:pos});
    }
  }
  evs.sort((a,b)=>a._pos-b._pos);
  const VTOPS=[18,50,82]; let lastPos=-999,lane=0;
  for (const ev of evs) {
    if (Math.abs(ev._pos-lastPos)<1.8) lane=(lane+1)%3; else lane=1;
    ev._lane=lane; lastPos=ev._pos;
  }

  const dotsHtml = evs.map(ev=>{
    const col = ev.st?'#ef4444':(PC[ev.tipo]||PC.ALTRO);
    const cls = 'sv-dot'+(ev.t0?' t0':'')+(ev.st?' storno':'');
    const enc = encodeURIComponent(JSON.stringify(ev));
    return `<div class="${cls}" style="left:${ev._pos.toFixed(2)}%;top:${VTOPS[ev._lane]}%;background:${col}" data-ev="${enc}"></div>`;
  }).join('');

  const segsHtml = MESI.map(m=>{
    const ms  = new Date(TL_MSTART[m]||'2026-01-01').getTime();
    const pct = ((ms-tStart)/tRange*100).toFixed(2);
    const w   = ((TL_MDAYS[m]||30)*86400000/tRange*100).toFixed(2);
    return `<div class="sv-mseg" style="left:${pct}%;width:${w}%"><span>${ML[m]||m}</span></div>`;
  }).join('');

  const nEv = evs.length;
  return `<div class="sv-section">
  <div class="sv-label">Panoramica &mdash; ${nEv} event${nEv===1?'o':'i'} sull\'asse temporale</div>
  <div class="sv-track"><div class="sv-dots-layer">${dotsHtml}</div></div>
  <div class="sv-months"><div class="sv-months-rel">${segsHtml}</div></div>
</div>`;
}

/* ── CONTRACT TABLE ──────────────────────────── */
function renderContractTable(det, currentPdv) {
  const hdrCols = MESI.map(m =>
    `<td class="m-cell" style="text-align:center">${ML[m]||m}</td>`
  ).join('');

  const rows = Object.entries(det).map(([cc,cd]) => {
    const col     = PC[cd.tipo]||PC.ALTRO;
    const ccS     = cc.length>16 ? cc.slice(0,14)+'...' : cc;
    const isOther = currentPdv && cd.pdv && cd.pdv!==currentPdv && cd.pdv!=='N/D';
    const otherTag = isOther
      ? `<div class="other-pdv-tag">&#8599; ${cd.pdv}</div>` : '';

    const cells = MESI.map(m => {
      const evs = cd.ev.filter(e => e.m===m && evPassesFilters(e, cd.tipo));
      if (!evs.length)
        return `<td class="m-cell"><div class="tl-track"><div class="tl-bar-bg"></div><div class="m-empty"></div></div></td>`;
      const dots = evs.map(ev => {
        const dCol = ev.st?'#ef4444':col;
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
      <td class="lbl-cell${isOther?' lbl-other':''}">
        <span class="tl-tipo-badge" style="background:${col}">${PI[cd.tipo]||'?'} ${cd.tipo}</span>
        <div class="tl-cc" title="${cc}">${ccS}</div>
        ${otherTag}
        ${cd.pos?`<div class="tl-pdv-small" style="color:#2d3748">POS: ${cd.pos}</div>`:''}
      </td>${cells}
    </tr>`;
  }).join('');

  return `<div class="tl-wrap"><table class="tl-table">
  <tr class="tl-hdr">
    <td class="lbl-cell" style="font-size:10px;color:#374151;padding-left:14px">Contratto</td>
    ${hdrCols}
  </tr>${rows}
</table></div>`;
}

function renderClientFooter(c, det) {
  const impPerTipo = {};
  let nContr = 0, nEv = 0, totImp = 0;

  for (const [cc, cd] of Object.entries(det)) {
    const visEvs = cd.ev.filter(ev => evPassesFilters(ev, cd.tipo));
    if (visEvs.length > 0) {
      nContr++;
      nEv    += visEvs.length;
      const imp = visEvs.reduce((s,e) => s + (e.i||0), 0);
      totImp += imp;
      if (!impPerTipo[cd.tipo]) impPerTipo[cd.tipo] = 0;
      impPerTipo[cd.tipo] += imp;
    }
  }

  const fmt = v => 'EUR ' + v.toLocaleString('it-IT',{minimumFractionDigits:2,maximumFractionDigits:2});

  const tipiHtml = Object.entries(impPerTipo)
    .sort((a,b) => b[1]-a[1])
    .map(([tipo,imp]) =>
      `<span class="fi-tipo" style="border-color:${PC[tipo]||PC.ALTRO}22">
        <span class="fi-dot" style="background:${PC[tipo]||PC.ALTRO}"></span>
        <span style="color:${PC[tipo]||PC.ALTRO};font-weight:700">${tipo}</span>
        <span style="color:#e2e8f0;font-weight:700">${fmt(imp)}</span>
      </span>`
    ).join('');

  const mesiStr = c.mesi.map(m=>ML[m]||m).join(' > ');
  return `<div class="acc-footer">
    <div class="sum-item">Contratti: <strong>${nContr}</strong></div>
    <div class="sum-item">Eventi: <strong>${nEv}</strong></div>
    <div class="sum-item">Importo totale: <strong>${fmt(totImp)}</strong></div>
    <div class="sum-item">Percorso: <strong>${mesiStr}</strong></div>
    ${tipiHtml ? `<div class="fi-breakdown">${tipiHtml}</div>` : ''}
  </div>`;
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
  const col = PC[ev.tipo]||PC.ALTRO;
  let h = `<div class="tt-title" style="color:${col}">${ev.e||'Evento'}</div>`;
  if (ev.tipo&&ev.tipo!=='ALTRO') h += `<div class="tt-r"><strong>Tipo Fonia:</strong> <span style="color:${col};font-weight:600">${ev.tipo}</span></div>`;
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
  if (ev.mnp&&ev.mnp!=='nan') h += `<div class="tt-r"><strong>Portabilita:</strong> ${ev.mnp}</div>`;
  if (ev.pdv&&ev.pdv!=='N/D') h += `<div class="tt-r"><strong>Negozio:</strong> ${ev.pdv}</div>`;
  h += `<div class="tt-r"><strong>Importo:</strong> EUR ${(ev.i||0).toLocaleString('it-IT',{minimumFractionDigits:2,maximumFractionDigits:2})}</div>`;
  if (ev.t0) h += `<div class="tt-t0">Prima attivazione MOBILE (T0)</div>`;
  if (ev.st) h += `<div class="tt-storno">Storno / Addebito Negativo</div>`;
  ttEl.innerHTML = h;
  ttEl.style.display = 'block';
  positionTT(e);
}

function positionTT(e) {
  const vw=window.innerWidth, vh=window.innerHeight;
  const tw=ttEl.offsetWidth, th=ttEl.offsetHeight;
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


if __name__ == "__main__":
    print("=== Portafoglio Negozio — Generatore ===")
    print(f"Cartella: {CARTELLA}\n")

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
    print(f"Dimensione: {size_mb:.1f} MB")
    print(f"Negozi: {len(data['negozi'])}")
    print(f"Clienti: {len(data['clienti']):,}")
    print("\nFatto. Apri portafoglio_negozio.html nel browser.")
