// Test puri per il brand gating dei moduli (Task #279).
// shared/modules.ts: isWindtreBrandName, isModuleAllowedForBrands.
// Nessun prerequisito (né app né DB). Loader tsx.
import test from "node:test";
import assert from "node:assert/strict";
import {
  isWindtreBrandName,
  isModuleAllowedForBrands,
  WINDTRE_GATED_MODULES,
} from "../shared/modules.ts";

test("isWindtreBrandName riconosce le varianti WindTre", () => {
  for (const n of ["WindTre", "windtre", "Wind Tre", "WIND3", "W3", "WindTre Business", "wind-tre"]) {
    assert.equal(isWindtreBrandName(n), true, n);
  }
});

test("isWindtreBrandName rifiuta altri brand", () => {
  for (const n of ["Vodafone", "TIM", "Iliad", "Fastweb", "Enel Energia", "Very Mobile"]) {
    assert.equal(isWindtreBrandName(n), false, n);
  }
});

test("moduli non gated sempre consentiti anche senza WindTre", () => {
  for (const key of [
    "amministrazione",
    "controllo_gestione",
    "mappatura_bisuite",
    "vendite_bisuite",
    "incentivazione_interna",
    "customer_journey",
  ]) {
    assert.equal(isModuleAllowedForBrands(["Vodafone"], key), true, key);
  }
});

test("fallback sicuro: nessun brand associato => nessun filtro", () => {
  for (const key of WINDTRE_GATED_MODULES) {
    assert.equal(isModuleAllowedForBrands([], key), true, key);
    assert.equal(isModuleAllowedForBrands(null, key), true, key);
    assert.equal(isModuleAllowedForBrands(undefined, key), true, key);
  }
});

test("org con brand ma senza WindTre => moduli WindTre bloccati", () => {
  for (const key of WINDTRE_GATED_MODULES) {
    assert.equal(isModuleAllowedForBrands(["Vodafone", "TIM"], key), false, key);
  }
});

test("org con WindTre (anche insieme ad altri) => moduli WindTre consentiti", () => {
  for (const key of WINDTRE_GATED_MODULES) {
    assert.equal(isModuleAllowedForBrands(["Vodafone", "WindTre"], key), true, key);
    assert.equal(isModuleAllowedForBrands(["wind tre"], key), true, key);
  }
});

test("lista moduli gated attesa", () => {
  assert.deepEqual(
    [...WINDTRE_GATED_MODULES].sort(),
    [
      "drms_commissioning",
      "gara_configurazione",
      "gara_dashboard",
      "simulatore",
      "tabelle_calcolo",
    ].sort(),
  );
});
