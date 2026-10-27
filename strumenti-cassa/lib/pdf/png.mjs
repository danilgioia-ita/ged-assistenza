// Un decodificatore PNG minimo (zero dipendenze) per le firme: restituisce RGB e alfa a 8 bit come li otteneva il CRM da GD
// (`imagecreatefromstring` + `imagecolorsforindex`: l'alfa passa da 8 a 7 bit e torna a 8). JPEG e PNG interlacciati: null,
// e la firma resta una casella vuota da firmare a penna.
import zlib from 'node:zlib'

const CANALI = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }

export function decodificaPng(buf) {
  buf = Buffer.from(buf)
  if (buf.length < 33 || buf.readUInt32BE(0) !== 0x89504e47 || buf.readUInt32BE(4) !== 0x0d0a1a0a) return null
  let pos = 8, w = 0, h = 0, prof = 0, tipo = -1, interlaccia = 0
  let plte = null, trns = null
  const idat = []
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos); const nome = buf.toString('latin1', pos + 4, pos + 8)
    const dati = buf.subarray(pos + 8, pos + 8 + len)
    if (nome === 'IHDR') { w = dati.readUInt32BE(0); h = dati.readUInt32BE(4); prof = dati[8]; tipo = dati[9]; interlaccia = dati[12] }
    else if (nome === 'PLTE') plte = dati
    else if (nome === 'tRNS') trns = dati
    else if (nome === 'IDAT') idat.push(dati)
    else if (nome === 'IEND') break
    pos += 12 + len
  }
  if (!w || !h || interlaccia !== 0 || !(tipo in CANALI) || ![8, 16].includes(prof) || (tipo === 3 && prof !== 8) || w * h > 4_000_000) return null
  let grezzo
  try { grezzo = zlib.inflateSync(Buffer.concat(idat)) } catch { return null }
  const bpp = CANALI[tipo] * (prof / 8)
  const riga = w * bpp
  if (grezzo.length < (riga + 1) * h) return null
  const px = Buffer.alloc(riga * h)
  for (let y = 0; y < h; y++) {
    const f = grezzo[y * (riga + 1)]
    const src = y * (riga + 1) + 1
    for (let i = 0; i < riga; i++) {
      const x = grezzo[src + i]
      const a = i >= bpp ? px[y * riga + i - bpp] : 0
      const b = y > 0 ? px[(y - 1) * riga + i] : 0
      const c = i >= bpp && y > 0 ? px[(y - 1) * riga + i - bpp] : 0
      let v
      switch (f) {
        case 0: v = x; break
        case 1: v = x + a; break
        case 2: v = x + b; break
        case 3: v = x + ((a + b) >> 1); break
        case 4: { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); break }
        default: return null
      }
      px[y * riga + i] = v & 0xff
    }
  }
  const campione = (idx) => px[idx * (prof / 8)] // 16 bit: il byte alto
  const rgb = Buffer.alloc(w * h * 3)
  const alfa = Buffer.alloc(w * h)
  const aGd = (a8) => 255 - Math.round((127 - (a8 >> 1)) * 255 / 127) // come GD: 8 bit → 7 bit → 8 bit (come fa il CRM)
  for (let i = 0; i < w * h; i++) {
    let r, g, bl, a = 255
    const k = i * CANALI[tipo]
    if (tipo === 0) { r = g = bl = campione(k) }
    else if (tipo === 2) { r = campione(k); g = campione(k + 1); bl = campione(k + 2) }
    else if (tipo === 3) { const idx = px[i]; if (!plte || idx * 3 + 2 >= plte.length) return null; r = plte[idx * 3]; g = plte[idx * 3 + 1]; bl = plte[idx * 3 + 2]; if (trns && idx < trns.length) a = trns[idx] }
    else if (tipo === 4) { r = g = bl = campione(k); a = campione(k + 1) }
    else { r = campione(k); g = campione(k + 1); bl = campione(k + 2); a = campione(k + 3) }
    rgb[i * 3] = r; rgb[i * 3 + 1] = g; rgb[i * 3 + 2] = bl
    alfa[i] = tipo === 2 || tipo === 0 ? 255 : aGd(a)
  }
  return { larghezza: w, altezza: h, rgb, alfa }
}

/** Riduzione a una larghezza massima (media dei pixel): la firma a dito arriva anche a 1500 punti, sul modulo ne occupa 130. */
export function riduci(img, maxW) {
  if (img.larghezza <= maxW) return img
  const nw = maxW, nh = Math.max(1, Math.round(img.altezza * maxW / img.larghezza))
  const rgb = Buffer.alloc(nw * nh * 3), alfa = Buffer.alloc(nw * nh)
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
    const x0 = Math.floor(x * img.larghezza / nw), x1 = Math.max(x0 + 1, Math.floor((x + 1) * img.larghezza / nw))
    const y0 = Math.floor(y * img.altezza / nh), y1 = Math.max(y0 + 1, Math.floor((y + 1) * img.altezza / nh))
    let r = 0, g = 0, b = 0, a = 0, n = 0
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { const i = yy * img.larghezza + xx; r += img.rgb[i * 3]; g += img.rgb[i * 3 + 1]; b += img.rgb[i * 3 + 2]; a += img.alfa[i]; n++ }
    const o = y * nw + x
    rgb[o * 3] = Math.round(r / n); rgb[o * 3 + 1] = Math.round(g / n); rgb[o * 3 + 2] = Math.round(b / n); alfa[o] = Math.round(a / n)
  }
  return { larghezza: nw, altezza: nh, rgb, alfa }
}
