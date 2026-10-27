<?php
namespace App\Services\Verificazione;

/**
 * Il guscio di `CheckListUfficiale` per la prova: espone ai metodi di `ModuloUfficiale` esattamente i dati dello scenario,
 * senza database. La logica del modulo (coordinate, caselle, testo) e' quella VERA del CRM; qui c'e' solo il passaggio dei dati.
 */
final class CheckListUfficiale
{
    public const TIPI_SIGILLO = [
        'adesiva' => 'Targhetta adesiva (All. «A» Provv. AdE 06/05/2010)',
        'percussione' => 'Percussione (piombo/PVC)',
        'tamper' => 'Tamper',
    ];

    public function __construct(private array $s)
    {
    }

    public function modello(): string { return $this->s['modello']; }
    public function soloRapporto(): bool { return (bool) $this->s['soloRapporto']; }
    public function sigilloPresente(): ?string { return $this->s['sigilloPresente'] ?? null; }
    public function risposte(): array { return $this->s['risposte'] ?? []; }
    public function risposteSalvate(): array { return $this->s['risposteSalvate'] ?? []; }
    public function interventiRichiesti(): array { return $this->s['interventiRichiesti']; }
    public function areePubblicheDaCompilare(): bool { return (bool) ($this->s['areePubblicheDaCompilare'] ?? false); }

    /** @return array<string,string> nell'ordine dello scenario: l'ordine decide l'ordine delle crocette nel PDF */
    public function voci(): array
    {
        $out = [];
        foreach ($this->s['voci'] as [$numero, $valore]) {
            $out[(string) $numero] = $valore;
        }

        return $out;
    }

    public function dati(): array
    {
        $d = $this->s['dati'];
        if (! empty($d['contratto_fino_al'])) {
            $d['contratto_fino_al'] = new \DateTimeImmutable($d['contratto_fino_al']);
        } else {
            $d['contratto_fino_al'] = null;
        }

        return $d;
    }
}
