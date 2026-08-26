import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  getDefaultMappingRules,
  mapBiSuiteArticle,
  mergeWithDefaultRules,
} = await import('../shared/bisuiteMapping.ts');

function articoloMvno(categoria) {
  return {
    categoria: { nome: categoria },
    tipologia: { nome: categoria === 'TIED IVA' ? 'VOCE IVA' : 'RICARICABILE VOCE' },
    dettaglio: {
      domandeRisposte: [
        { domandaTesto: 'MNP DA OPERATORI VIRTUALI', risposta: 'SI' },
      ],
    },
  };
}

function mnpMvnoMappate(categoria, rules) {
  return mapBiSuiteArticle(articoloMvno(categoria), '', rules)
    .filter((item) => item.pista === 'mobile' && item.targetCategory === 'MNP_MVNO');
}

test('MNP MVNO assegna +1 solo alle offerte TIED CF e TIED IVA', () => {
  const rules = mergeWithDefaultRules(getDefaultMappingRules());

  assert.equal(mnpMvnoMappate('TIED CF', rules).length, 1);
  assert.equal(mnpMvnoMappate('TIED IVA', rules).length, 1);
  assert.equal(mnpMvnoMappate('UNTIED', rules).length, 0);
  assert.equal(mnpMvnoMappate('ALTRE GA', rules).length, 0);
});

test('mergeWithDefaultRules elimina la vecchia regola MNP MVNO su UNTIED', () => {
  const legacyUntiedRule = {
    id: 'legacy-mnp-mvno-untied',
    pista: 'mobile',
    targetCategory: 'MNP_MVNO',
    targetLabel: 'MNP da MVNO',
    conditions: {
      categoriaBiSuite: 'UNTIED',
      domandaTesto: 'MNP DA OPERATORI VIRTUALI',
      rispostaContiene: 'SI',
    },
    priority: 20,
    enabled: true,
    ruleType: 'additional',
  };

  const rules = mergeWithDefaultRules([legacyUntiedRule]);
  assert.equal(mnpMvnoMappate('UNTIED', rules).length, 0);
  assert.ok(!rules.some((rule) => rule.id === legacyUntiedRule.id));
});