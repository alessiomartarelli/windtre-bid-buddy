/**
 * Soglie gara rimovibili (Task: blocchi/livelli rimovibili per RS).
 *
 * Modello di persistenza retro-compatibile:
 * - un blocco pista per Ragione Sociale NON viene mai cancellato dall'array
 *   salvato: viene contrassegnato con `rimosso: true`. Questo distingue in
 *   modo esplicito "rimosso intenzionalmente" da "mai inizializzato" e
 *   impedisce agli initializer di ricrearlo.
 * - i singoli livelli disattivati sono elencati per nome in `livelliRimossi`
 *   (Energia: 'S1'|'S2'|'S3' per i target e 'PS1'..'PS5' per le soglie pista;
 *   Assicurazioni: 'S1'|'S2').
 *
 * Semantica di calcolo: un livello rimosso viene neutralizzato portando il
 * suo target a Infinity, così i calcolatori esistenti non lo raggiungono mai
 * e non serve alcun fallback ai default (che lo farebbero risorgere).
 */

export interface BloccoRimovibile {
  rimosso?: boolean;
  livelliRimossi?: string[];
}

export const LIVELLI_ENERGIA_TARGET = ['S1', 'S2', 'S3'] as const;
export const LIVELLI_ENERGIA_PISTA = ['PS1', 'PS2', 'PS3', 'PS4', 'PS5'] as const;
export const LIVELLI_ASSICURAZIONI = ['S1', 'S2'] as const;

export function isBloccoRimosso(conf: BloccoRimovibile | null | undefined): boolean {
  return !!conf?.rimosso;
}

export function isLivelloRimosso(conf: BloccoRimovibile | null | undefined, livello: string): boolean {
  return !!conf?.livelliRimossi?.includes(livello);
}

/** Aggiunge/toglie un livello dall'elenco dei rimossi, senza duplicati. */
export function toggleLivelloRimosso(livelliRimossi: string[] | undefined, livello: string): string[] {
  const set = new Set(livelliRimossi ?? []);
  if (set.has(livello)) set.delete(livello);
  else set.add(livello);
  return Array.from(set);
}

interface EnergiaLikeConfig extends BloccoRimovibile {
  targetS1: number;
  targetS2: number;
  targetS3: number;
  pistaSoglia_S1?: number;
  pistaSoglia_S2?: number;
  pistaSoglia_S3?: number;
  pistaSoglia_S4?: number;
  pistaSoglia_S5?: number;
}

/**
 * Restituisce una copia della config Energia con i livelli rimossi
 * neutralizzati (target => Infinity, soglia pista => Infinity). Le soglie
 * pista a Infinity restano truthy, quindi il fallback `|| default` di
 * getSoglieFromConfig non le ripristina.
 */
export function neutralizzaLivelliEnergia<T extends EnergiaLikeConfig>(conf: T): T {
  const out = { ...conf };
  if (isLivelloRimosso(conf, 'S1')) out.targetS1 = Number.POSITIVE_INFINITY;
  if (isLivelloRimosso(conf, 'S2')) out.targetS2 = Number.POSITIVE_INFINITY;
  if (isLivelloRimosso(conf, 'S3')) out.targetS3 = Number.POSITIVE_INFINITY;
  if (isLivelloRimosso(conf, 'PS1')) out.pistaSoglia_S1 = Number.POSITIVE_INFINITY;
  if (isLivelloRimosso(conf, 'PS2')) out.pistaSoglia_S2 = Number.POSITIVE_INFINITY;
  if (isLivelloRimosso(conf, 'PS3')) out.pistaSoglia_S3 = Number.POSITIVE_INFINITY;
  if (isLivelloRimosso(conf, 'PS4')) out.pistaSoglia_S4 = Number.POSITIVE_INFINITY;
  if (isLivelloRimosso(conf, 'PS5')) out.pistaSoglia_S5 = Number.POSITIVE_INFINITY;
  return out;
}

interface AssicurazioniLikeConfig extends BloccoRimovibile {
  targetS1: number;
  targetS2: number;
}

/** Come sopra, per i due livelli Assicurazioni. */
export function neutralizzaLivelliAssicurazioni<T extends AssicurazioniLikeConfig>(conf: T): T {
  const out = { ...conf };
  if (isLivelloRimosso(conf, 'S1')) out.targetS1 = Number.POSITIVE_INFINITY;
  if (isLivelloRimosso(conf, 'S2')) out.targetS2 = Number.POSITIVE_INFINITY;
  return out;
}
