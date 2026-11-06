#!/usr/bin/env python3
"""GED Assistance: mette lo schermo privacy di GED Service dentro WindowInjection.dll.

La "modalita' privacy" Modo 1 su Windows copre il monitor del cliente con una finestra in
primo piano disegnata da WindowInjection.dll (progetto aperto rustdesk-org/RustDeskTempTopMostWindow,
licenza MIT). L'immagine che quella finestra mostra NON si legge da un file: e' compilata
dentro la DLL come array C in WindowInjection/img.cpp (un PNG 1920x1080 con la scritta di
RustDesk). Qui, prima di compilare, si fanno due cose sul sorgente appena scaricato:

  1. img.cpp si rigenera dal NOSTRO PNG (stesso formato che produce il loro Img2Mem);
  2. in dllmain.cpp, OnPaintGdiPlus:
     - le bande ai lati, quando il monitor non e' 16:9 (16:10, 4:3, verticale), si
       riempiono col blu del bordo del nostro sfondo invece che di nero;
     - il ridimensionamento usa l'interpolazione bicubica di qualita': a 4K o a 1366x768
       i testi restano leggibili invece di sgranarsi.

Ogni ritocco cerca un pezzo di testo preciso e si FERMA con errore se non lo trova: se a
monte cambia il codice, il giro deve diventare rosso, non produrre in silenzio la DLL con
la scritta di RustDesk.

Uso: python prepara_windowinjection.py <cartella RustDeskTempTopMostWindow> <png>
"""
import struct
import sys
from pathlib import Path

# Colore medio del bordo di schermo-privacy-1920x1080.png (#0a172f): le bande si confondono
# con lo sfondo sfumato invece di sembrare un'immagine incollata su un fondo nero.
BANDE_RGB = (0x0A, 0x17, 0x2F)
LARGHEZZA, ALTEZZA = 1920, 1080  # PRIVACY_BITMAP_WIDTH/HEIGHT in dllmain.cpp


def ferma(msg: str) -> None:
    print(f"ERRORE: {msg}", file=sys.stderr)
    sys.exit(1)


def controlla_png(dati: bytes) -> None:
    if dati[:8] != b"\x89PNG\r\n\x1a\n" or dati[12:16] != b"IHDR":
        ferma("il file non e' un PNG")
    w, h = struct.unpack(">II", dati[16:24])
    # La DLL ridimensiona comunque a 1920x1080 al caricamento: un'altra misura si
    # deformerebbe in silenzio, quindi si rifiuta.
    if (w, h) != (LARGHEZZA, ALTEZZA):
        ferma(f"il PNG e' {w}x{h}, serve {LARGHEZZA}x{ALTEZZA}")


def scrivi_img_cpp(dati: bytes, dest: Path) -> None:
    righe = ['#include "pch.h"', '#include "./img.h"', "", "const unsigned char g_img[] = {"]
    for i in range(0, len(dati), 20):
        righe.append("".join(f"0x{b:02x}, " for b in dati[i : i + 20]))
    righe += ["};", "", "const long long g_imgLen = sizeof(g_img);", ""]
    dest.write_bytes("\r\n".join(righe).encode("ascii"))


def sostituisci(testo: str, vecchio: str, nuovo: str, cosa: str) -> str:
    n = testo.count(vecchio)
    if n != 1:
        ferma(f"{cosa}: atteso 1 punto in dllmain.cpp, trovati {n}")
    return testo.replace(vecchio, nuovo)


def ritocca_dllmain(path: Path) -> None:
    grezzo = path.read_bytes().decode("utf-8-sig")
    crlf = "\r\n" in grezzo
    testo = grezzo.replace("\r\n", "\n")
    r, g, b = BANDE_RGB
    testo = sostituisci(
        testo,
        "\t\tgraphics.Clear(Gdiplus::Color::Black);\n",
        f"\t\t// GED: bande del colore del bordo del nostro sfondo, non nere\n"
        f"\t\tgraphics.Clear(Gdiplus::Color(255, {r}, {g}, {b}));\n"
        "\t\t// GED: testi leggibili anche quando l'immagine si scala (4K, 1366x768)\n"
        "\t\tgraphics.SetInterpolationMode(Gdiplus::InterpolationModeHighQualityBicubic);\n"
        "\t\tgraphics.SetPixelOffsetMode(Gdiplus::PixelOffsetModeHighQuality);\n",
        "sfondo e interpolazione",
    )
    if crlf:
        testo = testo.replace("\n", "\r\n")
    path.write_bytes(testo.encode("utf-8"))


def main() -> None:
    if len(sys.argv) != 3:
        ferma(__doc__.strip().splitlines()[-1])
    radice, png = Path(sys.argv[1]), Path(sys.argv[2])
    dll = radice / "WindowInjection"
    for f in ("img.cpp", "dllmain.cpp"):
        if not (dll / f).is_file():
            ferma(f"manca {dll / f}")
    dati = png.read_bytes()
    controlla_png(dati)
    scrivi_img_cpp(dati, dll / "img.cpp")
    ritocca_dllmain(dll / "dllmain.cpp")
    # Prova che il nostro PNG e' davvero quello che finira' nella DLL.
    if f"0x{dati[-1]:02x}, \r\n}};".encode("ascii") not in (dll / "img.cpp").read_bytes():
        ferma("img.cpp non contiene il PNG appena scritto")
    print(f"OK: img.cpp dal nostro PNG ({len(dati)} byte), dllmain.cpp ritoccato")


if __name__ == "__main__":
    main()
