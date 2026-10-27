<?php
// GENERA, CON IL CODICE VERO DEL CRM, i PDF di confronto per gli Strumenti cassa.
//
//   php genera-crm.php <cartella crm-core> <cartella scenari> <cartella uscita> <cartella firme>
//
// Usa le classi ORIGINALI `ModuloUfficiale`, `ScrittorePdf` e `LettorePdf` del CRM, lette dal suo albero, senza cambiare una
// riga. Sostituisce solo cio' che legge il database (`CheckListUfficiale`, che qui e' un guscio dei dati dello scenario) e le firme
// su disco (`Firme`). Non tocca il CRM ne' la produzione. I PDF prodotti sono i «golden» che il test Node confronta byte per byte.
declare(strict_types=1);

[$_, $crm, $scenari, $uscita, $firme] = $argv + [null, null, null, null, null];
if (!$crm || !$scenari || !$uscita) { fwrite(STDERR, "uso: php genera-crm.php <crm-core> <scenari> <uscita> <firme>\n"); exit(2); }
error_reporting(E_ALL & ~E_DEPRECATED);

function resource_path(string $p = ''): string { global $crm; return $crm . '/resources' . ($p === '' ? '' : '/' . $p); }
function base_path(string $p = ''): string { global $crm; return $crm . ($p === '' ? '' : '/' . $p); }

require __DIR__ . '/stub-firme.php';
require __DIR__ . '/stub-checklist.php';
require $crm . '/app/Services/Verificazione/Pdf/LettorePdf.php';
require $crm . '/app/Services/Verificazione/Pdf/ScrittorePdf.php';
require $crm . '/app/Services/Verificazione/ModuloUfficiale.php';

use App\Services\Verificazione\CheckListUfficiale;
use App\Services\Verificazione\ModuloUfficiale;

@mkdir($uscita, 0777, true);
$GLOBALS['cartella_firme'] = $firme;
foreach (glob($scenari . '/*.json') as $file) {
    $s = json_decode(file_get_contents($file), true, 512, JSON_THROW_ON_ERROR);
    $m = new ModuloUfficiale();
    $pdf = $m->genera(new CheckListUfficiale($s));
    $nome = basename($file, '.json');
    file_put_contents("$uscita/$nome.pdf", $pdf);
    file_put_contents("$uscita/$nome.avvisi.json", json_encode($m->avvisi(), JSON_UNESCAPED_UNICODE));
    echo "$nome: " . strlen($pdf) . " byte\n";
}
