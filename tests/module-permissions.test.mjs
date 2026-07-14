// Test puri per i permessi moduli per-utente (Task #311).
// shared/modules.ts: isModuleGrantedToUser, isModuleAccessible,
// sanitizeGrantableModules. Nessun prerequisito (né app né DB). Loader tsx.
import test from "node:test";
import assert from "node:assert/strict";
import {
  isModuleGrantedToUser,
  isModuleAccessible,
  sanitizeGrantableModules,
  WINDTRE_GATED_MODULES,
} from "../shared/modules.ts";

test("isModuleGrantedToUser: null/undefined => nessuna restrizione (tutto concesso)", () => {
  for (const key of ["customer_journey", "controllo_gestione", "drms_commissioning"]) {
    assert.equal(isModuleGrantedToUser(null, key), true, key);
    assert.equal(isModuleGrantedToUser(undefined, key), true, key);
  }
});

test("isModuleGrantedToUser: array = whitelist esplicita", () => {
  const granted = ["customer_journey", "vendite_bisuite"];
  assert.equal(isModuleGrantedToUser(granted, "customer_journey"), true);
  assert.equal(isModuleGrantedToUser(granted, "vendite_bisuite"), true);
  assert.equal(isModuleGrantedToUser(granted, "controllo_gestione"), false);
  assert.equal(isModuleGrantedToUser(granted, "drms_commissioning"), false);
});

test("isModuleGrantedToUser: array vuoto NON è 'nessuna restrizione' ma 'nessun modulo'", () => {
  for (const key of ["customer_journey", "controllo_gestione"]) {
    assert.equal(isModuleGrantedToUser([], key), false, key);
  }
});

test("isModuleAccessible: super_admin bypassa org, brand e restrizione utente", () => {
  assert.equal(
    isModuleAccessible({
      isSuperAdmin: true,
      enabledModules: { customer_journey: false },
      brandNames: ["Vodafone"],
      moduliConsentiti: [],
      key: "customer_journey",
    }),
    true,
  );
});

test("isModuleAccessible: intersezione org ∩ brand ∩ utente", () => {
  // Tutto ok: org abilita (record vuoto = abilitato), brand WindTre, utente concede.
  assert.equal(
    isModuleAccessible({
      enabledModules: {},
      brandNames: ["WindTre"],
      moduliConsentiti: ["customer_journey"],
      key: "customer_journey",
    }),
    true,
  );
  // Utente NON concede => bloccato anche se org+brand ok.
  assert.equal(
    isModuleAccessible({
      enabledModules: {},
      brandNames: ["WindTre"],
      moduliConsentiti: ["vendite_bisuite"],
      key: "customer_journey",
    }),
    false,
  );
  // Org disabilita => bloccato anche se utente concede.
  assert.equal(
    isModuleAccessible({
      enabledModules: { customer_journey: false },
      brandNames: ["WindTre"],
      moduliConsentiti: ["customer_journey"],
      key: "customer_journey",
    }),
    false,
  );
  // Brand non WindTre su modulo gated => bloccato anche se utente concede.
  assert.equal(
    isModuleAccessible({
      enabledModules: {},
      brandNames: ["Vodafone"],
      moduliConsentiti: ["gara_dashboard"],
      key: "gara_dashboard",
    }),
    false,
  );
  // Moduli BiSuite NON sono più brand-gated: ok anche con brand non WindTre.
  assert.equal(
    isModuleAccessible({
      enabledModules: {},
      brandNames: ["Vodafone"],
      moduliConsentiti: ["customer_journey"],
      key: "customer_journey",
    }),
    true,
  );
});

test("isModuleAccessible: retro-compat, utente senza restrizione eredita org∩brand", () => {
  assert.equal(
    isModuleAccessible({
      enabledModules: {},
      brandNames: ["WindTre"],
      moduliConsentiti: null,
      key: "customer_journey",
    }),
    true,
  );
});

test("sanitizeGrantableModules: scarta chiavi ignote e superOnly", () => {
  const out = sanitizeGrantableModules(
    ["customer_journey", "chiave_inventata", "mappatura_bisuite"],
    {},
    ["WindTre"],
  );
  assert.deepEqual(out, ["customer_journey"]);
});

test("sanitizeGrantableModules: scarta moduli disabilitati per l'org", () => {
  const out = sanitizeGrantableModules(
    ["customer_journey", "controllo_gestione"],
    { customer_journey: false },
    ["WindTre"],
  );
  assert.deepEqual(out, ["controllo_gestione"]);
});

test("sanitizeGrantableModules: scarta moduli WindTre-gated se il brand non è WindTre", () => {
  const out = sanitizeGrantableModules(
    ["gara_dashboard", "customer_journey", "controllo_gestione"],
    {},
    ["Vodafone"],
  );
  // gara_dashboard è WindTre-gated => scartato; customer_journey e
  // controllo_gestione non sono più gated.
  assert.ok(!out.includes("gara_dashboard"));
  assert.ok(out.includes("customer_journey"));
  assert.ok(out.includes("controllo_gestione"));
  for (const k of WINDTRE_GATED_MODULES) {
    assert.ok(!out.includes(k), `${k} non deve passare senza brand WindTre`);
  }
});

test("sanitizeGrantableModules: deduplica", () => {
  const out = sanitizeGrantableModules(
    ["controllo_gestione", "controllo_gestione"],
    {},
    [],
  );
  assert.deepEqual(out, ["controllo_gestione"]);
});
