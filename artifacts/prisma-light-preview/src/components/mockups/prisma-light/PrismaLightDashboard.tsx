import { useState } from "react";
import {
  BarChart3,
  Check,
  Database,
  LayoutGrid,
  Search,
  Settings,
  ShoppingBag,
  Smartphone,
  Store,
  Sun,
  UserRound,
  Waves,
  Wrench,
  X,
} from "lucide-react";
import { dashboardSnapshot as data } from "./dashboardSnapshot";
import "./_group.css";
import "./_real-data.css";

const themes = ["Prisma Light", "Chiaro", "Scuro", "Sistema"];
const euro = new Intl.NumberFormat("it-IT", {
  style: "currency",
  currency: "EUR",
});
const integer = new Intl.NumberFormat("it-IT");
const shortEuro = new Intl.NumberFormat("it-IT", {
  style: "currency",
  currency: "EUR",
  notation: "compact",
  maximumFractionDigits: 1,
});
const date = new Intl.DateTimeFormat("it-IT", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

export function PrismaLightDashboard() {
  const [themeOpen, setThemeOpen] = useState(false);
  const [theme, setTheme] = useState("Prisma Light");
  const [toast, setToast] = useState(false);

  const recentDays = data.daily.slice(-7);
  const recentGross = recentDays.reduce((sum, day) => sum + day.gross, 0);
  const maxDaily = Math.max(...recentDays.map((day) => day.gross));
  const maxPista = Math.max(...data.piste.map((pista) => pista.eventi));
  const topStore = data.stores[0];
  const topAccessori = [...data.stores].sort((a, b) => b.accessori - a.accessori)[0];
  const topServizi = [...data.stores].sort((a, b) => b.servizi - a.servizi)[0];

  return (
    <main className="pl-root">
      <section className="pl-shell">
        <header className="pl-top">
          <div className="pl-brand">
            <span className="pl-mark"><Waves /></span>
            MyStoreDesk
          </div>
          <span className="pl-crumb">Gara Reale / {data.period.label}</span>
          <div className="pl-actions">
            <button className="pl-icon" aria-label="Cerca"><Search /></button>
            <button
              className="pl-icon"
              aria-label="Scegli aspetto"
              onClick={() => setThemeOpen((value) => !value)}
            >
              <Sun />
            </button>
            <div className="pl-avatar" aria-label="Profilo utente">
              <UserRound size={16} />
            </div>
          </div>
        </header>

        {themeOpen && (
          <div className="pl-theme" role="dialog" aria-label="Preferenza visuale">
            <h3>Preferenza visuale</h3>
            {themes.map((item, index) => (
              <button
                key={item}
                className="pl-theme-option"
                onClick={() => setTheme(item)}
              >
                <span
                  className="pl-swatch"
                  style={
                    index === 1
                      ? { background: "#eff2ee" }
                      : index === 2
                        ? { background: "#20283a" }
                        : index === 3
                          ? { background: "linear-gradient(135deg,#eff2ee 50%,#20283a 50%)" }
                          : undefined
                  }
                />
                {item}
                {theme === item && <b><Check size={14} /></b>}
              </button>
            ))}
            <button
              className="pl-icon"
              style={{ position: "absolute", right: 8, top: 8, width: 25, height: 25 }}
              aria-label="Chiudi"
              onClick={() => setThemeOpen(false)}
            >
              <X size={13} />
            </button>
          </div>
        )}

        <div className="pl-layout">
          <nav className="pl-side" aria-label="Navigazione">
            <button className="pl-nav active" aria-label="Dashboard"><LayoutGrid /></button>
            <button className="pl-nav" aria-label="Vendite"><ShoppingBag /></button>
            <button className="pl-nav" aria-label="Punti vendita"><Store /></button>
            <button className="pl-nav pl-hide-mobile" aria-label="Report"><BarChart3 /></button>
            <span className="pl-side-spacer" />
            <button className="pl-nav pl-hide-mobile" aria-label="Impostazioni"><Settings /></button>
          </nav>

          <section className="pl-content">
            <div className="pl-hero">
              <div>
                <div className="pl-eyebrow">
                  Dati aggiornati al {date.format(new Date(data.period.latestSale))}
                </div>
                <h1>Gara Reale, <em>in sintesi.</em></h1>
              </div>
              <div className="pl-filters">
                <button className="pl-period">{data.source.organization} <span>⌄</span></button>
                <button className="pl-period">{data.period.label} <span>⌄</span></button>
              </div>
            </div>

            <div className="pl-grid">
              <article className="pl-pane pl-balance">
                <div className="pl-tiny">Vendite lorde in gara</div>
                <div className="pl-amount">{euro.format(data.summary.gross)}</div>
                <div className="pl-muted">
                  {integer.format(data.summary.sales)} vendite · {data.summary.stores} PDV configurati
                </div>
                <span className="pl-source">
                  <span className="pl-source-dot" />
                  Snapshot DB · nessun dato inventato
                </span>
              </article>

              <div className="pl-minis pl-minis-three">
                <article className="pl-pane pl-mini">
                  <div className="pl-tiny">Telefoni</div>
                  <strong>{integer.format(data.kpis.telefoni)}</strong>
                  <span className="pl-kpi-caption">pezzi rilevati</span>
                </article>
                <article className="pl-pane pl-mini">
                  <div className="pl-tiny">Accessori</div>
                  <strong>{euro.format(data.kpis.accessori)}</strong>
                  <span className="pl-kpi-caption">imponibile</span>
                </article>
                <article className="pl-pane pl-mini">
                  <div className="pl-tiny">Servizi</div>
                  <strong>{euro.format(data.kpis.servizi)}</strong>
                  <span className="pl-kpi-caption">imponibile</span>
                </article>
              </div>

              <article className="pl-pane pl-activity">
                <div className="pl-head">
                  <h2>Ultimi 7 giorni</h2>
                  <span className="pl-select">vendite lorde</span>
                </div>
                <div className="pl-big">{shortEuro.format(recentGross)}</div>
                <div className="pl-chart">
                  {recentDays.map((day) => (
                    <i
                      key={day.date}
                      className={`pl-bar ${day.gross === maxDaily ? "active" : ""}`}
                      style={{ height: `${Math.max(18, (day.gross / maxDaily) * 100)}%` }}
                      title={`${day.date}: ${euro.format(day.gross)}`}
                    />
                  ))}
                </div>
                <div className="pl-days">
                  {recentDays.map((day) => <span key={day.date}>{day.date.slice(-2)}</span>)}
                </div>
              </article>

              <article className="pl-pane pl-comp">
                <div className="pl-comp-top">
                  <div>
                    <div className="pl-tiny">Categorie mappate sulle piste</div>
                    <h2>Eventi rilevati ad agosto</h2>
                    <p>{data.source.mapping}.</p>
                  </div>
                  <div className="pl-score">{integer.format(data.piste.length)}<br />piste attive</div>
                </div>
                <div className="pl-pista-stack">
                  {data.piste.map((pista) => (
                    <div className="pl-pista-real" key={pista.nome}>
                      <span className="pl-pista-name">{pista.nome}</span>
                      <span className="pl-pista-meter">
                        <i style={{ width: `${Math.max(4, (pista.eventi / maxPista) * 100)}%` }} />
                      </span>
                      <span className="pl-pista-value">{integer.format(pista.eventi)} eventi</span>
                    </div>
                  ))}
                </div>
              </article>

              <aside className="pl-right">
                <article className="pl-pane pl-store">
                  <div className="pl-tiny">PDV con più vendite lorde</div>
                  <h2>{topStore.nome}</h2>
                  <div className="pl-muted">POS {topStore.codicePos}</div>
                  <div className="pl-store-facts">
                    <div><span>Vendite</span><b>{integer.format(topStore.sales)}</b></div>
                    <div><span>Lordo</span><b>{shortEuro.format(topStore.gross)}</b></div>
                    <div><span>Telefoni</span><b>{integer.format(topStore.telefoni)}</b></div>
                  </div>
                </article>
                <article className="pl-pane pl-priority">
                  <h2>Dove si concentra il valore</h2>
                  <div className="pl-priority-item">
                    <div className="pl-orb"><Smartphone size={16} /></div>
                    <div>
                      <b>Accessori · {topAccessori.nome}</b>
                      <span>Valore imponibile nel periodo</span>
                    </div>
                    <em>{shortEuro.format(topAccessori.accessori)}</em>
                  </div>
                  <div className="pl-priority-item">
                    <div className="pl-orb aqua"><Wrench size={16} /></div>
                    <div>
                      <b>Servizi · {topServizi.nome}</b>
                      <span>Valore imponibile nel periodo</span>
                    </div>
                    <em>{shortEuro.format(topServizi.servizi)}</em>
                  </div>
                </article>
              </aside>
            </div>

            <div className="pl-bottom">
              <article className="pl-pane pl-list">
                <div className="pl-head">
                  <h2>Classifica PDV</h2>
                  <span className="pl-select">per vendite lorde</span>
                </div>
                {data.stores.slice(0, 5).map((storeItem, index) => (
                  <div className="pl-list-row" key={storeItem.codicePos}>
                    <span className="pl-rank">0{index + 1}</span>
                    <span className="pl-company">{storeItem.nome}</span>
                    <span className="pl-sub">POS {storeItem.codicePos}</span>
                    <strong>{euro.format(storeItem.gross)}</strong>
                  </div>
                ))}
              </article>
              <article className="pl-pane pl-award">
                <div className="pl-tiny">Provenienza verificabile</div>
                <h2>Stessa base dati della Gara Reale.</h2>
                <p>
                  La preview usa esclusivamente aggregati di vendite BiSuite non
                  annullate dei 12 PDV, filtrate sui rispettivi calendari di gara.
                </p>
                <button onClick={() => setToast(true)}>Mostra fonte dati</button>
                <div className="pl-db-note">
                  <Database size={13} />
                  {data.source.configuration} · {data.source.environment}
                </div>
              </article>
            </div>
          </section>
        </div>
      </section>

      {toast && (
        <div className="pl-toast" role="status">
          {data.source.filter}
          <button
            onClick={() => setToast(false)}
            aria-label="Chiudi notifica"
            style={{ background: "none", border: 0, color: "white", marginLeft: 8 }}
          >
            <X size={13} />
          </button>
        </div>
      )}
    </main>
  );
}