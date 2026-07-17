#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Genera il report PDF "SOS Caring - KPI per Negozio" a partire da un file Excel.

Cosa fa:
  1. Legge il file Excel con i dati SOS Caring (una riga per punto vendita).
  2. Mappa il codice PDV (Cod_PdV_Panel) al nome/citta'/indirizzo del negozio.
  3. Mostra solo le colonne KPI "verdi".
  4. Raggruppa i negozi per Ragione Sociale con subtotali + totale rete.
  5. Calcola la colonna % Balance RS = MNP Out su Linee Allarmate / (GA Gara + CambiPiano TIED)
     sui valori AGGREGATI di ogni ragione sociale e sul totale (il "di cui" Micro NON entra).
  6. Impagina tutto su un'unica pagina A4 orizzontale e salva il PDF.

--------------------------------------------------------------------------------
SETUP SU REPLIT
--------------------------------------------------------------------------------
1) Aggiungi i pacchetti (Shell del Replit):
       pip install pandas openpyxl playwright
       python -m playwright install chromium
   (su Replit puo' servire anche:  python -m playwright install-deps  )

2) Carica il file Excel nel progetto e imposta INPUT_FILE qui sotto.

3) Avvia:  python genera_report_sos_caring.py
--------------------------------------------------------------------------------
"""

import math
import pathlib
import pandas as pd
from playwright.sync_api import sync_playwright

# ==============================================================================
# CONFIGURAZIONE  <-- modifica qui
# ==============================================================================
INPUT_FILE   = "Cartel2__5_.xlsx"                          # file Excel di input
OUTPUT_FILE  = "SOS_Caring_KPI_per_Negozio.pdf"           # PDF di output
REPORT_DATE  = "16 Luglio 2026"                            # data mostrata in alto a destra
PERIOD_LABEL = "Periodo Luglio 2026 (202607)"              # sottotitolo periodo

# Ordine con cui mostrare le ragioni sociali (le altre eventuali vanno in coda).
GROUP_ORDER = ["C.M.S. SRL", "CMS EVOLUTION SRL"]

# ==============================================================================
# ANAGRAFICA NEGOZI (codice PDV -> negozio). Incorporata per rendere lo script
# autoconsistente: non serve caricare il file anagrafico su Replit.
# ==============================================================================
STORE_MASTER = {
    "9001401037": {"comune": "Jesi",          "indirizzo": "Viale Trieste 13/C",                              "prov": "AN", "ragione_sociale": "C.M.S. SRL"},
    "9001288594": {"comune": "Roma",          "indirizzo": "Via Alberto Lionello Cc Porta Di Roma Box 53",    "prov": "RM", "ragione_sociale": "C.M.S. SRL"},
    "9001409452": {"comune": "Pesaro",        "indirizzo": "Galleria Dei Fonditori 12/A Cc Miralfiore",       "prov": "PU", "ragione_sociale": "C.M.S. SRL"},
    "9001393090": {"comune": "San Cesareo",   "indirizzo": "Via Casilina 82/B Cc La Noce",                    "prov": "RM", "ragione_sociale": "C.M.S. SRL"},
    "9001046475": {"comune": "Fiumicino",     "indirizzo": "Via Giorgio Giorgis, 44/46",                      "prov": "RM", "ragione_sociale": "C.M.S. SRL"},
    "9001426892": {"comune": "Roma",          "indirizzo": "Via P.Togliatti 2 Cc Cinecitta' 2 Box 55",        "prov": "RM", "ragione_sociale": "C.M.S. SRL"},
    "9001412252": {"comune": "Civitavecchia", "indirizzo": "L.Go Cavour 11/12",                               "prov": "RM", "ragione_sociale": "C.M.S. SRL"},
    "9001402980": {"comune": "Roma",          "indirizzo": "Via Prenestina, 367B",                            "prov": "RM", "ragione_sociale": "C.M.S. SRL"},
    "9001060855": {"comune": "Fiumicino",     "indirizzo": "Viale Bramante Snc Cc Parco Leonardo",            "prov": "RM", "ragione_sociale": "C.M.S. SRL"},
    "9001408227": {"comune": "Roma",          "indirizzo": "Via Tiburtina 568",                               "prov": "RM", "ragione_sociale": "C.M.S. SRL"},
    "9001290392": {"comune": "Pomezia",       "indirizzo": "Via Roma 115",                                    "prov": "RM", "ragione_sociale": "C.M.S. SRL"},
    "9001409453": {"comune": "Pesaro",        "indirizzo": "Via Giovanni Branca 110",                         "prov": "PU", "ragione_sociale": "C.M.S. SRL"},
    "9001408258": {"comune": "Roma",          "indirizzo": "Via Candia 72",                                   "prov": "RM", "ragione_sociale": "C.M.S. SRL"},
    "9001212651": {"comune": "Roma",          "indirizzo": "Via Tuscolana 1007 A",                            "prov": "RM", "ragione_sociale": "CMS EVOLUTION SRL"},
}

# ==============================================================================
# COLONNE KPI (verdi). "order" = ordine di visualizzazione; "labels" = intestazioni.
# ==============================================================================
INT_COLS = [  # colonne numeriche intere: si sommano nei subtotali/totale
    "AllarmiActual", "MNP_Out_su_LineeAllarmate", "MNP_Out_Micro_su_LineeAllarmate___Di_cui",
    "GA_Gara", "CambiPiano_TIED", "CambiPiano_TIED_Di_cui_Micro", "LeveMax", "Leve_SOS_Caring_Actual",
]
PCT_COLS = ["%_Balance_Actual", "%_Balance_Forecast"]  # percentuali gia' presenti nel file (non si sommano)

ORDER = [
    "AllarmiActual", "MNP_Out_su_LineeAllarmate", "MNP_Out_Micro_su_LineeAllarmate___Di_cui",
    "GA_Gara", "CambiPiano_TIED", "CambiPiano_TIED_Di_cui_Micro",
    "%_Balance_Actual", "%_Balance_Forecast", "%_Balance_RS",  # <-- colonna calcolata
    "LeveMax", "Leve_SOS_Caring_Actual",
]
LABELS = {
    "AllarmiActual": "Allarmi<br>Actual",
    "MNP_Out_su_LineeAllarmate": "MNP Out<br>su Linee All.",
    "MNP_Out_Micro_su_LineeAllarmate___Di_cui": "MNP Out Micro<br>(di cui)",
    "GA_Gara": "GA<br>Gara",
    "CambiPiano_TIED": "CambiPiano<br>TIED",
    "CambiPiano_TIED_Di_cui_Micro": "CP TIED Micro<br>(di cui)",
    "%_Balance_Actual": "% Balance<br>Actual",
    "%_Balance_Forecast": "% Balance<br>Forecast",
    "%_Balance_RS": "% Balance<br>RS",
    "LeveMax": "Leve<br>Max",
    "Leve_SOS_Caring_Actual": "Leve SOS<br>Caring Actual",
}


# ==============================================================================
# FUNZIONI DI CALCOLO
# ==============================================================================
def balance_rs(mnp, ga, cp):
    """% Balance a livello ragione sociale = MNP Out / (GA Gara + CambiPiano TIED).
    Il 'di cui' Micro NON entra nel denominatore (e' gia' incluso in CambiPiano TIED)."""
    den = (ga or 0) + (cp or 0)
    return (mnp / den) if den else None


def fmt_int(v):
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return "0"
    return f"{int(round(v)):,}".replace(",", ".")   # separatore migliaia "."


def fmt_pct(v):
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return "0,0%"
    return f"{v * 100:.1f}%".replace(".", ",")       # virgola decimale


def load_data(path):
    """Legge l'Excel e arricchisce ogni riga con i dati anagrafici del negozio."""
    df = pd.read_excel(path)
    def info(code):
        return STORE_MASTER.get(str(int(code)), {})
    df["_code"]    = df["Cod_PdV_Panel"].apply(lambda c: str(int(c)))
    df["_comune"]  = df["Cod_PdV_Panel"].apply(lambda c: info(c).get("comune", "?"))
    df["_ind"]     = df["Cod_PdV_Panel"].apply(lambda c: info(c).get("indirizzo", "?"))
    df["_prov"]    = df["Cod_PdV_Panel"].apply(lambda c: info(c).get("prov", "?"))
    # Ragione sociale: prima dall'anagrafica, altrimenti quella del file
    df["_rs"] = df.apply(
        lambda r: STORE_MASTER.get(r["_code"], {}).get("ragione_sociale",
                   r.get("RagioneSociale", "ALTRO")), axis=1)
    return df


# ==============================================================================
# COSTRUZIONE HTML
# ==============================================================================
def build_html(df):
    # ordine gruppi: prima quelli in GROUP_ORDER, poi eventuali altri presenti nel file
    present = list(dict.fromkeys(df["_rs"].tolist()))
    groups = [g for g in GROUP_ORDER if g in present] + [g for g in present if g not in GROUP_ORDER]

    grand = {c: 0 for c in INT_COLS}
    body = ""
    idx = 0
    for g in groups:
        gdf = df[df["_rs"] == g]
        sub = {c: 0 for c in INT_COLS}
        body += (f'<tr class="grp"><td colspan="2">{g} &nbsp;'
                 f'<span class="grpn">{len(gdf)} PDV</span></td>'
                 + "".join("<td></td>" for _ in ORDER) + "</tr>\n")
        for _, r in gdf.iterrows():
            idx += 1
            cells = ""
            for c in ORDER:
                if c == "%_Balance_RS":
                    v = balance_rs(r["MNP_Out_su_LineeAllarmate"], r["GA_Gara"], r["CambiPiano_TIED"])
                    cells += f'<td class="num pct rs">{fmt_pct(v)}</td>'
                elif c in PCT_COLS:
                    cells += f'<td class="num pct">{fmt_pct(r[c])}</td>'
                else:
                    val = 0 if (isinstance(r[c], float) and math.isnan(r[c])) else r[c]
                    sub[c] += val
                    grand[c] += val
                    cells += f'<td class="num">{fmt_int(r[c])}</td>'
            body += (f'<tr class="{"odd" if idx % 2 else "even"}">'
                     f'<td class="store"><span class="idx">{idx}</span>'
                     f'<span class="city">{r["_comune"]} <span class="prov">({r["_prov"]})</span></span>'
                     f'<span class="addr">{r["_ind"]} &middot; cod. {r["_code"]}</span></td>{cells}</tr>\n')
        # riga subtotale (calcolata sui valori aggregati del gruppo)
        subc = ""
        for c in ORDER:
            if c == "%_Balance_RS":
                v = balance_rs(sub["MNP_Out_su_LineeAllarmate"], sub["GA_Gara"], sub["CambiPiano_TIED"])
                subc += f'<td class="num rs">{fmt_pct(v)}</td>'
            elif c in PCT_COLS:
                subc += '<td class="num">&mdash;</td>'
            else:
                subc += f'<td class="num">{fmt_int(sub[c])}</td>'
        body += f'<tr class="subtot"><td>Subtotale {g}</td>{subc}</tr>\n'

    # riga totale rete
    gc = ""
    for c in ORDER:
        if c == "%_Balance_RS":
            v = balance_rs(grand["MNP_Out_su_LineeAllarmate"], grand["GA_Gara"], grand["CambiPiano_TIED"])
            gc += f'<td class="num rs">{fmt_pct(v)}</td>'
        elif c in PCT_COLS:
            gc += '<td class="num">&mdash;</td>'
        else:
            gc += f'<td class="num">{fmt_int(grand[c])}</td>'
    body += f'<tr class="totalrow"><td>Totale Rete ({len(df)} PDV)</td>{gc}</tr>\n'

    head = "".join(f'<th class="num{" rsh" if c == "%_Balance_RS" else ""}">{LABELS[c]}</th>' for c in ORDER)

    return f"""<!DOCTYPE html><html lang="it"><head><meta charset="utf-8"><style>
  @page {{ size:A4 landscape; margin:6mm 9mm 5mm 9mm; }}
  * {{ box-sizing:border-box; }}
  body {{ font-family:"Helvetica Neue",Arial,sans-serif; color:#1e293b; margin:0; font-size:9pt;
          -webkit-print-color-adjust:exact; print-color-adjust:exact; }}
  .header {{ display:flex; justify-content:space-between; align-items:flex-end;
             border-bottom:3px solid #16a34a; padding-bottom:6px; margin-bottom:7px; }}
  .header h1 {{ font-size:15pt; margin:0; color:#0f172a; letter-spacing:-0.3px; }}
  .header .sub {{ font-size:8.5pt; color:#64748b; margin-top:3px; }}
  .badge {{ text-align:right; font-size:8pt; color:#475569; }}
  .badge .date {{ font-size:10pt; font-weight:700; color:#16a34a; display:block; }}
  table {{ width:100%; border-collapse:collapse; table-layout:fixed; }}
  thead th {{ background:#14532d; color:#fff; font-size:7pt; font-weight:600; padding:4px 3px;
              text-align:right; vertical-align:bottom; line-height:1.15; }}
  thead th:first-child {{ text-align:left; width:18%; }}
  thead th.rsh {{ background:#166534; border-left:2px solid #4ade80; border-right:2px solid #4ade80; }}
  tbody td {{ padding:2px 3px; font-size:7.7pt; border-bottom:1px solid #eef2f7; }}
  tr.odd td {{ background:#f6faf7; }}
  td.num {{ text-align:right; font-variant-numeric:tabular-nums; font-weight:600; }}
  td.pct {{ color:#166534; }}
  td.rs {{ background:#ecfdf5; color:#15803d; font-weight:700;
           border-left:2px solid #86efac; border-right:2px solid #86efac; }}
  .store {{ display:block; line-height:1.25; }}
  .idx {{ color:#94a3b8; font-size:7pt; margin-right:5px; }}
  .city {{ font-weight:700; color:#0f172a; }}
  .prov {{ font-weight:400; color:#94a3b8; font-size:7pt; }}
  .addr {{ display:block; font-size:7pt; color:#64748b; margin-top:1px; }}
  tr.grp td {{ background:#dcfce7; color:#166534; font-weight:700; font-size:7.8pt;
               letter-spacing:0.3px; padding:3px 6px; border-bottom:1px solid #bbf7d0; text-transform:uppercase; }}
  tr.grp .grpn {{ color:#16a34a; font-weight:600; font-size:7pt; }}
  tr.subtot td {{ background:#fff; color:#475569; font-weight:700; font-size:7.5pt; padding:3px 3px;
                  border-top:1px solid #cbd5e1; border-bottom:2px solid #cbd5e1;
                  text-transform:uppercase; letter-spacing:0.2px; }}
  tr.subtot td.num {{ text-align:right; color:#334155; }}
  tr.subtot td.rs {{ background:#ecfdf5; color:#15803d; }}
  tr.totalrow td {{ padding:4px 3px; font-size:8.3pt; font-weight:700; border-top:2px solid #14532d;
                    background:#f0fdf4; text-transform:uppercase; letter-spacing:0.2px; }}
  tr.totalrow td.num {{ text-align:right; color:#15803d; }}
  tr.totalrow td.rs {{ background:#d1fae5; color:#166534; }}
  .fnote {{ margin-top:6px; font-size:7.3pt; color:#94a3b8; }}
  .fnote b {{ color:#166534; }}
</style></head><body>
  <div class="header">
    <div><h1>SOS Caring &mdash; KPI per Negozio</h1>
      <div class="sub">Rete WIND TRE &middot; Canale Franchising &middot; {PERIOD_LABEL} &middot; Suddivisione per Ragione Sociale</div>
    </div>
    <div class="badge">Dati aggiornati al<span class="date">{REPORT_DATE}</span>{len(df)} PDV</div>
  </div>
  <table><thead><tr><th>Punto Vendita</th>{head}</tr></thead>
  <tbody>{body}</tbody></table>
  <div class="fnote"><b>% Balance RS</b> = MNP Out su Linee Allarmate / (GA Gara + CambiPiano TIED),
     calcolata sui valori aggregati di ragione sociale e sul totale rete.</div>
</body></html>"""


def render_pdf(html, output_path):
    """Scrive un HTML temporaneo e lo converte in PDF con Playwright (Chromium headless)."""
    tmp = pathlib.Path("._report_tmp.html")
    tmp.write_text(html, encoding="utf-8")
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.goto(tmp.resolve().as_uri())
        page.pdf(path=output_path, landscape=True, format="A4", print_background=True,
                 margin={"top": "0", "bottom": "0", "left": "0", "right": "0"})
        browser.close()
    tmp.unlink(missing_ok=True)


def main():
    df = load_data(INPUT_FILE)

    # controllo codici non mappati (utile per capire subito se manca un negozio in anagrafica)
    unmapped = [c for c in df["_code"] if c not in STORE_MASTER]
    if unmapped:
        print("ATTENZIONE - codici PDV non presenti in STORE_MASTER:", unmapped)

    html = build_html(df)
    render_pdf(html, OUTPUT_FILE)
    print(f"OK - report generato: {OUTPUT_FILE}  ({len(df)} punti vendita)")


if __name__ == "__main__":
    main()
