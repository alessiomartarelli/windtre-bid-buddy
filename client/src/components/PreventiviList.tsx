import { useState } from 'react';
import { useLocation } from 'wouter';
import { Preventivo } from '@/hooks/usePreventivi';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Edit, Trash2, FileText, FileSpreadsheet, Eye, Download } from 'lucide-react';
import { format } from 'date-fns';
import { it } from 'date-fns/locale';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';

interface PreventiviListProps {
  preventivi: Preventivo[];
  onDelete: (id: string) => Promise<{ error?: string; success?: boolean }>;
  loading?: boolean;
}

const formatCurrency = (value: number) => {
  return new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(value);
};

const extractPreventivoData = (preventivo: Preventivo) => {
  const data = preventivo.data as Record<string, unknown>;
  
  const puntiVendita = (data?.puntiVendita as Array<{ nome?: string; codice?: string }>) || [];
  const pdvInGara = (data?.pdvInGara as Array<{ nome?: string; codice?: string }>) || puntiVendita;
  
  // Extract results
  const risultatoMobile = data?.risultatoMobile as Record<string, unknown> | undefined;
  const risultatoFisso = data?.risultatoFisso as Record<string, unknown> | undefined;
  const risultatoEnergia = data?.risultatoEnergia as Record<string, unknown> | undefined;
  const risultatoAssicurazioni = data?.risultatoAssicurazioni as Record<string, unknown> | undefined;
  const risultatoPartnership = data?.risultatoPartnership as Record<string, unknown> | undefined;
  const risultatoProtecta = data?.risultatoProtecta as Record<string, unknown> | undefined;
  const risultatoExtraGaraIva = data?.risultatoExtraGaraIva as Record<string, unknown> | undefined;

  let premioMobile = 0;
  let premioFisso = 0;
  let premioEnergia = 0;
  let premioAssicurazioni = 0;
  let premioPartnership = 0;
  let premioProtecta = 0;
  let premioExtraGaraIva = 0;
  let puntiMobile = 0;
  let puntiFisso = 0;
  let volumiMobile = 0;
  let volumiFisso = 0;

  // Mobile - support both "premio" and legacy "premioPrevistoFineMese"
  if (risultatoMobile && typeof risultatoMobile === 'object') {
    // Try reading totale first
    if (typeof risultatoMobile.totale === 'number') {
      premioMobile = risultatoMobile.totale;
    } else {
      const posList = risultatoMobile.perPos as Array<{
        premio?: number;
        premioPrevistoFineMese?: number;
        punti?: number;
        puntiPrevistiFineMese?: number;
        attivazioniTotali?: number;
      }> | undefined;
      if (Array.isArray(posList)) {
        posList.forEach((pos) => {
          premioMobile += pos.premio || pos.premioPrevistoFineMese || 0;
          puntiMobile += pos.punti || pos.puntiPrevistiFineMese || 0;
          volumiMobile += pos.attivazioniTotali || 0;
        });
      }
    }
  }

  // Fisso - support both "premio" and legacy "premioPrevistoFineMese"
  if (risultatoFisso && typeof risultatoFisso === 'object') {
    if (typeof risultatoFisso.totale === 'number') {
      premioFisso = risultatoFisso.totale;
    } else {
      const posList = risultatoFisso.perPos as Array<{
        premio?: number;
        premioPrevistoFineMese?: number;
        punti?: number;
        puntiPrevistiFineMese?: number;
        attivazioniTotali?: number;
      }> | undefined;
      if (Array.isArray(posList)) {
        posList.forEach((pos) => {
          premioFisso += pos.premio || pos.premioPrevistoFineMese || 0;
          puntiFisso += pos.punti || pos.puntiPrevistiFineMese || 0;
          volumiFisso += pos.attivazioniTotali || 0;
        });
      }
    }
  }

  // Energia
  if (risultatoEnergia && typeof risultatoEnergia === 'object') {
    premioEnergia = (risultatoEnergia.totale as number) || 0;
  }

  // Assicurazioni
  if (risultatoAssicurazioni && typeof risultatoAssicurazioni === 'object') {
    premioAssicurazioni = (risultatoAssicurazioni.totalePremio as number) || 0;
  }

  // Partnership
  if (risultatoPartnership && typeof risultatoPartnership === 'object') {
    premioPartnership = (risultatoPartnership.totale as number) || 0;
  }

  // Protecta
  if (risultatoProtecta && typeof risultatoProtecta === 'object') {
    premioProtecta = (risultatoProtecta.totalePremio as number) || 0;
  }

  // Extra Gara IVA
  if (risultatoExtraGaraIva && typeof risultatoExtraGaraIva === 'object') {
    premioExtraGaraIva = (risultatoExtraGaraIva.totalePremio as number) || 0;
  }

  const totale = premioMobile + premioFisso + premioEnergia + premioAssicurazioni + premioPartnership + premioProtecta + premioExtraGaraIva;

  return {
    pdvCount: pdvInGara.length || puntiVendita.length,
    premioMobile,
    premioFisso,
    premioEnergia,
    premioAssicurazioni,
    premioPartnership,
    premioProtecta,
    premioExtraGaraIva,
    totale,
    puntiMobile,
    puntiFisso,
    volumiMobile,
    volumiFisso,
    data,
  };
};

const generatePDF = (preventivo: Preventivo) => {
  const extracted = extractPreventivoData(preventivo);
  const data = extracted.data;
  
  const doc = new jsPDF();
  
  // Header
  doc.setFontSize(20);
  doc.setTextColor(40, 40, 40);
  doc.text('Preventivo', 14, 22);
  
  doc.setFontSize(12);
  doc.setTextColor(100, 100, 100);
  doc.text(preventivo.name, 14, 30);
  doc.text(`Data: ${format(new Date(preventivo.created_at), 'dd MMMM yyyy', { locale: it })}`, 14, 36);
  
  // Config gara
  const configGara = data?.configGara as { nomeGara?: string; meseGara?: number; annoGara?: number } | undefined;
  if (configGara) {
    doc.setFontSize(14);
    doc.setTextColor(40, 40, 40);
    doc.text('Configurazione Gara', 14, 50);
    
    autoTable(doc, {
      startY: 55,
      head: [['Campo', 'Valore']],
      body: [
        ['Nome Gara', configGara.nomeGara || '-'],
        ['Mese', `${configGara.meseGara}/${configGara.annoGara}`],
        ['Numero PDV', String(extracted.pdvCount)],
      ],
      theme: 'striped',
      headStyles: { fillColor: [59, 130, 246] },
    });
  }
  
  // Riepilogo economics
  let currentY = (doc as any).lastAutoTable?.finalY || 80;
  currentY += 15;
  
  doc.setFontSize(14);
  doc.text('Riepilogo Economico', 14, currentY);
  
  autoTable(doc, {
    startY: currentY + 5,
    head: [['Categoria', 'Premio']],
    body: [
      ['Mobile', formatCurrency(extracted.premioMobile)],
      ['Fisso', formatCurrency(extracted.premioFisso)],
      ['CB+ Partnership Reward', formatCurrency(extracted.premioPartnership)],
      ['Energia', formatCurrency(extracted.premioEnergia)],
      ['Assicurazioni', formatCurrency(extracted.premioAssicurazioni)],
      ['Protecta', formatCurrency(extracted.premioProtecta)],
      ['Extra Gara P.IVA', formatCurrency(extracted.premioExtraGaraIva)],
      ['TOTALE', formatCurrency(extracted.totale)],
    ],
    theme: 'striped',
    headStyles: { fillColor: [59, 130, 246] },
    footStyles: { fontStyle: 'bold' },
  });
  
  // Riepilogo volumi e punti
  currentY = (doc as any).lastAutoTable?.finalY || currentY + 50;
  currentY += 15;
  
  doc.setFontSize(14);
  doc.text('Volumi e Punti', 14, currentY);
  
  autoTable(doc, {
    startY: currentY + 5,
    head: [['Categoria', 'Volumi', 'Punti']],
    body: [
      ['Mobile', String(extracted.volumiMobile), String(Math.round(extracted.puntiMobile))],
      ['Fisso', String(extracted.volumiFisso), String(Math.round(extracted.puntiFisso))],
    ],
    theme: 'striped',
    headStyles: { fillColor: [59, 130, 246] },
  });
  
  // Dettaglio per PdV (if available)
  const risultatoMobile = data?.risultatoMobile as { totale?: number; perPos?: Array<{ pdvCodice?: string; pdvNome?: string; premio?: number; punti?: number; premioPrevistoFineMese?: number; puntiPrevistiFineMese?: number }> } | undefined;
  const risultatoFisso = data?.risultatoFisso as { totale?: number; perPos?: Array<{ pdvCodice?: string; pdvNome?: string; premio?: number; punti?: number; premioPrevistoFineMese?: number; puntiPrevistiFineMese?: number }> } | undefined;
  
  if (risultatoMobile?.perPos && risultatoMobile.perPos.length > 0) {
    currentY = (doc as any).lastAutoTable?.finalY || currentY + 50;
    currentY += 15;
    
    if (currentY > 250) {
      doc.addPage();
      currentY = 20;
    }
    
    doc.setFontSize(14);
    doc.text('Dettaglio Mobile per PDV', 14, currentY);
    
    autoTable(doc, {
      startY: currentY + 5,
      head: [['Codice', 'Nome', 'Premio', 'Punti']],
      body: risultatoMobile.perPos.map((pos) => [
        pos.pdvCodice || '-',
        pos.pdvNome || '-',
        formatCurrency(pos.premio || pos.premioPrevistoFineMese || 0),
        String(Math.round(pos.punti || pos.puntiPrevistiFineMese || 0)),
      ]),
      theme: 'striped',
      headStyles: { fillColor: [59, 130, 246] },
    });
  }
  
  if (risultatoFisso?.perPos && risultatoFisso.perPos.length > 0) {
    currentY = (doc as any).lastAutoTable?.finalY || currentY + 50;
    currentY += 15;
    
    if (currentY > 250) {
      doc.addPage();
      currentY = 20;
    }
    
    doc.setFontSize(14);
    doc.text('Dettaglio Fisso per PDV', 14, currentY);
    
    autoTable(doc, {
      startY: currentY + 5,
      head: [['Codice', 'Nome', 'Premio', 'Punti']],
      body: risultatoFisso.perPos.map((pos) => [
        pos.pdvCodice || '-',
        pos.pdvNome || '-',
        formatCurrency(pos.premio || pos.premioPrevistoFineMese || 0),
        String(Math.round(pos.punti || pos.puntiPrevistiFineMese || 0)),
      ]),
      theme: 'striped',
      headStyles: { fillColor: [59, 130, 246] },
    });
  }
  
  doc.save(`preventivo_${preventivo.name.replace(/\s+/g, '_')}.pdf`);
};

const generateExcel = (preventivo: Preventivo) => {
  const extracted = extractPreventivoData(preventivo);
  const data = extracted.data;
  
  const workbook = XLSX.utils.book_new();
  
  // Sheet 1: Riepilogo
  const configGara = data?.configGara as { nomeGara?: string; meseGara?: number; annoGara?: number } | undefined;
  const riepilogoData = [
    ['Preventivo', preventivo.name],
    ['Data Creazione', format(new Date(preventivo.created_at), 'dd/MM/yyyy')],
    ['Nome Gara', configGara?.nomeGara || '-'],
    ['Periodo', `${configGara?.meseGara}/${configGara?.annoGara}`],
    ['Numero PDV', extracted.pdvCount],
    [],
    ['RIEPILOGO ECONOMICO'],
    ['Categoria', 'Premio'],
    ['Mobile', extracted.premioMobile],
    ['Fisso', extracted.premioFisso],
    ['CB+ Partnership Reward', extracted.premioPartnership],
    ['Energia', extracted.premioEnergia],
    ['Assicurazioni', extracted.premioAssicurazioni],
    ['Protecta', extracted.premioProtecta],
    ['Extra Gara P.IVA', extracted.premioExtraGaraIva],
    ['TOTALE', extracted.totale],
    [],
    ['VOLUMI E PUNTI'],
    ['Categoria', 'Volumi', 'Punti'],
    ['Mobile', extracted.volumiMobile, extracted.puntiMobile],
    ['Fisso', extracted.volumiFisso, extracted.puntiFisso],
  ];
  
  const wsRiepilogo = XLSX.utils.aoa_to_sheet(riepilogoData);
  XLSX.utils.book_append_sheet(workbook, wsRiepilogo, 'Riepilogo');
  
  // Sheet 2: Dettaglio Mobile per PdV
  const risultatoMobile = data?.risultatoMobile as { perPos?: Array<Record<string, unknown>> } | undefined;
  if (risultatoMobile?.perPos && risultatoMobile.perPos.length > 0) {
    const mobileData = [
      ['Codice PdV', 'Nome PdV', 'Attivazioni', 'Punti Attuali', 'Punti Previsti', 'Premio Attuale', 'Premio Previsto'],
      ...risultatoMobile.perPos.map((pos) => [
        pos.pdvCodice || '-',
        pos.pdvNome || '-',
        pos.attivazioniTotali || 0,
        pos.puntiAttuali || 0,
        pos.puntiPrevistiFineMese || 0,
        pos.premioAttuale || 0,
        pos.premioPrevistoFineMese || 0,
      ]),
    ];
    const wsMobile = XLSX.utils.aoa_to_sheet(mobileData);
    XLSX.utils.book_append_sheet(workbook, wsMobile, 'Dettaglio Mobile');
  }
  
  // Sheet 3: Volumi Mobile per Tipologia Attivazione
  const attivatoMobileByPos = data?.attivatoMobileByPos as Record<string, Array<{ type?: string; pezzi?: number }>> | undefined;
  if (attivatoMobileByPos && Object.keys(attivatoMobileByPos).length > 0) {
    // Collect all unique types
    const allTypes = new Set<string>();
    Object.values(attivatoMobileByPos).forEach((righe) => {
      if (Array.isArray(righe)) {
        righe.forEach((riga) => {
          if (riga.type) allTypes.add(riga.type);
        });
      }
    });
    const typesArray = Array.from(allTypes).sort();
    
    const mobileVolumiData: unknown[][] = [['Codice PdV', ...typesArray, 'Totale']];
    Object.entries(attivatoMobileByPos).forEach(([codice, righe]) => {
      const typeCount: Record<string, number> = {};
      let totale = 0;
      if (Array.isArray(righe)) {
        righe.forEach((riga) => {
          if (riga.type) {
            typeCount[riga.type] = (typeCount[riga.type] || 0) + (riga.pezzi || 0);
            totale += riga.pezzi || 0;
          }
        });
      }
      mobileVolumiData.push([
        codice,
        ...typesArray.map((t) => typeCount[t] || 0),
        totale,
      ]);
    });
    const wsMobileVolumi = XLSX.utils.aoa_to_sheet(mobileVolumiData);
    XLSX.utils.book_append_sheet(workbook, wsMobileVolumi, 'Volumi Mobile per Tipo');
  }
  
  // Sheet 4: Dettaglio Fisso per PdV
  const risultatoFisso = data?.risultatoFisso as { perPos?: Array<Record<string, unknown>> } | undefined;
  if (risultatoFisso?.perPos && risultatoFisso.perPos.length > 0) {
    const fissoData = [
      ['Codice PdV', 'Nome PdV', 'Attivazioni', 'Punti Attuali', 'Punti Previsti', 'Premio Attuale', 'Premio Previsto'],
      ...risultatoFisso.perPos.map((pos) => [
        pos.pdvCodice || '-',
        pos.pdvNome || '-',
        pos.attivazioniTotali || 0,
        pos.puntiAttuali || 0,
        pos.puntiPrevistiFineMese || 0,
        pos.premioAttuale || 0,
        pos.premioPrevistoFineMese || 0,
      ]),
    ];
    const wsFisso = XLSX.utils.aoa_to_sheet(fissoData);
    XLSX.utils.book_append_sheet(workbook, wsFisso, 'Dettaglio Fisso');
  }
  
  // Sheet 5: Volumi Fisso per Tipologia Attivazione
  const attivatoFissoByPos = data?.attivatoFissoByPos as Record<string, Array<{ type?: string; pezzi?: number }>> | undefined;
  if (attivatoFissoByPos && Object.keys(attivatoFissoByPos).length > 0) {
    // Collect all unique types
    const allTypes = new Set<string>();
    Object.values(attivatoFissoByPos).forEach((righe) => {
      if (Array.isArray(righe)) {
        righe.forEach((riga) => {
          if (riga.type) allTypes.add(riga.type);
        });
      }
    });
    const typesArray = Array.from(allTypes).sort();
    
    const fissoVolumiData: unknown[][] = [['Codice PdV', ...typesArray, 'Totale']];
    Object.entries(attivatoFissoByPos).forEach(([codice, righe]) => {
      const typeCount: Record<string, number> = {};
      let totale = 0;
      if (Array.isArray(righe)) {
        righe.forEach((riga) => {
          if (riga.type) {
            typeCount[riga.type] = (typeCount[riga.type] || 0) + (riga.pezzi || 0);
            totale += riga.pezzi || 0;
          }
        });
      }
      fissoVolumiData.push([
        codice,
        ...typesArray.map((t) => typeCount[t] || 0),
        totale,
      ]);
    });
    const wsFissoVolumi = XLSX.utils.aoa_to_sheet(fissoVolumiData);
    XLSX.utils.book_append_sheet(workbook, wsFissoVolumi, 'Volumi Fisso per Tipo');
  }
  
  // Sheet 6: CB+ Partnership - Punti e Premi per Target
  const risultatoPartnership = data?.risultatoPartnership as { dettagliPerPos?: Array<Record<string, unknown>> } | undefined;
  if (risultatoPartnership?.dettagliPerPos && risultatoPartnership.dettagliPerPos.length > 0) {
    const cbData = [
      ['Codice PdV', 'Target 100%', 'Target 80%', 'Punti Attuali', 'Premio Attuale', 'Punti Previsti', 'Premio Previsto'],
      ...risultatoPartnership.dettagliPerPos.map((pos) => [
        pos.pdvCodice || '-',
        pos.target100 || 0,
        pos.target80 || 0,
        pos.puntiAttuali || 0,
        pos.premioAttuale || 0,
        pos.puntiPrevisti || 0,
        pos.premioPrevisto || 0,
      ]),
    ];
    const wsCB = XLSX.utils.aoa_to_sheet(cbData);
    XLSX.utils.book_append_sheet(workbook, wsCB, 'CB+ Partnership');
  }
  
  // Sheet 7: Energia - Dettaglio e Target
  const energiaConfig = data?.energiaConfig as { targetNoMalus?: number; targetS1?: number; targetS2?: number; targetS3?: number } | undefined;
  const attivatoEnergiaByPos = data?.attivatoEnergiaByPos as Record<string, Array<Record<string, unknown>>> | undefined;
  const energiaRows: unknown[][] = [
    ['CONFIGURAZIONE ENERGIA'],
    ['Target No Malus', energiaConfig?.targetNoMalus || 0],
    ['Target S1', energiaConfig?.targetS1 || 0],
    ['Target S2', energiaConfig?.targetS2 || 0],
    ['Target S3', energiaConfig?.targetS3 || 0],
    [],
    ['DETTAGLIO ATTIVAZIONI'],
    ['Codice PdV', 'Tipo Contratto', 'Data'],
  ];
  if (attivatoEnergiaByPos && Object.keys(attivatoEnergiaByPos).length > 0) {
    Object.entries(attivatoEnergiaByPos).forEach(([codice, righe]) => {
      if (Array.isArray(righe)) {
        righe.forEach((riga) => {
          energiaRows.push([codice, riga.tipo || '-', riga.data || '-']);
        });
      }
    });
  }
  const wsEnergia = XLSX.utils.aoa_to_sheet(energiaRows);
  XLSX.utils.book_append_sheet(workbook, wsEnergia, 'Energia');
  
  // Sheet 8: Assicurazioni - Dettaglio e Target
  const assicurazioniConfig = data?.assicurazioniConfig as { targetNoMalus?: number; targetS1?: number; targetS2?: number } | undefined;
  const attivatoAssicurazioniByPos = data?.attivatoAssicurazioniByPos as Record<string, Record<string, unknown>> | undefined;
  const assicurazioniRows: unknown[][] = [
    ['CONFIGURAZIONE ASSICURAZIONI'],
    ['Target No Malus', assicurazioniConfig?.targetNoMalus || 0],
    ['Target S1', assicurazioniConfig?.targetS1 || 0],
    ['Target S2', assicurazioniConfig?.targetS2 || 0],
    [],
    ['DETTAGLIO ATTIVAZIONI'],
    ['Codice PdV', 'Vita', 'Danni', 'Totale'],
  ];
  if (attivatoAssicurazioniByPos && Object.keys(attivatoAssicurazioniByPos).length > 0) {
    Object.entries(attivatoAssicurazioniByPos).forEach(([codice, riga]) => {
      if (riga && typeof riga === 'object') {
        assicurazioniRows.push([codice, riga.vita || 0, riga.danni || 0, ((riga.vita as number) || 0) + ((riga.danni as number) || 0)]);
      }
    });
  }
  const wsAssicurazioni = XLSX.utils.aoa_to_sheet(assicurazioniRows);
  XLSX.utils.book_append_sheet(workbook, wsAssicurazioni, 'Assicurazioni');
  
  XLSX.writeFile(workbook, `preventivo_${preventivo.name.replace(/\s+/g, '_')}.xlsx`);
};

export function PreventiviList({ preventivi, onDelete, loading }: PreventiviListProps) {
  const [, setLocation] = useLocation();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [preventivoToDelete, setPreventivoToDelete] = useState<Preventivo | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleEdit = (preventivo: Preventivo) => {
    setLocation(`/preventivatore?id=${preventivo.id}`);
  };

  const handleDeleteClick = (preventivo: Preventivo) => {
    setPreventivoToDelete(preventivo);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!preventivoToDelete) return;
    
    setIsDeleting(true);
    const result = await onDelete(preventivoToDelete.id);
    setIsDeleting(false);
    
    if (!result.error) {
      setDeleteDialogOpen(false);
      setPreventivoToDelete(null);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Preventivi Salvati</CardTitle>
          <CardDescription>Caricamento in corso...</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (preventivi.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Preventivi Salvati</CardTitle>
          <CardDescription>Nessun preventivo salvato</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            <FileText className="mx-auto h-12 w-12 mb-4 opacity-50" />
            <p>Non hai ancora salvato nessun preventivo.</p>
            <Button className="mt-4" onClick={() => setLocation('/preventivatore?new=true')}>
              Crea il tuo primo preventivo
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Preventivi Salvati
          </CardTitle>
          <CardDescription>
            Visualizza, modifica o esporta i tuoi preventivi
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>PDV</TableHead>
                <TableHead>Totale</TableHead>
                <TableHead>Data</TableHead>
                <TableHead className="text-right">Azioni</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {preventivi.map((preventivo) => {
                const extracted = extractPreventivoData(preventivo);
                return (
                  <TableRow key={preventivo.id}>
                    <TableCell className="font-medium">{preventivo.name}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{extracted.pdvCount} PDV</Badge>
                    </TableCell>
                    <TableCell className="font-semibold text-primary">
                      {formatCurrency(extracted.totale)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {format(new Date(preventivo.updated_at), 'dd MMM yyyy', { locale: it })}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleEdit(preventivo)}
                          title="Modifica"
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => generatePDF(preventivo)}
                          title="Esporta PDF"
                        >
                          <FileText className="h-4 w-4 text-red-500" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => generateExcel(preventivo)}
                          title="Esporta Excel"
                        >
                          <FileSpreadsheet className="h-4 w-4 text-green-600" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDeleteClick(preventivo)}
                          title="Elimina"
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Conferma eliminazione</DialogTitle>
            <DialogDescription>
              Sei sicuro di voler eliminare il preventivo "{preventivoToDelete?.name}"?
              Questa azione non può essere annullata.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              Annulla
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteConfirm}
              disabled={isDeleting}
            >
              {isDeleting ? 'Eliminazione...' : 'Elimina'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
