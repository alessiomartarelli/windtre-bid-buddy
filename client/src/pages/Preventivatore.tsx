import { useState, useEffect, useRef, useMemo } from "react";
import { useLocation, useSearch } from "wouter";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfigGaraBase, PuntoVendita, PistaMobileConfig, PistaMobilePosConfig, MobileCategoryConfig, AttivatoMobileDettaglio, GaraConfigUpload, MOBILE_CATEGORIES_CONFIG_DEFAULT, PistaMobileRSConfig, PistaFissoRSConfig, PartnershipRewardRSConfig, ModalitaInserimentoRS } from "@/types/preventivatore";
import { createEmptyPdv, createDefaultPistaMobileConfig, getDefaultFissoThresholds, mapClusterFissoToNumber, generaPartnershipRSDefault, getDefaultSoglieMobileRS, getDefaultSoglieFissoRS, raggruppaPdvPerRS } from "@/utils/preventivatore-helpers";
import { calcolaPremioPistaMobilePerPos } from "@/utils/calcoli-mobile";
import { calcolaPremioPistaFissoPerPos, PistaFissoPosConfig, AttivatoFissoRiga } from "@/lib/calcoloPistaFisso";
import { getWorkdayInfoFromOverrides } from "@/utils/calendario";
import { StepLetteraGara } from "@/components/wizard/StepLetteraGara";
import { StepPuntiVendita } from "@/components/wizard/StepPuntiVendita";
import { StepCluster } from "@/components/wizard/StepCluster";
import { StepCalendari } from "@/components/wizard/StepCalendari";
import { StepCalendarioMese, CalendariMeseOverrides } from "@/components/wizard/StepCalendarioMese";
import { StepConfigPiste } from "@/components/wizard/StepConfigPiste";
import { StepConfigPisteRS } from "@/components/wizard/StepConfigPisteRS";
import { StepAttivatoMobile } from "@/components/wizard/StepAttivatoMobile";
import { StepAttivatoMobileRS } from "@/components/wizard/StepAttivatoMobileRS";
import { StepAttivatoFisso } from "@/components/wizard/StepAttivatoFisso";
import { StepAttivatoFissoRS } from "@/components/wizard/StepAttivatoFissoRS";
import { StepPartnershipReward } from "@/components/wizard/StepPartnershipReward";
import { StepPartnershipRewardRS } from "@/components/wizard/StepPartnershipRewardRS";
import { StepEnergia } from "@/components/wizard/StepEnergia";
import { StepEnergiaRS } from "@/components/wizard/StepEnergiaRS";
import { StepSceltaModalitaRS } from "@/components/wizard/StepSceltaModalitaRS";
import { usePreventivatoreStorage } from "@/hooks/use-preventivatore-storage";
import { useOrganizationConfig } from "@/hooks/useOrganizationConfig";
import { apiUrl } from "@/lib/basePath";
import { useTabelleCalcoloConfig } from "@/hooks/useTabelleCalcoloConfig";
import { usePreventivi } from "@/hooks/usePreventivi";
import { useToast } from "@/hooks/use-toast";
import { PartnershipRewardPosConfig, getDefaultTarget100, calculateTarget80, calculatePremio80 } from "@/types/partnership-reward";
import { AttivatoCBDettaglio } from "@/types/partnership-cb-events";
import { calcolaPartnershipRewardPerPos } from "@/lib/calcoloPartnershipReward";
import { EnergiaConfig, EnergiaAttivatoRiga, EnergiaPdvInGara, calcolaBonusPistaEnergia as calcolaBonusPistaEnergiaFn } from "@/types/energia";
import { calcoloEnergiaPerPos } from "@/lib/calcoloEnergia";
import { AssicurazioniConfig, AssicurazioniAttivatoRiga, AssicurazioniPdvInGara, createEmptyAssicurazioniAttivato, ASSICURAZIONI_POINTS } from "@/types/assicurazioni";
import { calcoloAssicurazioniPerPos } from "@/lib/calcoloAssicurazioni";
import StepAssicurazioni from "@/components/wizard/StepAssicurazioni";
import { StepAssicurazioniRS } from "@/components/wizard/StepAssicurazioniRS";
import { ProtectaAttivatoRiga, createEmptyProtectaAttivato } from "@/types/protecta";
import { calcolaProtecta, calcolaTotaleProtecta } from "@/lib/calcoloProtecta";
import StepProtecta from "@/components/wizard/StepProtecta";
import { StepProtectaRS } from "@/components/wizard/StepProtectaRS";
import { calcolaExtraGaraIva, calcolaTotaleExtraGaraIva, ExtraGaraSogliePerRS } from "@/lib/calcoloExtraGaraIva";
import StepExtraGaraIva from "@/components/wizard/StepExtraGaraIva";
import { UserMenu } from "@/components/UserMenu";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Save, ChevronLeft, ChevronRight, RefreshCw, Home, FolderOpen, Trash2, Clock, FilePlus, ArrowLeft } from "lucide-react";
import { WizardHeader } from "@/components/wizard/WizardHeader";
import { WizardSummaryCard } from "@/components/wizard/WizardSummaryCard";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// TOTAL_STEPS è dinamico: 14 per gara_operatore_rs (include step selezione modalità), 13 altrimenti
const getTotalSteps = (tipologiaGara: string) => tipologiaGara === "gara_operatore_rs" ? 14 : 13;

let _preventivatoreInitialized = false;

const Preventivatore = () => {
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  const searchParams = new URLSearchParams(searchString);
  const { saveState, loadState, clearState, saveTemplate, loadTemplate, saveConfig, loadConfig } = usePreventivatoreStorage();
  const { loadRemoteConfig, saveRemoteConfigDebounced, saveRemoteConfigNow } = useOrganizationConfig();
  const { createPreventivo, updatePreventivo, loadPreventivo } = usePreventivi();
  const { toast } = useToast();
  const { config: tabelleCalcoloConfig } = useTabelleCalcoloConfig();
  
  const [step, setStep] = useState(0);
  const [configGara, setConfigGara] = useState<ConfigGaraBase>({ nomeGara: "", haLetteraUfficiale: false, annoGara: new Date().getFullYear(), meseGara: new Date().getMonth() + 1, tipoPeriodo: "mensile", tipologiaGara: "gara_operatore" });
  const [numeroPdv, setNumeroPdv] = useState<number>(0);
  const [ragioniSociali, setRagioniSociali] = useState<string[]>([]);
  const [puntiVendita, setPuntiVendita] = useState<PuntoVendita[]>([]);
  const [pistaMobileConfig, setPistaMobileConfig] = useState<PistaMobileConfig>({ sogliePerPos: [], applicaDecurtazione30SeNoFissoO8Piva: true });
  const [pistaFissoConfig, setPistaFissoConfig] = useState<{ sogliePerPos: PistaFissoPosConfig[] }>({ sogliePerPos: [] });
  const [partnershipRewardConfig, setPartnershipRewardConfig] = useState<{ configPerPos: PartnershipRewardPosConfig[] }>({ configPerPos: [] });
  const [mobileCategories, setMobileCategories] = useState<MobileCategoryConfig[]>(MOBILE_CATEGORIES_CONFIG_DEFAULT);
  
  // Configurazioni per Gara Operatore RS
  const [pistaMobileRSConfig, setPistaMobileRSConfig] = useState<PistaMobileRSConfig>({ sogliePerRS: [], applicaDecurtazione30SeNoFissoO8Piva: true });
  const [pistaFissoRSConfig, setPistaFissoRSConfig] = useState<PistaFissoRSConfig>({ sogliePerRS: [] });
  const [partnershipRewardRSConfig, setPartnershipRewardRSConfig] = useState<PartnershipRewardRSConfig>({ configPerRS: [] });
  const [modalitaInserimentoRS, setModalitaInserimentoRS] = useState<ModalitaInserimentoRS>(null);
  const [attivatoMobileByPos, setAttivatoMobileByPos] = useState<Record<string, AttivatoMobileDettaglio[]>>({});
  const [attivatoMobileByRS, setAttivatoMobileByRS] = useState<Record<string, AttivatoMobileDettaglio[]>>({}); // Volumi aggregati per RS
  const [attivatoFissoByPos, setAttivatoFissoByPos] = useState<Record<string, AttivatoFissoRiga[]>>({});
  const [attivatoFissoByRS, setAttivatoFissoByRS] = useState<Record<string, AttivatoFissoRiga[]>>({}); // Volumi Fisso aggregati per RS
  const [attivatoCBByPos, setAttivatoCBByPos] = useState<Record<string, AttivatoCBDettaglio[]>>({});
  const [attivatoCBByRS, setAttivatoCBByRS] = useState<Record<string, AttivatoCBDettaglio[]>>({}); // Volumi Partnership aggregati per RS
  const [calendarioOverrides, setCalendarioOverrides] = useState<CalendariMeseOverrides>({});
  const [isLoaded, setIsLoaded] = useState(false);
  const hasInitialized = useRef(false);
  
  // Save dialog state
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [preventivoName, setPreventivoName] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [currentPreventivoId, setCurrentPreventivoId] = useState<string | null>(null);
  
  // Energia state
  const [energiaConfig, setEnergiaConfig] = useState<EnergiaConfig>({
    pdvInGara: 0,
    targetNoMalus: 0,
    targetS1: 0,
    targetS2: 0,
    targetS3: 0,
  });
  const [energiaPdvInGara, setEnergiaPdvInGara] = useState<EnergiaPdvInGara[]>([]);
  const [attivatoEnergiaByPos, setAttivatoEnergiaByPos] = useState<Record<string, EnergiaAttivatoRiga[]>>({});
  const [attivatoEnergiaByRS, setAttivatoEnergiaByRS] = useState<Record<string, EnergiaAttivatoRiga[]>>({}); // Volumi Energia aggregati per RS

  // Assicurazioni state
  const [assicurazioniConfig, setAssicurazioniConfig] = useState<AssicurazioniConfig>({
    pdvInGara: 0,
    targetNoMalus: 0,
    targetS1: 0,
    targetS2: 0,
  });
  const [assicurazioniPdvInGara, setAssicurazioniPdvInGara] = useState<AssicurazioniPdvInGara[]>([]);
  const [attivatoAssicurazioniByPos, setAttivatoAssicurazioniByPos] = useState<Record<string, AssicurazioniAttivatoRiga>>({});
  const [attivatoAssicurazioniByRS, setAttivatoAssicurazioniByRS] = useState<Record<string, AssicurazioniAttivatoRiga>>({}); // Volumi Assicurazioni aggregati per RS

  // Protecta state
  const [attivatoProtectaByPos, setAttivatoProtectaByPos] = useState<Record<string, ProtectaAttivatoRiga>>({});
  const [attivatoProtectaByRS, setAttivatoProtectaByRS] = useState<Record<string, ProtectaAttivatoRiga>>({}); // Volumi Protecta aggregati per RS

  // Extra Gara IVA - override soglie per RS
  const [extraGaraSoglieOverride, setExtraGaraSoglieOverride] = useState<ExtraGaraSogliePerRS>({});

  // PDV Configuration save/load state
  const [saveConfigDialogOpen, setSaveConfigDialogOpen] = useState(false);
  const [saveMode, setSaveMode] = useState<'overwrite' | 'new' | null>(null);
  const [loadConfigDialogOpen, setLoadConfigDialogOpen] = useState(false);
  const [configName, setConfigName] = useState("");
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [savedConfigs, setSavedConfigs] = useState<Array<{ id: string; name: string; updatedAt: string | null; createdAt: string | null }>>([]);
  const [loadingConfigs, setLoadingConfigs] = useState(false);
  const [activeConfigId, setActiveConfigId] = useState<string | null>(null);
  const [activeConfigName, setActiveConfigName] = useState<string | null>(null);

  const [backendConfig, setBackendConfig] = useState<{ config: any; updatedAt: string | null } | null>(null);

  const fetchSavedConfigs = async () => {
    setLoadingConfigs(true);
    try {
      const [configsRes, backendRes] = await Promise.all([
        fetch(apiUrl('/api/pdv-configurations'), { credentials: 'include' }),
        fetch(apiUrl('/api/organization-config'), { credentials: 'include' }),
      ]);
      if (configsRes.ok) {
        const data = await configsRes.json();
        setSavedConfigs(data);
      }
      if (backendRes.ok) {
        const data = await backendRes.json();
        setBackendConfig({ config: data.config, updatedAt: data.updatedAt });
      }
    } catch (err) {
      console.error('Error fetching saved configs:', err);
    } finally {
      setLoadingConfigs(false);
    }
  };

  const buildCurrentConfig = () => ({
    configGara,
    numeroPdv,
    ragioniSociali,
    puntiVendita,
    pistaMobileConfig,
    pistaFissoConfig,
    partnershipRewardConfig,
    calendarioOverrides,
    energiaConfig,
    energiaPdvInGara,
    assicurazioniConfig,
    assicurazioniPdvInGara,
    pistaMobileRSConfig,
    pistaFissoRSConfig,
    partnershipRewardRSConfig,
    modalitaInserimentoRS,
    configVersion: '2.0' as const,
  });

  const handleSaveConfig = async (forceNew?: boolean) => {
    if (!configName.trim()) return;
    setIsSavingConfig(true);
    try {
      const config = buildCurrentConfig();
      const isUpdate = activeConfigId && !forceNew;
      if (isUpdate) {
        const res = await fetch(apiUrl(`/api/pdv-configurations/${activeConfigId}`), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ name: configName.trim(), config }),
        });
        if (res.ok) {
          setActiveConfigName(configName.trim());
          toast({ title: "Configurazione aggiornata", description: `"${configName.trim()}" salvata con successo.` });
        }
      } else {
        const res = await fetch(apiUrl('/api/pdv-configurations'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ name: configName.trim(), config }),
        });
        if (res.ok) {
          const saved = await res.json();
          setActiveConfigId(saved.id);
          setActiveConfigName(configName.trim());
          toast({ title: "Configurazione salvata", description: `"${configName.trim()}" creata con successo.` });
        }
      }
      saveConfig(config);
      await saveRemoteConfigNow(config);
    } catch (err) {
      toast({ title: "Errore", description: "Impossibile salvare la configurazione.", variant: "destructive" });
    } finally {
      setIsSavingConfig(false);
      setSaveConfigDialogOpen(false);
      setSaveMode(null);
    }
  };

  const applyConfigData = (cfg: any) => {
      if (cfg.configGara) setConfigGara(cfg.configGara);
      if (cfg.numeroPdv !== undefined) setNumeroPdv(cfg.numeroPdv);
      if (cfg.ragioniSociali) setRagioniSociali(cfg.ragioniSociali);
      if (cfg.puntiVendita) setPuntiVendita(cfg.puntiVendita);
      if (cfg.pistaMobileConfig) setPistaMobileConfig(cfg.pistaMobileConfig);
      if (cfg.pistaFissoConfig) setPistaFissoConfig(cfg.pistaFissoConfig);
      if (cfg.partnershipRewardConfig) setPartnershipRewardConfig(cfg.partnershipRewardConfig);
      if (cfg.calendarioOverrides) setCalendarioOverrides(cfg.calendarioOverrides);
      if (cfg.energiaConfig) setEnergiaConfig(cfg.energiaConfig);
      if (cfg.energiaPdvInGara) setEnergiaPdvInGara(cfg.energiaPdvInGara);
      if (cfg.assicurazioniConfig) setAssicurazioniConfig(cfg.assicurazioniConfig);
      if (cfg.assicurazioniPdvInGara) setAssicurazioniPdvInGara(cfg.assicurazioniPdvInGara);
      if (cfg.pistaMobileRSConfig) setPistaMobileRSConfig(cfg.pistaMobileRSConfig);
      if (cfg.pistaFissoRSConfig) setPistaFissoRSConfig(cfg.pistaFissoRSConfig);
      if (cfg.partnershipRewardRSConfig) setPartnershipRewardRSConfig(cfg.partnershipRewardRSConfig);
      if (cfg.modalitaInserimentoRS !== undefined) setModalitaInserimentoRS(cfg.modalitaInserimentoRS);
      if (cfg.extraGaraSoglieOverride) setExtraGaraSoglieOverride(cfg.extraGaraSoglieOverride);
  };

  const handleLoadBackendConfig = () => {
    if (!backendConfig?.config) return;
    applyConfigData(backendConfig.config);
    setActiveConfigId(null);
    setActiveConfigName(null);
    setLoadConfigDialogOpen(false);
    toast({ title: "Configurazione backend caricata", description: "La configurazione corrente del backend è stata ripristinata." });
  };

  const handleLoadConfig = async (configId: string) => {
    try {
      const res = await fetch(apiUrl(`/api/pdv-configurations/${configId}`), { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json();
      applyConfigData(data.config);
      setActiveConfigId(data.id);
      setActiveConfigName(data.name);
      setLoadConfigDialogOpen(false);
      toast({ title: "Configurazione caricata", description: `"${data.name}" caricata con successo.` });
    } catch (err) {
      toast({ title: "Errore", description: "Impossibile caricare la configurazione.", variant: "destructive" });
    }
  };

  const handleDeleteConfig = async (configId: string, configNameToDelete: string) => {
    try {
      const res = await fetch(apiUrl(`/api/pdv-configurations/${configId}`), { method: 'DELETE', credentials: 'include' });
      if (res.ok) {
        setSavedConfigs(prev => prev.filter(c => c.id !== configId));
        if (activeConfigId === configId) {
          setActiveConfigId(null);
          setActiveConfigName(null);
        }
        toast({ title: "Configurazione eliminata", description: `"${configNameToDelete}" rimossa.` });
      }
    } catch (err) {
      toast({ title: "Errore", description: "Impossibile eliminare la configurazione.", variant: "destructive" });
    }
  };

  // Carica preventivo da URL o stato salvato al mount
  useEffect(() => {
    if (_preventivatoreInitialized) return;
    _preventivatoreInitialized = true;
    const loadFromUrl = async () => {
      const preventivoId = searchParams.get('id');
      const isNew = searchParams.get('new') === 'true';
      
      // Se è una nuova simulazione, resetta i dati volume ma mantieni la config
      if (isNew) {
        const persistedConfig = loadConfig();
        if (persistedConfig && persistedConfig.configVersion === '2.0') {
          // Carica configGara (nome, tipologia, anno, mese, periodo)
          if (persistedConfig.configGara) {
            setConfigGara(persistedConfig.configGara);
          }
          setNumeroPdv(persistedConfig.numeroPdv);
          setPuntiVendita(persistedConfig.puntiVendita);
          setPistaMobileConfig(persistedConfig.pistaMobileConfig);
          setPistaFissoConfig(persistedConfig.pistaFissoConfig || { sogliePerPos: [] });
          setPartnershipRewardConfig(persistedConfig.partnershipRewardConfig || { configPerPos: [] });
          setCalendarioOverrides(persistedConfig.calendarioOverrides || {});
          setEnergiaConfig(persistedConfig.energiaConfig || { pdvInGara: 0, targetNoMalus: 0, targetS1: 0, targetS2: 0, targetS3: 0 });
          setEnergiaPdvInGara(persistedConfig.energiaPdvInGara || []);
          setAssicurazioniConfig(persistedConfig.assicurazioniConfig || { pdvInGara: 0, targetNoMalus: 0, targetS1: 0, targetS2: 0 });
          setAssicurazioniPdvInGara(persistedConfig.assicurazioniPdvInGara || []);
          // Carica configurazioni RS se presenti
          if (persistedConfig.pistaMobileRSConfig) {
            setPistaMobileRSConfig(persistedConfig.pistaMobileRSConfig);
          }
          if (persistedConfig.pistaFissoRSConfig) {
            setPistaFissoRSConfig(persistedConfig.pistaFissoRSConfig);
          }
          if (persistedConfig.partnershipRewardRSConfig) {
            setPartnershipRewardRSConfig(persistedConfig.partnershipRewardRSConfig);
          }
          setMobileCategories(MOBILE_CATEGORIES_CONFIG_DEFAULT);
        }
        // Resetta solo i dati volume (sia per PDV che per RS)
        setAttivatoMobileByPos({});
        setAttivatoMobileByRS({}); // Reset volumi Mobile aggregati RS
        setAttivatoFissoByPos({});
        setAttivatoFissoByRS({}); // Reset volumi Fisso aggregati RS
        setAttivatoCBByPos({});
        setAttivatoCBByRS({}); // Reset volumi Partnership aggregati RS
        setAttivatoEnergiaByPos({});
        setAttivatoEnergiaByRS({}); // Reset volumi Energia aggregati RS
        setAttivatoAssicurazioniByPos({});
        setAttivatoAssicurazioniByRS({}); // Reset volumi Assicurazioni aggregati RS
        setAttivatoProtectaByPos({});
        setAttivatoProtectaByRS({}); // Reset volumi Protecta aggregati RS
        setModalitaInserimentoRS(null); // Resetta la scelta modalità
        setCurrentPreventivoId(null);
        setPreventivoName("");
        setStep(0);
        clearState();
        setIsLoaded(true);
        
        toast({
          title: "Nuova simulazione",
          description: "I dati volume sono stati resettati. La configurazione è stata mantenuta.",
        });
        return;
      }
      
      if (preventivoId) {
        const result = await loadPreventivo(preventivoId);
        if (result.data) {
          const data = result.data.data as Record<string, any>;
          setCurrentPreventivoId(preventivoId);
          setPreventivoName(result.data.name);
          setStep(data.step || 0);
          setConfigGara(data.configGara || { nomeGara: "", haLetteraUfficiale: false, annoGara: new Date().getFullYear(), meseGara: new Date().getMonth() + 1, tipoPeriodo: "mensile" });
          setNumeroPdv(data.numeroPdv || 0);
          setPuntiVendita(data.puntiVendita || []);
          setPistaMobileConfig(data.pistaMobileConfig || { sogliePerPos: [], applicaDecurtazione30SeNoFissoO8Piva: true });
          setPistaFissoConfig(data.pistaFissoConfig || { sogliePerPos: [] });
          setPartnershipRewardConfig(data.partnershipRewardConfig || { configPerPos: [] });
          setMobileCategories(MOBILE_CATEGORIES_CONFIG_DEFAULT);
          setAttivatoMobileByPos(data.attivatoMobileByPos || {});
          setAttivatoFissoByPos(data.attivatoFissoByPos || {});
          setAttivatoCBByPos(data.attivatoCBByPos || {});
          setCalendarioOverrides(data.calendarioOverrides || {});
          setEnergiaConfig(data.energiaConfig || { pdvInGara: 0, targetNoMalus: 0, targetS1: 0, targetS2: 0, targetS3: 0 });
          setEnergiaPdvInGara(data.energiaPdvInGara || []);
          setAttivatoEnergiaByPos(data.attivatoEnergiaByPos || {});
          setAssicurazioniConfig(data.assicurazioniConfig || { pdvInGara: 0, targetNoMalus: 0, targetS1: 0, targetS2: 0 });
          setAssicurazioniPdvInGara(data.assicurazioniPdvInGara || []);
          setAttivatoAssicurazioniByPos(data.attivatoAssicurazioniByPos || {});
          setAttivatoProtectaByPos(data.attivatoProtectaByPos || {});
          // Ripristina dati RS
          if (data.modalitaInserimentoRS !== undefined) setModalitaInserimentoRS(data.modalitaInserimentoRS);
          if (data.pistaMobileRSConfig) setPistaMobileRSConfig(data.pistaMobileRSConfig);
          if (data.pistaFissoRSConfig) setPistaFissoRSConfig(data.pistaFissoRSConfig);
          if (data.partnershipRewardRSConfig) setPartnershipRewardRSConfig(data.partnershipRewardRSConfig);
          setAttivatoMobileByRS(data.attivatoMobileByRS || {});
          setAttivatoFissoByRS(data.attivatoFissoByRS || {});
          setAttivatoCBByRS(data.attivatoCBByRS || {});
          setAttivatoEnergiaByRS(data.attivatoEnergiaByRS || {});
          setAttivatoAssicurazioniByRS(data.attivatoAssicurazioniByRS || {});
          setAttivatoProtectaByRS(data.attivatoProtectaByRS || {});
          if (data.extraGaraSoglieOverride) setExtraGaraSoglieOverride(data.extraGaraSoglieOverride);
          
          toast({
            title: "Preventivo caricato",
            description: `Caricato: ${result.data.name}`,
          });
          setIsLoaded(true);
          return;
        }
      }
      
      // ===== NUOVO SISTEMA DI PERSISTENZA =====
      // Priorità: 1) Backend (organization_config) → 2) localStorage → 3) template
      
      // Tenta prima il caricamento dal backend
      const remoteConfig = await loadRemoteConfig();
      const savedState = loadState();
      const persistedConfig = loadConfig();
      const template = loadTemplate();

      const CONFIG_VERSION = '2.0';
      const savedVersion = (savedState as any)?.configVersion;
      const canUseSavedState = !!savedState && savedVersion === CONFIG_VERSION;
      const canUsePersistedConfig = !!persistedConfig && persistedConfig.configVersion === CONFIG_VERSION;
      const canUseRemoteConfig = !!remoteConfig && remoteConfig.configVersion === CONFIG_VERSION;

      // Se lo stato completo è vecchio/non compatibile, lo eliminiamo
      if (savedState && !canUseSavedState) {
        console.log('[Preventivatore] Versione configurazione obsoleta, reset automatico');
        clearState();
        toast({
          title: "Configurazione aggiornata",
          description: "Formato aggiornato: i volumi sono stati azzerati.",
          variant: "default",
        });
      }

      // Helper per applicare una config
      const applyConfig = (config: typeof remoteConfig, source: string) => {
        if (!config) return false;
        console.log(`[Preventivatore] Caricamento config da: ${source}`);
        if (config.configGara) setConfigGara(config.configGara);
        setNumeroPdv(config.numeroPdv || 0);
        setPuntiVendita(config.puntiVendita || []);
        setPistaMobileConfig(config.pistaMobileConfig || { sogliePerPos: [], applicaDecurtazione30SeNoFissoO8Piva: true });
        setPistaFissoConfig(config.pistaFissoConfig || { sogliePerPos: [] });
        setPartnershipRewardConfig(config.partnershipRewardConfig || { configPerPos: [] });
        setCalendarioOverrides(config.calendarioOverrides || {});
        setEnergiaConfig(config.energiaConfig || { pdvInGara: 0, targetNoMalus: 0, targetS1: 0, targetS2: 0, targetS3: 0 });
        setEnergiaPdvInGara(config.energiaPdvInGara || []);
        setAssicurazioniConfig(config.assicurazioniConfig || { pdvInGara: 0, targetNoMalus: 0, targetS1: 0, targetS2: 0 });
        setAssicurazioniPdvInGara(config.assicurazioniPdvInGara || []);
        setMobileCategories(MOBILE_CATEGORIES_CONFIG_DEFAULT);
        if (config.pistaMobileRSConfig) setPistaMobileRSConfig(config.pistaMobileRSConfig);
        if (config.pistaFissoRSConfig) setPistaFissoRSConfig(config.pistaFissoRSConfig);
        if (config.partnershipRewardRSConfig) setPartnershipRewardRSConfig(config.partnershipRewardRSConfig);
        if (config.modalitaInserimentoRS !== undefined) setModalitaInserimentoRS(config.modalitaInserimentoRS);
        return true;
      };

      // 1) PRIORITÀ: Backend (organization_config) - più affidabile del localStorage
      if (canUseRemoteConfig && remoteConfig) {
        applyConfig(remoteConfig, 'backend');
        // Sincronizza localStorage con backend (remoteConfig già ha savedAt)
        saveConfig(remoteConfig);
        toast({
          title: "Configurazione sincronizzata",
          description: "Dati caricati dal backend dell'organizzazione",
        });
      }
      // 2) Fallback: localStorage persistedConfig
      else if (canUsePersistedConfig && persistedConfig) {
        applyConfig(persistedConfig as typeof remoteConfig, 'localStorage');
        if (!canUseSavedState) {
          toast({
            title: "Configurazione locale caricata",
            description: "PDV, cluster, calendari e soglie ripristinati",
          });
        }
      }
      // 3) Fallback: template
      else if (template) {
        setConfigGara(template.configGara);
        setNumeroPdv(template.numeroPdv);
        setPuntiVendita(template.puntiVendita);
        setPistaMobileConfig(template.pistaMobileConfig);
        setPistaFissoConfig(template.pistaFissoConfig || { sogliePerPos: [] });
        setPartnershipRewardConfig(template.partnershipRewardConfig || { configPerPos: [] });
        setMobileCategories(MOBILE_CATEGORIES_CONFIG_DEFAULT);
        toast({
          title: "Template caricato",
          description: "Configurazioni di base ripristinate",
        });
      }

      // Ripristina volumi dallo stato salvato se disponibile
      if (canUseSavedState) {
        setStep(savedState.step);
        setAttivatoMobileByPos(savedState.attivatoMobileByPos || {});
        setAttivatoFissoByPos(savedState.attivatoFissoByPos || {});
        setAttivatoCBByPos(savedState.attivatoCBByPos || {});
        // Ripristina volumi RS
        const sd = savedState as any;
        if (sd.attivatoMobileByRS) setAttivatoMobileByRS(sd.attivatoMobileByRS);
        if (sd.attivatoFissoByRS) setAttivatoFissoByRS(sd.attivatoFissoByRS);
        if (sd.attivatoCBByRS) setAttivatoCBByRS(sd.attivatoCBByRS);
        if (sd.attivatoEnergiaByRS) setAttivatoEnergiaByRS(sd.attivatoEnergiaByRS);
        if (sd.attivatoAssicurazioniByRS) setAttivatoAssicurazioniByRS(sd.attivatoAssicurazioniByRS);
        if (sd.attivatoProtectaByRS) setAttivatoProtectaByRS(sd.attivatoProtectaByRS);
        if (sd.modalitaInserimentoRS !== undefined) setModalitaInserimentoRS(sd.modalitaInserimentoRS);
        toast({
          title: "Volumi ripristinati",
          description: `Ultimo salvataggio: ${new Date(savedState.savedAt).toLocaleString('it-IT')}`,
        });
      }

      setIsLoaded(true);
    };
    
    loadFromUrl();
    return () => {
      _preventivatoreInitialized = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Salva automaticamente lo stato quando cambia
  useEffect(() => {
    if (!isLoaded) return;

    // Airbag: evita di sovrascrivere lo stato completo con un array PDV vuoto
    // quando esiste già una configurazione persistente valida.
    if (puntiVendita.length === 0) {
      const persisted = loadConfig();
      if (persisted?.puntiVendita?.length) return;
    }
    
    saveState({
      step,
      configGara,
      numeroPdv,
      puntiVendita,
      pistaMobileConfig,
      pistaFissoConfig,
      partnershipRewardConfig,
      mobileCategories,
      attivatoMobileByPos,
      attivatoFissoByPos,
      attivatoCBByPos,
      calendarioOverrides,
      energiaConfig,
      energiaPdvInGara,
      attivatoEnergiaByPos,
      assicurazioniConfig,
      assicurazioniPdvInGara,
      attivatoAssicurazioniByPos,
      attivatoProtectaByPos,
      // Dati RS
      modalitaInserimentoRS,
      attivatoMobileByRS,
      attivatoFissoByRS,
      attivatoCBByRS,
      attivatoEnergiaByRS,
      attivatoAssicurazioniByRS,
      attivatoProtectaByRS,
      extraGaraSoglieOverride: Object.keys(extraGaraSoglieOverride).length > 0 ? extraGaraSoglieOverride : undefined,
      configVersion: '2.0',
    } as any);
  }, [step, configGara, numeroPdv, puntiVendita, pistaMobileConfig, pistaFissoConfig, partnershipRewardConfig, mobileCategories, attivatoMobileByPos, attivatoFissoByPos, attivatoCBByPos, calendarioOverrides, energiaConfig, energiaPdvInGara, attivatoEnergiaByPos, assicurazioniConfig, assicurazioniPdvInGara, attivatoAssicurazioniByPos, attivatoProtectaByPos, modalitaInserimentoRS, attivatoMobileByRS, attivatoFissoByRS, attivatoCBByRS, attivatoEnergiaByRS, attivatoAssicurazioniByRS, attivatoProtectaByRS, extraGaraSoglieOverride, saveState, loadConfig, isLoaded]);

  // Salva automaticamente la configurazione (PDV, cluster, calendari, soglie) su localStorage + backend
  useEffect(() => {
    // Salva solo se caricato E abbiamo effettivamente dei PDV configurati
    // Usiamo puntiVendita.length invece di numeroPdv per evitare race conditions
    if (!isLoaded || puntiVendita.length === 0) return;
    
    const configToSave = {
      configGara,
      numeroPdv,
      puntiVendita,
      pistaMobileConfig,
      pistaFissoConfig,
      partnershipRewardConfig,
      calendarioOverrides,
      energiaConfig,
      energiaPdvInGara,
      assicurazioniConfig,
      assicurazioniPdvInGara,
      pistaMobileRSConfig,
      pistaFissoRSConfig,
      partnershipRewardRSConfig,
      modalitaInserimentoRS,
      extraGaraSoglieOverride: Object.keys(extraGaraSoglieOverride).length > 0 ? extraGaraSoglieOverride : undefined,
      configVersion: '2.0' as const,
    };

    // Salva su localStorage (immediato)
    saveConfig(configToSave);
    
    // Salva su backend con debounce (ogni ~2.5s)
    saveRemoteConfigDebounced(configToSave);
  }, [configGara, numeroPdv, puntiVendita, pistaMobileConfig, pistaFissoConfig, partnershipRewardConfig, calendarioOverrides, energiaConfig, energiaPdvInGara, assicurazioniConfig, assicurazioniPdvInGara, pistaMobileRSConfig, pistaFissoRSConfig, partnershipRewardRSConfig, modalitaInserimentoRS, extraGaraSoglieOverride, saveConfig, saveRemoteConfigDebounced, isLoaded]);

  // Aggiorna automaticamente le soglie FISSO quando cambiano cluster, tipo posizione o sconto
  useEffect(() => {
    if (!isLoaded) return;

    const applyScontoVal = (v: number, sconto: number) => sconto > 0 ? Math.round(v * (1 - sconto / 100)) : v;

    setPistaFissoConfig((prev) => {
      if (prev.sogliePerPos.length === 0) return prev;
      let changed = false;
      const updated = prev.sogliePerPos.map((conf, index) => {
        const pdv = puntiVendita[index];
        if (!pdv || !pdv.clusterFisso || !pdv.tipoPosizione || !conf) return conf;

        const clusterNum = mapClusterFissoToNumber(pdv.clusterFisso);
        const defaults = getDefaultFissoThresholds(pdv.tipoPosizione, clusterNum);
        const sconto = pdv.scontoSoglieFisso || 0;

        const s1 = applyScontoVal(defaults.soglia1, sconto);
        const s2 = applyScontoVal(defaults.soglia2, sconto);
        const s3 = applyScontoVal(defaults.soglia3, sconto);
        const s4 = applyScontoVal(defaults.soglia4, sconto);
        const s5 = applyScontoVal(defaults.soglia5, sconto);

        if (conf.soglia1 !== s1 || conf.soglia2 !== s2 || conf.soglia3 !== s3 || conf.soglia4 !== s4 || conf.soglia5 !== s5) {
          changed = true;
          return {
            ...conf,
            posCode: pdv.codicePos || '',
            soglia1: s1, soglia2: s2, soglia3: s3, soglia4: s4, soglia5: s5,
            multiplierSoglia1: conf.multiplierSoglia1 || 2,
            multiplierSoglia2: conf.multiplierSoglia2 || 3,
            multiplierSoglia3: conf.multiplierSoglia3 || 4,
            multiplierSoglia4: conf.multiplierSoglia4 || 5,
            forecastTargetPunti: s4,
          };
        }
        return conf;
      });
      return changed ? { sogliePerPos: updated } : prev;
    });
  }, [puntiVendita.map(p => `${p.tipoPosizione}-${p.clusterFisso}-${p.scontoSoglieFisso || 0}`).join(','), isLoaded]);

  // Aggiorna automaticamente i target Partnership Reward quando cambiano cluster CB, tipo posizione o sconto
  useEffect(() => {
    if (!isLoaded) return;

    setPartnershipRewardConfig((prev) => {
      if (prev.configPerPos.length === 0) return prev;
      let changed = false;
      const updated = prev.configPerPos.map((conf, index) => {
        const pdv = puntiVendita[index];
        if (!pdv || !pdv.clusterCB || !pdv.tipoPosizione || !conf) return conf;

        const baseTarget = getDefaultTarget100(pdv.tipoPosizione, pdv.clusterCB);
        const scontoCB = pdv.scontoSoglieCB || 0;
        const expectedTarget = scontoCB > 0 ? Math.round(baseTarget * (1 - scontoCB / 100)) : baseTarget;

        if (conf.config.target100 !== expectedTarget) {
          changed = true;
          return {
            ...conf,
            posCode: pdv.codicePos || '',
            config: {
              ...conf.config,
              target100: expectedTarget,
              target80: calculateTarget80(expectedTarget),
            }
          };
        }
        return conf;
      });
      return changed ? { configPerPos: updated } : prev;
    });
  }, [puntiVendita.map(p => `${p.tipoPosizione}-${p.clusterCB}-${p.scontoSoglieCB || 0}`).join(','), isLoaded]);

  const handleNumeroPdvChange = (value: string) => {
    const n = Number(value) || 0;
    setNumeroPdv(n);
    setPuntiVendita((prev) => { const current = [...prev]; if (n > current.length) { for (let i = current.length; i < n; i++) current.push(createEmptyPdv(i)); } else if (n < current.length) { current.splice(n); } return current; });
    setPistaMobileConfig((prev) => { const arr = [...(prev.sogliePerPos || [])]; if (n > arr.length) { for (let i = arr.length; i < n; i++) arr.push(createDefaultPistaMobileConfig()); } else if (n < arr.length) { arr.splice(n); } return { ...prev, sogliePerPos: arr }; });
    setPistaFissoConfig((prev) => { const arr = [...(prev.sogliePerPos || [])]; if (n > arr.length) { for (let i = arr.length; i < n; i++) arr.push({ posCode: '', soglia1: 0, soglia2: 0, soglia3: 0, soglia4: 0, soglia5: 0, multiplierSoglia1: 2, multiplierSoglia2: 3, multiplierSoglia3: 3.5, multiplierSoglia4: 4, multiplierSoglia5: 5, forecastTargetPunti: 0 }); } else if (n < arr.length) { arr.splice(n); } return { sogliePerPos: arr }; });
    setPartnershipRewardConfig((prev) => { const arr = [...(prev.configPerPos || [])]; if (n > arr.length) { for (let i = arr.length; i < n; i++) arr.push({ posCode: '', config: { target100: 0, target80: 0, premio100: 0, premio80: 0 } }); } else if (n < arr.length) { arr.splice(n); } return { configPerPos: arr }; });
  };

  // Sincronizza energiaPdvInGara quando cambiano i puntiVendita
  useEffect(() => {
    if (puntiVendita.length === 0) {
      setEnergiaPdvInGara([]);
      setEnergiaConfig((prev) => ({ ...prev, pdvInGara: 0 }));
      return;
    }
    
    setEnergiaPdvInGara((prev) => {
      const updated = puntiVendita.map((pdv) => {
        const existing = prev.find((p) => p.pdvId === pdv.id);
        // Default isInGara = true se è nuovo PDV
        return existing || { pdvId: pdv.id, codicePos: pdv.codicePos, nome: pdv.nome, isInGara: true };
      });
      return updated;
    });
    
    setEnergiaConfig((prev) => {
      const numPdv = puntiVendita.length;
      if (prev.pdvInGara === 0 || (modalitaInserimentoRS === "per_rs" && prev.targetNoMalus === 0 && prev.targetS1 === 0)) {
        return { 
          ...prev, 
          pdvInGara: numPdv,
          targetNoMalus: 10,
          targetS1: 15,
          targetS2: 25,
          targetS3: 40,
        };
      }
      if (modalitaInserimentoRS === "per_rs") {
        return { ...prev, pdvInGara: numPdv };
      }
      return prev;
    });
  }, [puntiVendita, modalitaInserimentoRS]);

  // Sincronizza assicurazioniPdvInGara quando cambiano i puntiVendita
  useEffect(() => {
    if (puntiVendita.length === 0) {
      setAssicurazioniPdvInGara([]);
      setAssicurazioniConfig((prev) => ({ ...prev, pdvInGara: 0 }));
      return;
    }
    
    setAssicurazioniPdvInGara((prev) => {
      const updated = puntiVendita.map((pdv) => {
        const existing = prev.find((p) => p.pdvId === pdv.codicePos);
        // Default inGara = true se è nuovo PDV
        return existing || { pdvId: pdv.codicePos, codicePos: pdv.codicePos, nome: pdv.nome, inGara: true };
      });
      return updated;
    });
    
    setAssicurazioniConfig((prev) => {
      const numPdv = puntiVendita.length;
      if (prev.pdvInGara === 0 || (modalitaInserimentoRS === "per_rs" && prev.targetNoMalus === 0 && prev.targetS1 === 0)) {
        return { 
          ...prev, 
          pdvInGara: numPdv,
          targetNoMalus: 15,
          targetS1: 20,
          targetS2: 25,
        };
      }
      if (modalitaInserimentoRS === "per_rs") {
        return { ...prev, pdvInGara: numPdv };
      }
      return prev;
    });
  }, [puntiVendita, modalitaInserimentoRS]);

  const updatePdvField = <K extends keyof PuntoVendita>(index: number, field: K, value: PuntoVendita[K]) => {
    setPuntiVendita((prev) => { const updated = [...prev]; updated[index] = { ...updated[index], [field]: value }; return updated; });
  };

  const updatePistaMobilePosField = (index: number, field: keyof any, value: any) => {
    setPistaMobileConfig((prev) => { const arr = [...prev.sogliePerPos]; arr[index] = { ...arr[index], [field]: value }; return { ...prev, sogliePerPos: arr }; });
  };

  const updatePistaFissoPosField = (index: number, field: keyof PistaFissoPosConfig, value: any) => {
    setPistaFissoConfig((prev) => { const arr = [...prev.sogliePerPos]; arr[index] = { ...arr[index], [field]: value }; return { sogliePerPos: arr }; });
  };

  const updatePartnershipRewardField = (index: number, field: "target100" | "premio100", value: number) => {
    setPartnershipRewardConfig((prev) => {
      const arr = [...prev.configPerPos];
      const currentConfig = arr[index].config;
      
      if (field === "target100") {
        arr[index] = {
          ...arr[index],
          config: {
            ...currentConfig,
            target100: value,
            target80: calculateTarget80(value),
          }
        };
      } else if (field === "premio100") {
        arr[index] = {
          ...arr[index],
          config: {
            ...currentConfig,
            premio100: value,
            premio80: calculatePremio80(value),
          }
        };
      }
      
      return { configPerPos: arr };
    });
  };

  const handleGaraConfigUpload = (config: GaraConfigUpload) => {
    if (config.periodo) setConfigGara((prev) => ({ ...prev, annoGara: config.periodo?.anno ?? prev.annoGara, meseGara: config.periodo?.mese ?? prev.meseGara, tipoPeriodo: config.periodo?.tipo ?? prev.tipoPeriodo }));
    // Usa sempre la configurazione di default dei punti, non quella dal file
    // if (config.mobileCategories && config.mobileCategories.length > 0) setMobileCategories(config.mobileCategories);
  };

  const handlePuntiVenditaExtracted = (extractedPdv: any[]) => {
    // Imposta numero punti vendita
    setNumeroPdv(extractedPdv.length);
    
    // Popola i punti vendita con i dati estratti
    const newPuntiVendita = extractedPdv.map((pdv, index) => {
      const existingPdv = puntiVendita[index] || createEmptyPdv(index);
      return {
        ...existingPdv,
        codicePos: pdv.codicePos || '',
        nome: pdv.nome || '',
        ragioneSociale: pdv.ragioneSociale || '',
        canale: pdv.canale || 'franchising',
        tipoPosizione: pdv.tipoPosizione || 'strada',
        clusterMobile: pdv.clusterMobile || '',
        clusterFisso: pdv.clusterFisso || '',
        clusterCB: pdv.clusterCB || '',
      };
    });
    setPuntiVendita(newPuntiVendita);
  };

  // Helper per convertire dati RS in formato by-pos (assegna dati RS al primo PDV di ogni RS)
  const getEffectiveMobileData = (): Record<string, AttivatoMobileDettaglio[]> => {
    if (modalitaInserimentoRS !== "per_rs") return attivatoMobileByPos;
    const result: Record<string, AttivatoMobileDettaglio[]> = {};
    const processedRS = new Set<string>();
    puntiVendita.forEach(pdv => {
      if (!processedRS.has(pdv.ragioneSociale)) {
        processedRS.add(pdv.ragioneSociale);
        result[pdv.id] = attivatoMobileByRS[pdv.ragioneSociale] ?? [];
      }
    });
    return result;
  };

  const getEffectiveFissoData = (): Record<string, AttivatoFissoRiga[]> => {
    if (modalitaInserimentoRS !== "per_rs") return attivatoFissoByPos;
    const result: Record<string, AttivatoFissoRiga[]> = {};
    const processedRS = new Set<string>();
    puntiVendita.forEach(pdv => {
      if (!processedRS.has(pdv.ragioneSociale)) {
        processedRS.add(pdv.ragioneSociale);
        result[pdv.id] = attivatoFissoByRS[pdv.ragioneSociale] ?? [];
      }
    });
    return result;
  };

  const getEffectiveCBData = (): Record<string, AttivatoCBDettaglio[]> => {
    if (modalitaInserimentoRS !== "per_rs") return attivatoCBByPos;
    const result: Record<string, AttivatoCBDettaglio[]> = {};
    const processedRS = new Set<string>();
    puntiVendita.forEach(pdv => {
      if (!processedRS.has(pdv.ragioneSociale)) {
        processedRS.add(pdv.ragioneSociale);
        result[pdv.id] = attivatoCBByRS[pdv.ragioneSociale] ?? [];
      }
    });
    return result;
  };

  const getEffectiveEnergiaData = (): Record<string, EnergiaAttivatoRiga[]> => {
    if (modalitaInserimentoRS !== "per_rs") return attivatoEnergiaByPos;
    const result: Record<string, EnergiaAttivatoRiga[]> = {};
    const processedRS = new Set<string>();
    puntiVendita.forEach(pdv => {
      if (!processedRS.has(pdv.ragioneSociale)) {
        processedRS.add(pdv.ragioneSociale);
        result[pdv.id] = attivatoEnergiaByRS[pdv.ragioneSociale] ?? [];
      }
    });
    return result;
  };

  const getEffectiveAssicurazioniData = (): Record<string, AssicurazioniAttivatoRiga> => {
    if (modalitaInserimentoRS !== "per_rs") return attivatoAssicurazioniByPos;
    const result: Record<string, AssicurazioniAttivatoRiga> = {};
    const processedRS = new Set<string>();
    puntiVendita.forEach(pdv => {
      if (!processedRS.has(pdv.ragioneSociale)) {
        processedRS.add(pdv.ragioneSociale);
        result[pdv.id] = attivatoAssicurazioniByRS[pdv.ragioneSociale] ?? createEmptyAssicurazioniAttivato();
      }
    });
    return result;
  };

  const getEffectiveProtectaData = (): Record<string, ProtectaAttivatoRiga> => {
    if (modalitaInserimentoRS !== "per_rs") return attivatoProtectaByPos;
    const result: Record<string, ProtectaAttivatoRiga> = {};
    const processedRS = new Set<string>();
    puntiVendita.forEach(pdv => {
      if (!processedRS.has(pdv.ragioneSociale)) {
        processedRS.add(pdv.ragioneSociale);
        result[pdv.id] = attivatoProtectaByRS[pdv.ragioneSociale] ?? createEmptyProtectaAttivato();
      }
    });
    return result;
  };

  // Ottieni dati effettivi (da ByPos o da ByRS convertiti)
  const effectiveMobileData = getEffectiveMobileData();
  const effectiveFissoData = getEffectiveFissoData();
  const effectiveCBData = getEffectiveCBData();
  const effectiveEnergiaData = getEffectiveEnergiaData();
  const effectiveAssicurazioniData = getEffectiveAssicurazioniData();
  const effectiveProtectaData = getEffectiveProtectaData();

  const computedRSMap = useMemo(() => raggruppaPdvPerRS(puntiVendita), [puntiVendita]);

  const mobileResults = (() => {
    if (modalitaInserimentoRS === "per_rs") {
      const processedRS = new Set<string>();
      return puntiVendita.map((pdv) => {
        if (!pdv.codicePos) return null;
        const rs = pdv.ragioneSociale || "";
        if (processedRS.has(rs)) return null;
        processedRS.add(rs);
        
        const rsConf = pistaMobileRSConfig.sogliePerRS.find(
          s => s.ragioneSociale.trim().toLowerCase() === rs.trim().toLowerCase()
        );
        if (!rsConf) return null;
        
        const pdvListForRS = computedRSMap.get(rs) || [];
        const computedSoglie = getDefaultSoglieMobileRS(pdvListForRS);
        
        const conf: PistaMobilePosConfig = {
          posCode: pdv.codicePos,
          soglia1: computedSoglie.soglia1,
          soglia2: computedSoglie.soglia2,
          soglia3: computedSoglie.soglia3,
          soglia4: computedSoglie.soglia4,
          multiplierSoglia1: 1,
          multiplierSoglia2: 1.2,
          multiplierSoglia3: 1.5,
          multiplierSoglia4: 2,
          canoneMedio: rsConf.canoneMedio,
          forecastTargetPunti: computedSoglie.forecastTargetPunti,
        };
        
        const righe = attivatoMobileByRS[rs] ?? [];
        const workdayInfoOverride = getWorkdayInfoFromOverrides(
          configGara.annoGara,
          configGara.meseGara - 1,
          pdv.calendar,
          calendarioOverrides[pdv.id]
        );
        
        const result = calcolaPremioPistaMobilePerPos({
          configPos: conf,
          dettaglio: righe,
          calendar: pdv.calendar,
          year: configGara.annoGara,
          month: configGara.meseGara - 1,
          mobileCategories,
          workdayInfoOverride,
        });
        return { pdv, conf, righe, result };
      }).filter(Boolean) as any[];
    }
    
    return puntiVendita.map((pdv, index) => {
      const conf = pistaMobileConfig.sogliePerPos[index];
      if (!conf || !pdv.codicePos) return null;
      const righe = effectiveMobileData[pdv.id] ?? [];
      
      const workdayInfoOverride = getWorkdayInfoFromOverrides(
        configGara.annoGara,
        configGara.meseGara - 1,
        pdv.calendar,
        calendarioOverrides[pdv.id]
      );
      
      const result = calcolaPremioPistaMobilePerPos({ 
        configPos: conf, 
        dettaglio: righe, 
        calendar: pdv.calendar, 
        year: configGara.annoGara, 
        month: configGara.meseGara - 1, 
        mobileCategories,
        workdayInfoOverride,
      });
      return { pdv, conf, righe, result };
    }).filter(Boolean) as any[];
  })();

  const totalePremioMobile = mobileResults.reduce((acc, r) => acc + r.result.premio + r.result.extraGettoniEuro, 0);

  // Calcolo risultati FISSO
  const fissoResults = (() => {
    if (modalitaInserimentoRS === "per_rs") {
      const processedRS = new Set<string>();
      return puntiVendita.map((pdv) => {
        if (!pdv.codicePos || !pdv.clusterFisso) return null;
        const rs = pdv.ragioneSociale || "";
        if (processedRS.has(rs)) return null;
        processedRS.add(rs);
        
        const rsConf = pistaFissoRSConfig.sogliePerRS.find(
          s => s.ragioneSociale.trim().toLowerCase() === rs.trim().toLowerCase()
        );
        if (!rsConf) return null;
        
        const pdvListForFissoRS = computedRSMap.get(rs) || [];
        const computedFissoSoglie = getDefaultSoglieFissoRS(pdvListForFissoRS);
        
        const conf: PistaFissoPosConfig = {
          posCode: pdv.codicePos,
          soglia1: computedFissoSoglie.soglia1,
          soglia2: computedFissoSoglie.soglia2,
          soglia3: computedFissoSoglie.soglia3,
          soglia4: computedFissoSoglie.soglia4,
          soglia5: computedFissoSoglie.soglia5 ?? 0,
          multiplierSoglia1: 2,
          multiplierSoglia2: 3,
          multiplierSoglia3: 3.5,
          multiplierSoglia4: 4,
          multiplierSoglia5: 5,
          forecastTargetPunti: computedFissoSoglie.forecastTargetPunti,
        };
        
        const righe = attivatoFissoByRS[rs] ?? [];
        const clusterNum = mapClusterFissoToNumber(pdv.clusterFisso);
        const workdayInfoOverride = getWorkdayInfoFromOverrides(
          configGara.annoGara,
          configGara.meseGara - 1,
          pdv.calendar,
          calendarioOverrides[pdv.id]
        );
        
        const result = calcolaPremioPistaFissoPerPos({
          annoGara: configGara.annoGara,
          meseGara: configGara.meseGara,
          calendar: pdv.calendar,
          clusterFisso: clusterNum,
          posCode: pdv.codicePos,
          pistaConfig: conf,
          attivato: righe,
          workdayInfoOverride,
          gettoniContrattualiOverride: tabelleCalcoloConfig?.fisso?.gettoniContrattuali,
        });
        return { pdv, conf, righe, result };
      }).filter(Boolean) as any[];
    }
    
    return puntiVendita.map((pdv, index) => {
      const conf = pistaFissoConfig.sogliePerPos[index];
      if (!conf || !pdv.codicePos || !pdv.clusterFisso) return null;
      const righe = effectiveFissoData[pdv.id] ?? [];
      const clusterNum = mapClusterFissoToNumber(pdv.clusterFisso);
      
      const workdayInfoOverride = getWorkdayInfoFromOverrides(
        configGara.annoGara,
        configGara.meseGara - 1,
        pdv.calendar,
        calendarioOverrides[pdv.id]
      );
      
      const result = calcolaPremioPistaFissoPerPos({
        annoGara: configGara.annoGara,
        meseGara: configGara.meseGara,
        calendar: pdv.calendar,
        clusterFisso: clusterNum,
        posCode: pdv.codicePos,
        pistaConfig: conf,
        attivato: righe,
        workdayInfoOverride,
        gettoniContrattualiOverride: tabelleCalcoloConfig?.fisso?.gettoniContrattuali,
      });
      return { pdv, conf, righe, result };
    }).filter(Boolean) as any[];
  })();

  const totalePremioFisso = fissoResults.reduce((acc, r) => acc + r.result.premio, 0);

  // Calcolo risultati Partnership Reward
  const partnershipResults = puntiVendita.map((pdv, index) => {
    const conf = partnershipRewardConfig.configPerPos[index];
    if (!conf || !pdv.codicePos) return null;
    const attivato = effectiveCBData[pdv.id] ?? [];
    
    // Calcola giorni lavorativi per il run rate
    const workdayInfoOverride = getWorkdayInfoFromOverrides(
      configGara.annoGara,
      configGara.meseGara - 1,
      pdv.calendar,
      calendarioOverrides[pdv.id]
    );
    const giorniLavorativi = workdayInfoOverride?.totalWorkingDays || 22;
    
    const result = calcolaPartnershipRewardPerPos({
      posCode: pdv.codicePos,
      config: conf,
      attivato,
      giorniLavorativi,
    });
    return { pdv, conf, result };
  }).filter(Boolean) as any[];

  const totalePremioPartnershipPrevisto = partnershipResults.reduce((acc, r) => acc + r.result.premioMaturato, 0);

  // Mappa conteggio PDV per Ragione Sociale (per pista energia)
  const pdvCountPerRS: Record<string, number> = {};
  puntiVendita.forEach(pdv => {
    const rs = pdv.ragioneSociale || "Senza RS";
    pdvCountPerRS[rs] = (pdvCountPerRS[rs] || 0) + 1;
  });

  // Calcolo risultati Energia
  const energiaResults = puntiVendita.map((pdv) => {
    if (!pdv.codicePos) return null;
    const attivato = effectiveEnergiaData[pdv.id] ?? [];
    const pdvGara = energiaPdvInGara.find((p) => p.pdvId === pdv.id);
    const isNegozioInGara = pdvGara?.isInGara || false;
    const rsName = pdv.ragioneSociale || "Senza RS";
    const numPdvRS = pdvCountPerRS[rsName] || 1;
    
    const result = calcoloEnergiaPerPos({
      posCode: pdv.codicePos,
      attivato,
      config: energiaConfig,
      pdvInGaraList: energiaPdvInGara,
      isNegozioInGara,
      numPdv: numPdvRS,
      compensiBaseOverride: tabelleCalcoloConfig?.energia?.compensiBase,
    });
    return result;
  }).filter(Boolean) as any[];

  // In RS mode, ricalcola premio soglia + pista energia con target moltiplicati per n° PDV della RS
  const totalePremioEnergia = (() => {
    if (modalitaInserimentoRS !== "per_rs") {
      return energiaResults.reduce((acc: number, r: any) => acc + r.premioTotale, 0);
    }
    const premioBaseGlobale = energiaResults.reduce((acc: number, r: any) => acc + r.premioBase + r.bonusRaggiungimentoSoglia, 0);
    let premioSogliaGlobale = 0;
    let bonusPistaGlobale = 0;
    const rsGroups: Record<string, number> = {};
    puntiVendita.forEach(pdv => {
      const rs = pdv.ragioneSociale || "Senza RS";
      rsGroups[rs] = (rsGroups[rs] || 0) + 1;
    });
    Object.entries(rsGroups).forEach(([rs, numPdv]) => {
      const righe = attivatoEnergiaByRS[rs] ?? [];
      const totalPezzi = righe.reduce((s, r) => s + r.pezzi, 0);
      const effectiveS1 = (energiaConfig.targetS1 || 0) * numPdv;
      const effectiveS2 = (energiaConfig.targetS2 || 0) * numPdv;
      const effectiveS3 = (energiaConfig.targetS3 || 0) * numPdv;
      if (effectiveS3 > 0 && totalPezzi >= effectiveS3) {
        premioSogliaGlobale += 1000;
      } else if (effectiveS2 > 0 && totalPezzi >= effectiveS2) {
        premioSogliaGlobale += 500;
      } else if (effectiveS1 > 0 && totalPezzi >= effectiveS1) {
        premioSogliaGlobale += 250;
      }
      const pista = calcolaBonusPistaEnergiaFn(totalPezzi, energiaConfig, numPdv);
      bonusPistaGlobale += pista.bonusTotale;
    });
    return premioBaseGlobale + premioSogliaGlobale + bonusPistaGlobale;
  })();

  // Calcolo risultati Assicurazioni
  const assicurazioniResults = calcoloAssicurazioniPerPos(
    puntiVendita,
    assicurazioniConfig,
    assicurazioniPdvInGara,
    effectiveAssicurazioniData,
    tabelleCalcoloConfig?.assicurazioni?.puntiProdotto,
    tabelleCalcoloConfig?.assicurazioni?.premiProdotto,
  );

  // In RS mode, ricalcola bonus soglia con target moltiplicati per n° PDV della RS
  const totalePremioAssicurazioni = (() => {
    if (modalitaInserimentoRS !== "per_rs") {
      return assicurazioniResults.reduce((acc: number, r: any) => acc + r.premioTotale, 0);
    }
    const premioBaseGlobale = assicurazioniResults.reduce((acc: number, r: any) => acc + r.premioBase, 0);
    let bonusSogliaGlobale = 0;
    const rsGroups: Record<string, number> = {};
    puntiVendita.forEach(pdv => {
      const rs = pdv.ragioneSociale || "Senza RS";
      rsGroups[rs] = (rsGroups[rs] || 0) + 1;
    });
    Object.entries(rsGroups).forEach(([rs, numPdv]) => {
      const attivato = attivatoAssicurazioniByRS[rs] ?? createEmptyAssicurazioniAttivato();
      const prodottiStandard: (keyof typeof ASSICURAZIONI_POINTS)[] = [
        'protezionePro', 'casaFamigliaFull', 'casaFamigliaPlus', 'casaFamigliaStart',
        'sportFamiglia', 'sportIndividuale', 'viaggiVacanze', 'elettrodomestici', 'micioFido',
      ];
      let puntiBase = 0;
      for (const prodotto of prodottiStandard) {
        puntiBase += (attivato[prodotto] || 0) * ASSICURAZIONI_POINTS[prodotto];
      }
      if (attivato.viaggioMondoPremio > 0) {
        puntiBase += (attivato.viaggioMondoPremio / 100) * 1.5;
      }
      const effectiveS1 = (assicurazioniConfig.targetS1 || 0) * numPdv;
      const effectiveS2 = (assicurazioniConfig.targetS2 || 0) * numPdv;
      // Reload Forever: solo dopo S1, max 15%
      let puntiConReload = puntiBase;
      if (puntiBase >= effectiveS1 && attivato.reloadForever > 0) {
        const puntiReloadRaw = Math.floor(attivato.reloadForever / 5);
        const maxReload = Math.floor(puntiBase * 0.15 / 0.85);
        puntiConReload = puntiBase + Math.min(puntiReloadRaw, maxReload);
      }
      if (puntiBase >= effectiveS1) bonusSogliaGlobale += 500;
      if (puntiConReload >= effectiveS2) bonusSogliaGlobale += 750;
    });
    return premioBaseGlobale + bonusSogliaGlobale;
  })();

  // Calcolo risultati Protecta
  const protectaResults = calcolaProtecta(
    effectiveProtectaData,
    puntiVendita,
    tabelleCalcoloConfig?.protecta?.gettoniProdotto,
  );
  const totalePremioProtecta = calcolaTotaleProtecta(protectaResults);

  // Calcolo risultati Extra IVA (usa gli stessi dati effettivi già calcolati sopra)
  const extraGaraIvaResults = calcolaExtraGaraIva({
    puntiVendita,
    attivatoMobileByPos: effectiveMobileData,
    attivatoFissoByPos: effectiveFissoData,
    attivatoEnergiaByPos: effectiveEnergiaData,
    attivatoAssicurazioniByPos: effectiveAssicurazioniData,
    attivatoProtectaByPos: effectiveProtectaData,
    configOverrides: tabelleCalcoloConfig?.extraGara ? {
      puntiAttivazione: tabelleCalcoloConfig.extraGara.puntiAttivazione,
      soglieMultipos: tabelleCalcoloConfig.extraGara.soglieMultipos,
      soglieMonopos: tabelleCalcoloConfig.extraGara.soglieMonopos,
      premiPerSoglia: tabelleCalcoloConfig.extraGara.premiPerSoglia,
    } : undefined,
    soglieOverridePerRS: Object.keys(extraGaraSoglieOverride).length > 0 ? extraGaraSoglieOverride : undefined,
  });
  const totalePremioExtraGaraIva = calcolaTotaleExtraGaraIva(extraGaraIvaResults);

  // Numero totale step (dinamico)
  const TOTAL_STEPS = getTotalSteps(configGara.tipologiaGara || "gara_operatore");
  
  // Validazione step corrente
  const isCurrentStepValid = (): boolean => {
    if (step === 1) {
      // Step 2: verifica che ci sia almeno un PDV e che tutti abbiano i campi obbligatori
      if (numeroPdv === 0) return false;
      return puntiVendita.every(pdv => 
        pdv.codicePos.trim() !== "" && 
        pdv.nome.trim() !== "" && 
        pdv.ragioneSociale.trim() !== ""
      );
    }
    if (step === 2) {
      // Step 3: verifica che tutti i PDV abbiano i cluster selezionati
      return puntiVendita.every(pdv => 
        pdv.clusterMobile !== "" && 
        pdv.clusterFisso !== "" && 
        pdv.clusterCB !== "" &&
        pdv.clusterPIva !== ""
      );
    }
    // Step 6 per gara_operatore_rs: scelta modalità obbligatoria
    if (step === 6 && configGara.tipologiaGara === "gara_operatore_rs") {
      return modalitaInserimentoRS !== null;
    }
    return true;
  };

  // Funzione per preparare i dati da salvare
  const buildPreventivoData = () => ({
    step,
    configGara,
    numeroPdv,
    puntiVendita,
    pistaMobileConfig,
    pistaFissoConfig,
    partnershipRewardConfig,
    mobileCategories,
    attivatoMobileByPos,
    attivatoFissoByPos,
    attivatoCBByPos,
    calendarioOverrides,
    energiaConfig,
    energiaPdvInGara,
    attivatoEnergiaByPos,
    assicurazioniConfig,
    assicurazioniPdvInGara,
    attivatoAssicurazioniByPos,
    attivatoProtectaByPos,
    // Dati RS
    modalitaInserimentoRS,
    pistaMobileRSConfig,
    pistaFissoRSConfig,
    partnershipRewardRSConfig,
    attivatoMobileByRS,
    attivatoFissoByRS,
    attivatoCBByRS,
    attivatoEnergiaByRS,
    attivatoAssicurazioniByRS,
    attivatoProtectaByRS,
    // Salva anche i risultati calcolati per la dashboard
    risultatoMobile: {
      perPos: mobileResults.map(r => ({
        pdvCodice: r.pdv.codicePos,
        pdvNome: r.pdv.nome,
        posCode: r.pdv.codicePos,
        premio: r.result.premio + r.result.extraGettoniEuro,
        punti: r.result.punti,
        attivazioniTotali: r.righe.reduce((sum: number, riga: { pezzi?: number }) => sum + (riga.pezzi || 0), 0),
        soglia: r.result.soglia,
        runRateGiornalieroPunti: r.result.runRateGiornalieroPunti,
      })),
      totale: totalePremioMobile,
    },
    risultatoFisso: {
      perPos: fissoResults.map(r => ({
        pdvCodice: r.pdv.codicePos,
        pdvNome: r.pdv.nome,
        posCode: r.pdv.codicePos,
        premio: r.result.premio,
        punti: r.result.punti,
        attivazioniTotali: r.righe.reduce((sum: number, riga: { pezzi?: number }) => sum + (riga.pezzi || 0), 0),
        soglia: r.result.soglia,
        runRateGiornalieroPunti: r.result.runRateGiornalieroPunti,
      })),
      totale: totalePremioFisso,
    },
    risultatoPartnership: {
      totale: totalePremioPartnershipPrevisto,
    },
    risultatoEnergia: {
      totale: totalePremioEnergia,
    },
    risultatoAssicurazioni: {
      totalePremio: totalePremioAssicurazioni,
    },
    risultatoProtecta: {
      totalePremio: totalePremioProtecta,
    },
    risultatoExtraGaraIva: {
      totalePremio: totalePremioExtraGaraIva,
      perRs: extraGaraIvaResults.map(rs => ({
        ragioneSociale: rs.ragioneSociale,
        puntiTotali: rs.puntiTotaliRS,
        sogliaRaggiunta: rs.sogliaRaggiunta,
        premioTotale: rs.premioTotaleRS,
      })),
    },
  });

  // Funzione per salvare il preventivo
  const handleSavePreventivo = async () => {
    if (!preventivoName.trim()) {
      toast({
        title: "Errore",
        description: "Inserisci un nome per il preventivo",
        variant: "destructive",
      });
      return;
    }

    setIsSaving(true);
    const data = buildPreventivoData();

    let result;
    if (currentPreventivoId) {
      result = await updatePreventivo(currentPreventivoId, preventivoName, data as any);
    } else {
      result = await createPreventivo(preventivoName, data as any);
    }

    setIsSaving(false);

    if (result.error) {
      toast({
        title: "Errore",
        description: result.error,
        variant: "destructive",
      });
    } else {
      if (!currentPreventivoId && result.data) {
        setCurrentPreventivoId(result.data.id);
      }
      toast({
        title: "Preventivo salvato",
        description: `"${preventivoName}" salvato con successo`,
      });
      setSaveDialogOpen(false);
    }
  };

  // Funzione per gestire il click su "Fine"
  const handleFinish = () => {
    // Prepopola il nome se vuoto
    if (!preventivoName && configGara.nomeGara) {
      setPreventivoName(`${configGara.nomeGara} - ${configGara.meseGara}/${configGara.annoGara}`);
    }
    setSaveDialogOpen(true);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/30 flex flex-col">
      {/* Modern Header */}
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-2 sm:px-4 py-2 sm:py-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={() => setLocation('/preventivatore?new=true')}
              title="Nuova simulazione"
              data-testid="button-home"
            >
              <Home className="h-5 w-5" />
            </Button>
            <h1 className="text-base sm:text-xl font-bold text-foreground truncate" data-testid="text-header-title">
              Incentive W3
            </h1>
          </div>
          <div className="flex items-center gap-2">
            {(configGara.nomeGara || activeConfigName) && (
              <span className="hidden sm:inline text-sm font-medium text-muted-foreground truncate max-w-[250px]" data-testid="text-active-config" title={configGara.nomeGara || activeConfigName || ""}>
                {configGara.nomeGara || activeConfigName}
              </span>
            )}
            <Button 
              variant="outline"
              size="sm"
              onClick={() => {
                fetchSavedConfigs();
                setLoadConfigDialogOpen(true);
              }}
              data-testid="button-load-config"
            >
              <FolderOpen className="h-4 w-4" />
              <span className="hidden sm:inline ml-1">Carica</span>
            </Button>
            <Button 
              variant="secondary"
              size="sm"
              onClick={() => {
                setConfigName(activeConfigName || "");
                fetchSavedConfigs();
                setSaveConfigDialogOpen(true);
              }}
              data-testid="button-save-config"
            >
              <Save className="h-4 w-4" />
              <span className="hidden sm:inline ml-1">Salva</span>
            </Button>
            <UserMenu />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 container mx-auto px-2 sm:px-4 py-3 sm:py-6">
        <div className="grid lg:grid-cols-[1fr,320px] gap-4 sm:gap-6">
          {/* Main Wizard Card */}
          <Card className="shadow-lg border-border/50 overflow-hidden">
            {/* Wizard Header with Progress */}
            <div className="p-3 sm:p-6 border-b bg-gradient-to-r from-card to-muted/20">
              <WizardHeader 
                currentStep={step}
                totalSteps={TOTAL_STEPS}
                nomeGara={configGara.nomeGara}
                preventivoName={preventivoName}
                currentPreventivoId={currentPreventivoId}
                onStepClick={(targetStep) => {
                  // Blocca navigazione oltre step 6 se modalità non selezionata (solo per gara_operatore_rs)
                  if (configGara.tipologiaGara === "gara_operatore_rs" && modalitaInserimentoRS === null && targetStep > 6) {
                    toast({
                      title: "Seleziona modalità",
                      description: "Devi prima scegliere come inserire i dati di produzione",
                      variant: "destructive",
                    });
                    return;
                  }
                  setStep(targetStep);
                }}
                isGaraOperatoreRS={configGara.tipologiaGara === "gara_operatore_rs"}
                disabledStepsAfter={configGara.tipologiaGara === "gara_operatore_rs" && modalitaInserimentoRS === null ? 6 : undefined}
              />
            </div>
            
            {/* Step Content */}
            <CardContent className="p-3 sm:p-6 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 260px)', minHeight: '300px' }}>
              <div className="animate-fade-in">
                {step === 0 && <StepLetteraGara configGara={configGara} setConfigGara={setConfigGara} />}
                {step === 1 && <StepPuntiVendita numeroPdv={numeroPdv} onNumeroPdvChange={handleNumeroPdvChange} puntiVendita={puntiVendita} updatePdvField={updatePdvField} ragioniSociali={ragioniSociali} onRagioniSocialiChange={setRagioniSociali} />}
                {step === 2 && <StepCluster puntiVendita={puntiVendita} updatePdvField={updatePdvField} />}
                {step === 3 && <StepCalendari puntiVendita={puntiVendita} annoGara={configGara.annoGara} meseGara={configGara.meseGara} updatePdvField={updatePdvField} />}
                {step === 4 && <StepCalendarioMese puntiVendita={puntiVendita} anno={configGara.annoGara} meseGara={configGara.meseGara} calendarioOverrides={calendarioOverrides} onCalendarioOverridesChange={setCalendarioOverrides} />}
                {step === 5 && (
                  configGara.tipologiaGara === "gara_operatore_rs" ? (
                    <StepConfigPisteRS 
                      puntiVendita={puntiVendita} 
                      pistaMobileRSConfig={pistaMobileRSConfig}
                      pistaFissoRSConfig={pistaFissoRSConfig}
                      partnershipRewardConfig={partnershipRewardConfig}
                      partnershipRewardRSConfig={partnershipRewardRSConfig}
                      setPistaMobileRSConfig={setPistaMobileRSConfig}
                      setPistaFissoRSConfig={setPistaFissoRSConfig}
                      setPartnershipRewardRSConfig={setPartnershipRewardRSConfig}
                    />
                  ) : configGara.tipologiaGara === "gara_addetto" ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                      <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
                        <span className="text-2xl">🚧</span>
                      </div>
                      <h3 className="text-lg font-semibold text-foreground mb-2">Gara addetto</h3>
                      <p className="text-sm text-muted-foreground max-w-md">
                        Questa tipologia di gara sarà disponibile in una versione futura del simulatore.
                      </p>
                    </div>
                  ) : (
                    <StepConfigPiste puntiVendita={puntiVendita} pistaMobileConfig={pistaMobileConfig} pistaFissoConfig={pistaFissoConfig} partnershipRewardConfig={partnershipRewardConfig} updateMobileField={updatePistaMobilePosField} updateFissoField={updatePistaFissoPosField} updatePartnershipField={updatePartnershipRewardField} />
                  )
                )}
                {/* Step 6: per gara_operatore_rs mostra SEMPRE la scelta modalità, altrimenti Mobile */}
                {step === 6 && (
                  configGara.tipologiaGara === "gara_operatore_rs" ? (
                    <StepSceltaModalitaRS
                      modalita={modalitaInserimentoRS}
                      onModalitaChange={setModalitaInserimentoRS}
                      numRagioneSociale={Array.from(new Set(puntiVendita.map(p => p.ragioneSociale).filter(Boolean))).length}
                      numPdv={puntiVendita.length}
                    />
                  ) : (
                    <StepAttivatoMobile puntiVendita={puntiVendita} pistaConfig={pistaMobileConfig} anno={configGara.annoGara} monthIndex={configGara.meseGara - 1} attivatoMobileByPos={attivatoMobileByPos} setAttivatoMobileByPos={setAttivatoMobileByPos} mobileResults={mobileResults} totalePremioMobilePrevisto={totalePremioMobile} />
                  )
                )}
                {/* Step 7+ per gara_operatore_rs: gli step KPI sono shiftati di 1 */}
                {configGara.tipologiaGara === "gara_operatore_rs" ? (
                  <>
                    {step === 7 && (
                      modalitaInserimentoRS === "per_rs" ? (
                        <StepAttivatoMobileRS 
                          puntiVendita={puntiVendita} 
                          pistaMobileRSConfig={pistaMobileRSConfig}
                          anno={configGara.annoGara} 
                          monthIndex={configGara.meseGara - 1} 
                          attivatoMobileByRS={attivatoMobileByRS} 
                          setAttivatoMobileByRS={setAttivatoMobileByRS} 
                          totalePremioMobilePrevisto={totalePremioMobile} 
                        />
                      ) : (
                        <StepAttivatoMobile puntiVendita={puntiVendita} pistaConfig={pistaMobileConfig} anno={configGara.annoGara} monthIndex={configGara.meseGara - 1} attivatoMobileByPos={attivatoMobileByPos} setAttivatoMobileByPos={setAttivatoMobileByPos} mobileResults={mobileResults} totalePremioMobilePrevisto={totalePremioMobile} />
                      )
                    )}
                    {step === 8 && (
                      modalitaInserimentoRS === "per_rs" ? (
                        <StepAttivatoFissoRS 
                          puntiVendita={puntiVendita} 
                          pistaFissoRSConfig={pistaFissoRSConfig}
                          anno={configGara.annoGara} 
                          monthIndex={configGara.meseGara - 1} 
                          attivatoFissoByRS={attivatoFissoByRS} 
                          setAttivatoFissoByRS={setAttivatoFissoByRS} 
                          totalePremioFissoPrevisto={totalePremioFisso} 
                        />
                      ) : (
                        <StepAttivatoFisso puntiVendita={puntiVendita} pistaFissoConfig={pistaFissoConfig} anno={configGara.annoGara} monthIndex={configGara.meseGara - 1} attivatoFissoByPos={attivatoFissoByPos} setAttivatoFissoByPos={setAttivatoFissoByPos} fissoResults={fissoResults} totalePremioFissoPrevisto={totalePremioFisso} />
                      )
                    )}
                    {step === 9 && (
                      modalitaInserimentoRS === "per_rs" ? (
                        <StepPartnershipRewardRS 
                          puntiVendita={puntiVendita} 
                          partnershipRewardRSConfig={partnershipRewardRSConfig}
                          attivatoCBByRS={attivatoCBByRS} 
                          setAttivatoCBByRS={setAttivatoCBByRS} 
                          totalePremioPartnershipPrevisto={totalePremioPartnershipPrevisto} 
                        />
                      ) : (
                        <StepPartnershipReward puntiVendita={puntiVendita} partnershipRewardConfig={partnershipRewardConfig} attivatoCBByPos={attivatoCBByPos} setAttivatoCBByPos={setAttivatoCBByPos} partnershipResults={partnershipResults} totalePremioPartnershipPrevisto={totalePremioPartnershipPrevisto} anno={configGara.annoGara} monthIndex={configGara.meseGara - 1} />
                      )
                    )}
                    {step === 10 && (
                      modalitaInserimentoRS === "per_rs" ? (
                        <StepEnergiaRS 
                          puntiVendita={puntiVendita} 
                          energiaConfig={energiaConfig}
                          setEnergiaConfig={setEnergiaConfig}
                          attivatoEnergiaByRS={attivatoEnergiaByRS} 
                          setAttivatoEnergiaByRS={setAttivatoEnergiaByRS} 
                          totalePremioEnergia={totalePremioEnergia} 
                        />
                      ) : (
                        <StepEnergia puntiVendita={puntiVendita} energiaConfig={energiaConfig} setEnergiaConfig={setEnergiaConfig} energiaPdvInGara={energiaPdvInGara} setEnergiaPdvInGara={setEnergiaPdvInGara} attivatoEnergiaByPos={attivatoEnergiaByPos} setAttivatoEnergiaByPos={setAttivatoEnergiaByPos} energiaResults={energiaResults} totalePremioEnergia={totalePremioEnergia} />
                      )
                    )}
                    {step === 11 && (
                      modalitaInserimentoRS === "per_rs" ? (
                        <StepAssicurazioniRS 
                          puntiVendita={puntiVendita} 
                          config={assicurazioniConfig}
                          onConfigChange={setAssicurazioniConfig}
                          attivatoByRS={attivatoAssicurazioniByRS} 
                          setAttivatoByRS={setAttivatoAssicurazioniByRS} 
                          totalePremio={totalePremioAssicurazioni} 
                        />
                      ) : (
                        <StepAssicurazioni config={assicurazioniConfig} onConfigChange={setAssicurazioniConfig} pdvInGara={assicurazioniPdvInGara} onPdvInGaraChange={setAssicurazioniPdvInGara} puntiVendita={puntiVendita} attivatoByPos={attivatoAssicurazioniByPos} onAttivatoChange={(posId, attivato) => setAttivatoAssicurazioniByPos(prev => ({ ...prev, [posId]: attivato }))} results={assicurazioniResults} totalePremio={totalePremioAssicurazioni} />
                      )
                    )}
                    {step === 12 && (
                      modalitaInserimentoRS === "per_rs" ? (
                        <StepProtectaRS 
                          puntiVendita={puntiVendita} 
                          attivatoByRS={attivatoProtectaByRS} 
                          setAttivatoByRS={setAttivatoProtectaByRS} 
                          totalePremio={totalePremioProtecta} 
                        />
                      ) : (
                        <StepProtecta puntiVendita={puntiVendita} attivatoByPos={attivatoProtectaByPos} setAttivatoByPos={setAttivatoProtectaByPos} results={protectaResults} totalePremio={totalePremioProtecta} />
                      )
                    )}
                    {step === 13 && <StepExtraGaraIva results={extraGaraIvaResults} totalePremio={totalePremioExtraGaraIva} modalitaInserimentoRS={modalitaInserimentoRS} puntiVendita={puntiVendita} soglieOverride={extraGaraSoglieOverride} onSoglieOverrideChange={setExtraGaraSoglieOverride} tabelleCalcoloConfig={tabelleCalcoloConfig} />}
                  </>
                ) : (
                  <>
                    {step === 7 && <StepAttivatoFisso puntiVendita={puntiVendita} pistaFissoConfig={pistaFissoConfig} anno={configGara.annoGara} monthIndex={configGara.meseGara - 1} attivatoFissoByPos={attivatoFissoByPos} setAttivatoFissoByPos={setAttivatoFissoByPos} fissoResults={fissoResults} totalePremioFissoPrevisto={totalePremioFisso} />}
                    {step === 8 && <StepPartnershipReward puntiVendita={puntiVendita} partnershipRewardConfig={partnershipRewardConfig} attivatoCBByPos={attivatoCBByPos} setAttivatoCBByPos={setAttivatoCBByPos} partnershipResults={partnershipResults} totalePremioPartnershipPrevisto={totalePremioPartnershipPrevisto} anno={configGara.annoGara} monthIndex={configGara.meseGara - 1} />}
                    {step === 9 && <StepEnergia puntiVendita={puntiVendita} energiaConfig={energiaConfig} setEnergiaConfig={setEnergiaConfig} energiaPdvInGara={energiaPdvInGara} setEnergiaPdvInGara={setEnergiaPdvInGara} attivatoEnergiaByPos={attivatoEnergiaByPos} setAttivatoEnergiaByPos={setAttivatoEnergiaByPos} energiaResults={energiaResults} totalePremioEnergia={totalePremioEnergia} />}
                    {step === 10 && <StepAssicurazioni config={assicurazioniConfig} onConfigChange={setAssicurazioniConfig} pdvInGara={assicurazioniPdvInGara} onPdvInGaraChange={setAssicurazioniPdvInGara} puntiVendita={puntiVendita} attivatoByPos={attivatoAssicurazioniByPos} onAttivatoChange={(posId, attivato) => setAttivatoAssicurazioniByPos(prev => ({ ...prev, [posId]: attivato }))} results={assicurazioniResults} totalePremio={totalePremioAssicurazioni} />}
                    {step === 11 && <StepProtecta puntiVendita={puntiVendita} attivatoByPos={attivatoProtectaByPos} setAttivatoByPos={setAttivatoProtectaByPos} results={protectaResults} totalePremio={totalePremioProtecta} />}
                    {step === 12 && <StepExtraGaraIva results={extraGaraIvaResults} totalePremio={totalePremioExtraGaraIva} modalitaInserimentoRS={modalitaInserimentoRS} puntiVendita={puntiVendita} soglieOverride={extraGaraSoglieOverride} onSoglieOverrideChange={setExtraGaraSoglieOverride} tabelleCalcoloConfig={tabelleCalcoloConfig} />}
                  </>
                )}
              </div>
            </CardContent>

            {/* Navigation Footer */}
            <CardFooter className="p-2 sm:p-4 border-t bg-muted/30 flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-2">
              <div className="flex gap-2">
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => setStep(Math.max(step - 1, 0))} 
                  disabled={step === 0}
                  className="gap-1 sm:gap-2"
                >
                  <ChevronLeft className="h-4 w-4" />
                  <span className="hidden sm:inline">Indietro</span>
                </Button>
                {step === 0 && (
                  <Button 
                    variant="ghost" 
                    size="sm"
                    onClick={() => {
                      // Salva la configurazione prima di resettare i volumi
                      saveConfig({
                        configGara,
                        numeroPdv,
                        puntiVendita,
                        pistaMobileConfig,
                        pistaFissoConfig,
                        partnershipRewardConfig,
                        calendarioOverrides,
                        energiaConfig,
                        energiaPdvInGara,
                        assicurazioniConfig,
                        assicurazioniPdvInGara,
                        pistaMobileRSConfig,
                        pistaFissoRSConfig,
                        partnershipRewardRSConfig,
                        modalitaInserimentoRS,
                        extraGaraSoglieOverride: Object.keys(extraGaraSoglieOverride).length > 0 ? extraGaraSoglieOverride : undefined,
                        configVersion: '2.0',
                      });
                      
                      // Resetta solo i volumi (attivato), mantiene la configurazione
                      setAttivatoMobileByPos({});
                      setAttivatoMobileByRS({}); // Reset volumi Mobile aggregati RS
                      setAttivatoFissoByPos({});
                      setAttivatoFissoByRS({}); // Reset volumi Fisso aggregati RS
                      setAttivatoCBByPos({});
                      setAttivatoCBByRS({}); // Reset volumi Partnership aggregati RS
                      setAttivatoEnergiaByPos({});
                      setAttivatoEnergiaByRS({}); // Reset volumi Energia aggregati RS
                      setAttivatoAssicurazioniByPos({});
                      setAttivatoAssicurazioniByRS({}); // Reset volumi Assicurazioni aggregati RS
                      setAttivatoProtectaByPos({});
                      setAttivatoProtectaByRS({}); // Reset volumi Protecta aggregati RS
                      setModalitaInserimentoRS(null); // Resetta la scelta modalità per nuova simulazione
                      clearState(); // Pulisce lo stato completo
                      setCurrentPreventivoId(null);
                      setPreventivoName("");
                      setStep(6); // Vai direttamente allo step Attivato Mobile
                      
                      toast({
                        title: "Nuova simulazione",
                        description: "Volumi azzerati. PDV, cluster, calendari e soglie mantenuti.",
                      });
                    }}
                    className="gap-2"
                  >
                    <RefreshCw className="h-4 w-4" />
                    Nuova Simulazione
                  </Button>
                )}
              </div>
              <div className="flex gap-2 flex-wrap justify-end">
                {currentPreventivoId && (
                  <Button 
                    variant="outline"
                    onClick={() => {
                      setPreventivoName(preventivoName || `${configGara.nomeGara} - ${configGara.meseGara}/${configGara.annoGara}`);
                      setSaveDialogOpen(true);
                    }}
                    className="gap-2"
                  >
                    <Save className="h-4 w-4" />
                    Salva
                  </Button>
                )}
                {step === TOTAL_STEPS - 1 ? (
                  <Button size="sm" onClick={handleFinish} className="gap-1 sm:gap-2 bg-gradient-to-r from-primary to-accent">
                    <Save className="h-4 w-4" />
                    <span className="hidden sm:inline">Salva Preventivo</span>
                    <span className="sm:hidden">Salva</span>
                  </Button>
                ) : (
                  <Button 
                    size="sm"
                    onClick={() => setStep(Math.min(step + 1, TOTAL_STEPS - 1))}
                    disabled={!isCurrentStepValid()}
                    className="gap-1 sm:gap-2"
                  >
                    Avanti
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </CardFooter>
          </Card>

          {/* Sidebar Summary (visible on larger screens) */}
          <div className="hidden lg:block space-y-4">
            <WizardSummaryCard
              premioMobile={totalePremioMobile}
              premioFisso={totalePremioFisso}
              premioPartnership={totalePremioPartnershipPrevisto}
              premioEnergia={totalePremioEnergia}
              premioAssicurazioni={totalePremioAssicurazioni}
              premioProtecta={totalePremioProtecta}
              premioExtraGaraIva={totalePremioExtraGaraIva}
              currentStep={step}
              tipologiaGara={configGara.tipologiaGara}
            />
            
            {/* Quick Info Card */}
            <Card className="border-border/50">
              <CardContent className="p-4 space-y-3">
                <h4 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Info Gara</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Periodo:</span>
                    <span className="font-medium">{configGara.meseGara}/{configGara.annoGara}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Tipo:</span>
                    <span className="font-medium capitalize">{configGara.tipoPeriodo}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">PDV:</span>
                    <span className="font-medium">{numeroPdv}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Dialog per salvare il preventivo */}
      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{currentPreventivoId ? "Aggiorna Preventivo" : "Salva Preventivo"}</DialogTitle>
            <DialogDescription>
              {currentPreventivoId 
                ? "Aggiorna il preventivo esistente o salvalo con un nuovo nome" 
                : "Inserisci un nome per salvare il preventivo"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="preventivo-name">Nome preventivo</Label>
              <Input
                id="preventivo-name"
                value={preventivoName}
                onChange={(e) => setPreventivoName(e.target.value)}
                placeholder="Es. Gara Gennaio 2024"
              />
            </div>
            <div className="p-4 bg-muted/50 rounded-lg space-y-2">
              <p className="text-sm font-medium">Riepilogo premi:</p>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <span className="text-muted-foreground">Mobile:</span>
                <span className="font-medium">{new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(totalePremioMobile)}</span>
                <span className="text-muted-foreground">Fisso:</span>
                <span className="font-medium">{new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(totalePremioFisso)}</span>
                <span className="text-muted-foreground">CB+ Partnership Reward:</span>
                <span className="font-medium">{new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(totalePremioPartnershipPrevisto)}</span>
                <span className="text-muted-foreground">Energia:</span>
                <span className="font-medium">{new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(totalePremioEnergia)}</span>
                <span className="text-muted-foreground">Assicurazioni:</span>
                <span className="font-medium">{new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(totalePremioAssicurazioni)}</span>
                <span className="text-muted-foreground">Protecta:</span>
                <span className="font-medium">{new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(totalePremioProtecta)}</span>
                <span className="text-muted-foreground">Extra Gara P.IVA:</span>
                <span className="font-medium">{new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(totalePremioExtraGaraIva)}</span>
                <span className="text-muted-foreground font-semibold border-t pt-2">Totale:</span>
                <span className="font-bold text-primary border-t pt-2">
                  {new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(
                    totalePremioMobile + totalePremioFisso + totalePremioPartnershipPrevisto + totalePremioEnergia + totalePremioAssicurazioni + totalePremioProtecta + totalePremioExtraGaraIva
                  )}
                </span>
              </div>
            </div>
            <Button onClick={handleSavePreventivo} className="w-full" disabled={isSaving}>
              {isSaving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Salvataggio...
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  {currentPreventivoId ? "Aggiorna" : "Salva"}
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Save Configuration Dialog */}
      <Dialog open={saveConfigDialogOpen} onOpenChange={(open) => {
        setSaveConfigDialogOpen(open);
        if (!open) setSaveMode(null);
      }}>
        <DialogContent className="sm:max-w-md">
          {activeConfigId && !saveMode ? (
            <>
              <DialogHeader>
                <DialogTitle>Salva Configurazione</DialogTitle>
                <DialogDescription>
                  Hai una configurazione attiva: "{activeConfigName}". Cosa vuoi fare?
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-3 py-2">
                <Button
                  variant="outline"
                  className="justify-start gap-3 h-auto py-3"
                  onClick={() => {
                    setSaveMode('overwrite');
                    setConfigName(activeConfigName || "");
                  }}
                  data-testid="button-overwrite-config"
                >
                  <Save className="h-5 w-5 shrink-0" />
                  <div className="text-left">
                    <div className="font-medium">Sovrascrivi "{activeConfigName}"</div>
                    <div className="text-xs text-muted-foreground font-normal">Aggiorna la configurazione esistente</div>
                  </div>
                </Button>
                <Button
                  variant="outline"
                  className="justify-start gap-3 h-auto py-3"
                  onClick={() => {
                    setSaveMode('new');
                    setConfigName("");
                  }}
                  data-testid="button-create-new-config"
                >
                  <FilePlus className="h-5 w-5 shrink-0" />
                  <div className="text-left">
                    <div className="font-medium">Crea nuova configurazione</div>
                    <div className="text-xs text-muted-foreground font-normal">Salva con un nuovo nome</div>
                  </div>
                </Button>
              </div>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>{saveMode === 'overwrite' ? "Sovrascrivi Configurazione" : "Nuova Configurazione"}</DialogTitle>
                <DialogDescription>
                  {saveMode === 'overwrite'
                    ? `Stai aggiornando "${activeConfigName}". Puoi anche modificare il nome.`
                    : "Inserisci un nome per questa configurazione PDV. Potrai caricarla in futuro."}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="config-name">Nome configurazione</Label>
                  <Input
                    id="config-name"
                    value={configName}
                    onChange={(e) => setConfigName(e.target.value)}
                    placeholder="Es. Configurazione Gennaio 2025"
                    data-testid="input-config-name"
                  />
                  {configName.trim() && savedConfigs.some(c => 
                    c.name.toLowerCase() === configName.trim().toLowerCase() && 
                    (saveMode === 'new' || !activeConfigId ? true : c.id !== activeConfigId)
                  ) && (
                    <p className="text-sm text-destructive">Esiste già una configurazione con questo nome.</p>
                  )}
                </div>
                <div className="p-3 bg-muted/50 rounded-lg">
                  <p className="text-sm text-muted-foreground">
                    Questa configurazione include: {numeroPdv} PDV, soglie mobile/fisso, calendari, partnership, energia, assicurazioni.
                  </p>
                </div>
              </div>
              <DialogFooter className="gap-2 sm:gap-0">
                {activeConfigId && (
                  <Button variant="ghost" size="sm" onClick={() => setSaveMode(null)} data-testid="button-back-save-choice">
                    <ArrowLeft className="mr-1 h-4 w-4" />
                    Indietro
                  </Button>
                )}
                <Button 
                  onClick={() => handleSaveConfig(saveMode === 'new')}
                  disabled={isSavingConfig || !configName.trim() || savedConfigs.some(c => 
                    c.name.toLowerCase() === configName.trim().toLowerCase() && 
                    (saveMode === 'new' || !activeConfigId ? true : c.id !== activeConfigId)
                  )}
                  data-testid="button-confirm-save-config"
                >
                  {isSavingConfig ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Salvataggio...</>
                  ) : (
                    <><Save className="mr-2 h-4 w-4" />{saveMode === 'overwrite' ? "Aggiorna" : "Salva"}</>
                  )}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Load Configuration Dialog */}
      <Dialog open={loadConfigDialogOpen} onOpenChange={setLoadConfigDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Carica Configurazione</DialogTitle>
            <DialogDescription>
              Seleziona una configurazione salvata in precedenza. I dati attuali verranno sostituiti.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {loadingConfigs ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                {backendConfig && (
                  <Card className={`${!activeConfigId ? 'ring-2 ring-primary' : ''} border-dashed`}>
                    <CardContent className="p-3 flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-sm" data-testid="text-config-backend">Configurazione Attuale (Backend)</p>
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {backendConfig.updatedAt ? new Date(backendConfig.updatedAt).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'N/A'}
                          {backendConfig.config?.numeroPdv && <span className="ml-2">{backendConfig.config.numeroPdv} PDV</span>}
                        </p>
                      </div>
                      <Button 
                        size="sm" 
                        variant="outline"
                        onClick={handleLoadBackendConfig}
                        data-testid="button-load-backend-config"
                      >
                        Ripristina
                      </Button>
                    </CardContent>
                  </Card>
                )}
                {savedConfigs.length === 0 && !backendConfig ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <FolderOpen className="h-10 w-10 mx-auto mb-3 opacity-50" />
                    <p className="text-sm">Nessuna configurazione salvata.</p>
                    <p className="text-xs mt-1">Usa il pulsante "Salva" nell'header per salvare una configurazione con nome.</p>
                  </div>
                ) : (
                  savedConfigs.map((cfg) => (
                    <Card key={cfg.id} className={`${cfg.id === activeConfigId ? 'ring-2 ring-primary' : ''}`}>
                      <CardContent className="p-3 flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-sm truncate" data-testid={`text-config-name-${cfg.id}`}>{cfg.name}</p>
                          <p className="text-xs text-muted-foreground flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {cfg.updatedAt ? new Date(cfg.updatedAt).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'N/A'}
                            {cfg.id === activeConfigId && <span className="ml-2 text-primary font-medium">(attiva)</span>}
                          </p>
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <Button 
                            size="sm" 
                            onClick={() => handleLoadConfig(cfg.id)}
                            data-testid={`button-load-config-${cfg.id}`}
                          >
                            Carica
                          </Button>
                          <Button 
                            size="icon" 
                            variant="ghost" 
                            onClick={() => handleDeleteConfig(cfg.id, cfg.name)}
                            data-testid={`button-delete-config-${cfg.id}`}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))
                )}
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Preventivatore;
