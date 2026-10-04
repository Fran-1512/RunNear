"""
Desnivel de carreras de trail que no lo publican en su web de inscripción, buscado en
las noticias de la Federación de Deportes de Montaña de Castilla-La Mancha (fdmcm.com,
WordPress: /wp-json/wp/v2/posts?search=...).

robots.txt de fdmcm.com: solo prohíbe zonas de administración (revisado 2026-10-04).

Para no equivocarse, un desnivel solo se acepta si la MISMA frase (o fila de tabla):
  - nombra la carrera (sus palabras distintivas), y
  - da una distancia que coincide con la de la carrera (±10 %), y
  - da un desnivel ("+1.700 m", "desnivel positivo de 900 m").
Así no se asigna a una prueba de iniciación el desnivel de la carrera principal.
"""

import html
import json
import re
import urllib.parse
from datetime import date, timedelta

from .comun import descargar_permitido, extraer_desnivel, normalizar
from .fusion import GENERICAS, es_subprueba, palabras

API = "https://fdmcm.com/wp-json/wp/v2/posts"
DIAS_VALIDEZ = 7


def _palabras_clave(nombre):
    clave = palabras(nombre) - GENERICAS - {"carrera", "edicion", "copa", "campeonato"}
    return sorted(clave, key=len, reverse=True)[:3]


def _trozos(contenido_html):
    """Frases y filas/celdas de tabla del contenido de una noticia."""
    texto = re.sub(r"</(p|li|tr|h\d|div)>|<br\s*/?>", "\n", contenido_html, flags=re.I)
    texto = html.unescape(re.sub(r"<[^>]+>", " ", texto))
    for linea in texto.split("\n"):
        linea = re.sub(r"\s+", " ", linea).strip()
        if not linea:
            continue
        for frase in re.split(r"(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚ])", linea):
            yield frase


def buscar_desnivel(carrera):
    distancias = carrera.get("distancias_km") or ([carrera["distancia_km"]] if carrera.get("distancia_km") else [])
    clave = _palabras_clave(carrera["nombre"])
    if not distancias or not clave or es_subprueba(carrera["nombre"]):
        return None
    necesarias = clave[:2] if len(clave) >= 2 else clave
    if len(necesarias) == 1 and len(necesarias[0]) < 6:
        return None  # una sola palabra corta es demasiado ambigua

    principal = max(distancias)  # el desnivel que se muestra es el de la distancia más larga

    def coincide_distancia(texto):
        kms = [float(x.replace(",", ".")) for x in re.findall(r"(\d+(?:[.,]\d+)?)\s*(?:km|kil[oó]metros)", texto, flags=re.I)]
        return any(abs(k - principal) <= 0.1 * principal for k in kms)

    url = f"{API}?search={urllib.parse.quote(' '.join(clave))}&per_page=5&_fields=title,content"
    for post in json.loads(descargar_permitido(url)):
        trozos = list(_trozos(post["content"]["rendered"]))
        titulo = normalizar(html.unescape(post["title"]["rendered"]))

        # A) Noticia dedicada a la carrera: líneas por distancia ("Ultra: 65 km · +3.174 m")
        if all(p in titulo for p in necesarias):
            for trozo in trozos:
                if coincide_distancia(trozo):
                    desnivel = extraer_desnivel(trozo)
                    if desnivel:
                        return desnivel

        # B) Frase o fila de tabla que nombra la carrera; en tablas, los km y el desnivel
        #    suelen ir en las 3 líneas siguientes al nombre
        for i, trozo in enumerate(trozos):
            if not all(p in normalizar(trozo) for p in necesarias):
                continue
            ventana = " · ".join(trozos[i:i + 4])
            if coincide_distancia(ventana):
                desnivel = extraer_desnivel(ventana)
                if desnivel:
                    return desnivel
    return None


def completar(carreras, cache):
    """Añade desnivel_positivo_m a las carreras de trail futuras que no lo tienen."""
    hoy = date.today().isoformat()
    limite = (date.today() - timedelta(days=DIAS_VALIDEZ)).isoformat()
    encontrados = 0
    for c in carreras:
        if c.get("tipo") != "trail" or c.get("desnivel_positivo_m") or c.get("fecha", "") < hoy:
            continue
        clave_cache = "fdmcm:" + c["id"]
        entrada = cache.get(clave_cache)
        if not entrada or entrada.get("consultado", "") < limite:
            try:
                entrada = {"consultado": hoy, "desnivel_positivo_m": buscar_desnivel(c)}
            except Exception as e:
                print(f"  [fdmcm] {c['nombre']}: {e}")
                continue
            cache[clave_cache] = entrada
        if entrada.get("desnivel_positivo_m"):
            c["desnivel_positivo_m"] = entrada["desnivel_positivo_m"]
            encontrados += 1
    print(f"  [fdmcm] desniveles encontrados en noticias de la federación: {encontrados}")
