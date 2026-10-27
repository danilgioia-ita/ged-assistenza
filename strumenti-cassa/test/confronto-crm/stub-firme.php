<?php
namespace App\Services\Firme;

/** Al posto del disco privato del CRM: le firme dello scenario stanno in una cartella di prova. */
class Firme
{
    public static function byte(string $percorso): ?string
    {
        $f = $GLOBALS['cartella_firme'] . '/' . $percorso;

        return is_file($f) ? file_get_contents($f) : null;
    }

    public static function esiste(string $percorso): bool
    {
        return is_file($GLOBALS['cartella_firme'] . '/' . $percorso);
    }
}
