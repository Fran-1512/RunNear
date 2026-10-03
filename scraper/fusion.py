"""
Unión de carreras de varias fuentes sin duplicados.

Dos registros son la MISMA carrera si:
  - tienen la misma web de inscripción (y no es una página compartida por muchas), o
  - se celebran el mismo día (±1 día si los nombres se parecen mucho), en el mismo
    municipio (o con nombres casi idénticos en la misma provincia), con distancias
    compatibles y nombres parecidos.

El parecido de nombres compara las palabras significativas (sin "carrera", "popular",
números romanos, años...): "XXIX Media Maratón Ciudad de Albacete" = "Medio Maratón Albacete".

Al fusionar se conservan los datos de la fuente más fiable y se completan los huecos
con las demás (hora, desnivel, coordenadas exactas, circuito, web oficial...).
"""

import re
from collections import Counter, defaultdict
from datetime import date

from .comun import normalizar

# Palabras que no ayudan a distinguir una carrera de otra
PALABRAS_VACIAS = {
    "de", "del", "la", "las", "los", "el", "y", "e", "en", "a", "al", "por", "con", "para",
    "carrera", "carreras", "popular", "populares", "edicion", "prueba", "ciudad", "villa",
    "gran", "premio", "solidaria", "solidario", "running", "run", "race", "km", "k",
}
SINONIMOS = {"medio": "media", "maraton": "maraton", "cxm": "montana", "montana": "montana",
             "nocturna": "nocturna", "noche": "nocturna"}
ROMANO = re.compile(r"^[ivxlcdm]+$")

# Palabras de tipo de prueba: compartirlas no basta para decir que es la misma carrera
# si el pueblo no coincide ("San Silvestre Albacete" ≠ "San Silvestre Tarancón")
GENERICAS = {"san", "silvestre", "trail", "maraton", "media", "nocturna", "cross", "montana", "urban",
             "ultra", "benefica", "memorial", "subida", "vertical", "milla", "legua", "desafio", "copa",
             "circuito", "trofeo", "homenaje", "marcha", "ruta", "sierra", "rural", "5k", "10k", "21k",
             "sky", "skyrace", "km"}

# Marcas de prueba "hermana" dentro de un mismo evento (no es la misma carrera)
SUBPRUEBA = re.compile(r"\b(iniciacion|mini|infantil|infantiles|chupetin|menores|peques|kids|promocion)\b")
# "Marcha" o "senderista" solo indican otra prueba si el nombre no es también de carrera
SUBPRUEBA_SI_NO_CARRERA = re.compile(r"\b(marcha|senderista|andarines|caminata)\b")
ES_CARRERA = re.compile(r"\b(carrera|trail|cross|maraton|media|run|running|\d+ ?k)\b")

# Webs que agregan carreras: su enlace no es la web oficial de la carrera
AGREGADORES = ("running.life", "carrerasdemontana.com", "runnea.com", "carreraspopulares.com/carrera/")

# Campos que se completan desde otras fuentes si faltan
CAMPOS_COMPLEMENTARIOS = ["hora", "circuito", "estado", "precio_desde", "inscritos", "plazas_max"]


def es_carrera_a_pie(nombre):
    """Descarta duatlones, triatlones, BTT, pruebas de fitness, etc."""
    t = normalizar(nombre)
    return not re.search(r"duatl|triatl|acuatl|aquatl|\bbtt\b|ciclis|\bbici|\bmtb\b|\bdeka\b|hyrox|natacion|swimrun|stamina|\bbike\b|hybrid", t)


def palabras(nombre):
    resultado = set()
    for p in normalizar(nombre).split():
        p = SINONIMOS.get(p, p)
        if p in PALABRAS_VACIAS or ROMANO.match(p) or p.isdigit() or re.fullmatch(r"\d+[oa]", p) or len(p) < 2:
            continue
        resultado.add(p)
    return resultado


def _coinciden(p, q):
    """Misma palabra, o una empieza por la otra ("medic"/"medi", "socuellamos"/"socuellamo")."""
    return p == q or (min(len(p), len(q)) >= 4 and (p.startswith(q) or q.startswith(p)))


def _comunes(pa, pb):
    return {p for p in pa if any(_coinciden(p, q) for q in pb)}


def similitud(a, b):
    """Proporción de palabras compartidas respecto al nombre más corto (0..1)."""
    pa, pb = palabras(a), palabras(b)
    if not pa or not pb:
        return 0.0
    corto, largo = (pa, pb) if len(pa) <= len(pb) else (pb, pa)
    return len(_comunes(corto, largo)) / len(corto)


def mismo_municipio(a, b):
    na, nb = normalizar(a), normalizar(b)
    if not na or not nb:
        return False
    if na == nb:
        return True
    # "azuqueca" / "azuqueca de henares", "alcala del jucar" / "alcala jucar"
    corto, largo = sorted([na, nb], key=len)
    return len(corto) >= 4 and (largo.startswith(corto + " ") or set(corto.split()) <= set(largo.split()))


def _lista_km(c):
    return c.get("distancias_km") or ([c["distancia_km"]] if c.get("distancia_km") else [])


def distancias_compatibles(a, b, tolerancia=0.04):
    la, lb = _lista_km(a), _lista_km(b)
    if not la or not lb:
        return True
    return any(abs(x - y) <= max(0.6, tolerancia * max(x, y)) for x in la for y in lb)


def mismas_distancias(a, b):
    la, lb = sorted(_lista_km(a)), sorted(_lista_km(b))
    return len(la) == len(lb) and all(abs(x - y) <= 0.6 for x, y in zip(la, lb))


def palabras_distintivas_comunes(a, b):
    return _comunes(palabras(a), palabras(b)) - GENERICAS


def es_subprueba(nombre):
    t = normalizar(nombre)
    return bool(SUBPRUEBA.search(t)) or (bool(SUBPRUEBA_SI_NO_CARRERA.search(t)) and not ES_CARRERA.search(t))


def subpruebas_distintas(a, b):
    """True si solo uno de los dos nombres es de una prueba "hermana" (iniciación, infantil...)."""
    return es_subprueba(a) != es_subprueba(b)


def clave_url(url):
    u = (url or "").lower().strip()
    u = re.sub(r"^https?://(www\.)?", "", u).rstrip("/")
    return u


def es_agregador(url):
    return any(a in (url or "") for a in AGREGADORES)


def dias_entre(f1, f2):
    try:
        return abs((date.fromisoformat(f1) - date.fromisoformat(f2)).days)
    except (TypeError, ValueError):
        return 99


def puntuacion(existente, nueva, urls_compartidas):
    """0 si no son la misma carrera; cuanto mayor, más seguro."""
    ua, ub = clave_url(existente.get("url_oficial")), clave_url(nueva.get("url_oficial"))
    if ua and ua == ub and ua not in urls_compartidas and not es_agregador(ua):
        return 10.0
    # Dentro de una misma fuente, dos registros del mismo día y pueblo suelen ser carreras
    # distintas (p. ej. el 10K y la media maratón): solo se unen si comparten web
    nombre_a, nombre_b = existente["nombre"], nueva["nombre"]
    if subpruebas_distintas(nombre_a, nombre_b):
        return 0.0
    sim = similitud(nombre_a, nombre_b)
    municipio = mismo_municipio(existente.get("municipio"), nueva.get("municipio"))
    dias = dias_entre(existente["fecha"], nueva["fecha"])

    if existente["fuente"]["nombre"] == nueva["fuente"]["nombre"]:
        # Registro repetido en la propia fuente: mismo día y pueblo y, o bien el mismo
        # nombre exacto, o un nombre que contiene al otro con las mismas distancias
        mismo_nombre = normalizar(nombre_a) == normalizar(nombre_b)
        repetido = dias == 0 and municipio and (mismo_nombre or (sim >= 0.99 and mismas_distancias(existente, nueva)))
        return 10.0 if repetido else 0.0

    if dias > 1:
        return 0.0
    # Con nombres casi idénticos se admite más diferencia en la distancia publicada
    # (cada web redondea a su manera: 14 frente a 16 km, 26 frente a 28 km)
    if not distancias_compatibles(existente, nueva, 0.2 if sim >= 0.9 else 0.04):
        return 0.0

    if not municipio:
        # Pueblo distinto (errores de las fuentes): solo con nombre casi idéntico, el
        # mismo día y alguna palabra distintiva en común, no solo "San Silvestre"
        if not (dias == 0 and sim >= 0.9 and palabras_distintivas_comunes(nombre_a, nombre_b)):
            return 0.0
    umbral = 0.34 if dias == 0 else 0.6
    if existente.get("tipo") != nueva.get("tipo"):
        umbral = max(umbral, 0.6)
    if sim < umbral:
        return 0.0
    return sim + (0.5 if municipio else 0) + (0.3 if dias == 0 else 0)


def fusionar(existente, nueva):
    """Completa la carrera existente con lo que aporte la nueva."""
    fuentes = existente.setdefault("fuentes", [existente["fuente"]["nombre"]])
    if nueva["fuente"]["nombre"] not in fuentes:
        fuentes.append(nueva["fuente"]["nombre"])

    for campo in CAMPOS_COMPLEMENTARIOS:
        if not existente.get(campo) and nueva.get(campo):
            existente[campo] = nueva[campo]
    if existente.get("tipo") == "trail" and not existente.get("desnivel_positivo_m") and nueva.get("desnivel_positivo_m"):
        existente["desnivel_positivo_m"] = nueva["desnivel_positivo_m"]
    if not existente.get("distancias_km") and nueva.get("distancias_km"):
        existente["distancias_km"] = nueva["distancias_km"]
        existente["distancia_km"] = nueva.get("distancia_km")
    elif existente["fuente"]["nombre"] == nueva["fuente"]["nombre"] and nueva.get("distancias_km"):
        # Mismo registro repetido en una fuente con distintas distancias: se juntan
        juntas = sorted(set(existente["distancias_km"]) | set(nueva["distancias_km"]))
        existente["distancias_km"] = juntas
        existente["distancia_km"] = max(juntas)
    # Coordenadas exactas (Running.life) mejor que el centro del municipio, pero solo si
    # ambas fuentes coinciden en el pueblo: si no, el texto y el mapa se contradirían
    if nueva.get("ubicacion_exacta") and not existente.get("ubicacion_exacta") \
            and mismo_municipio(existente.get("municipio"), nueva.get("municipio")):
        existente["ubicacion"] = nueva["ubicacion"]
        existente["ubicacion_exacta"] = True
    # Web oficial mejor que la página de un agregador
    if (not existente.get("url_oficial") or es_agregador(existente["url_oficial"])) \
            and nueva.get("url_oficial") and not es_agregador(nueva["url_oficial"]):
        existente["url_oficial"] = nueva["url_oficial"]


def unir(listas_por_fuente):
    """
    listas_por_fuente: [(nombre_fuente, [carreras])] en orden de PRIORIDAD (la primera
    es la más fiable). Devuelve (carreras_unicas, estadisticas).
    """
    resultado = []
    por_fecha = defaultdict(list)
    estadisticas = {}

    for nombre_fuente, carreras in listas_por_fuente:
        # Enlaces que una misma fuente usa para varias carreras (p. ej. una reseña común)
        cuenta = Counter(clave_url(c.get("url_oficial")) for c in carreras)
        compartidas = {u for u, n in cuenta.items() if n > 1}
        nuevas = fusionadas = 0
        vistas_ids = set()

        for c in carreras:
            if c["id"] in vistas_ids or not es_carrera_a_pie(c["nombre"]):
                continue
            vistas_ids.add(c["id"])
            candidatas = [e for f in (c["fecha"],) for e in por_fecha[f]]
            for delta in (-1, 1):
                try:
                    vecina = date.fromordinal(date.fromisoformat(c["fecha"]).toordinal() + delta).isoformat()
                    candidatas += por_fecha[vecina]
                except ValueError:
                    pass
            mejor, mejor_p = None, 0.0
            for e in candidatas:
                p = puntuacion(e, c, compartidas)
                if p > mejor_p:
                    mejor, mejor_p = e, p
            if mejor:
                fusionar(mejor, c)
                fusionadas += 1
            else:
                c.setdefault("fuentes", [c["fuente"]["nombre"]])
                resultado.append(c)
                por_fecha[c["fecha"]].append(c)
                nuevas += 1
        estadisticas[nombre_fuente] = {"nuevas": nuevas, "ya_existentes": fusionadas}

    return resultado, estadisticas


def unir_por_web(carreras):
    """
    Segunda pasada: une carreras que comparten web oficial (p. ej. cuando se ha
    averiguado la web de una carrera de Running.life y resulta ser la de otra).
    Se conserva la primera (de mayor prioridad). Devuelve (lista, nº de uniones).
    """
    cuenta = Counter(clave_url(c.get("url_oficial")) for c in carreras)
    primera = {}
    resultado = []
    uniones = 0
    for c in carreras:
        clave = clave_url(c.get("url_oficial"))
        valida = clave and not es_agregador(clave) and cuenta[clave] == 2
        if valida and clave in primera and dias_entre(primera[clave]["fecha"], c["fecha"]) <= 1 \
                and not subpruebas_distintas(primera[clave]["nombre"], c["nombre"]):
            fusionar(primera[clave], c)
            uniones += 1
            continue
        if valida:
            primera.setdefault(clave, c)
        resultado.append(c)
    return resultado, uniones
