"""
Texto propio de la ficha de cada carrera, escrito a partir de SUS datos (nunca se inventa nada: un
dato que no se conoce no se menciona). Las frases varían de una carrera a otra para que las fichas
no sean copias unas de otras, que es lo que hace que Google decida no indexarlas.
"""

import hashlib
import re
from datetime import date

from sitio.formato import (DIAS, MESES, dia_y_mes, e, enumerar, fecha_larga, km_texto, lista_km, precio_texto,
                           url_segura)


def variante(c, opciones, clave=""):
    """Elige siempre la misma opción para la misma carrera (cambia de una carrera a otra)."""
    n = int(hashlib.md5(f"{c.get('id')}{clave}".encode("utf-8")).hexdigest(), 16)
    return opciones[n % len(opciones)]


def nombre_con_anio(c):
    """'Cross de Tineo' -> 'Cross de Tineo 2026' (si el nombre no lleva ya el año)."""
    anio = c["fecha"][:4]
    return c["nombre"] if anio in c["nombre"] else f"{c['nombre']} {anio}"


# Primera palabra (tras números de edición) que hace femenino el nombre: "la Carrera...", "la Milla..."
FEMENINAS = {"carrera", "carreras", "media", "milla", "san", "sant", "subida", "travesia", "legua", "ruta",
             "marcha", "cursa", "carreira", "andaina", "vuelta", "nocturna", "quedada", "prueba", "volta",
             "jornada", "copa", "liga", "fiesta", "festa", "semana", "noche", "gran"}
ARTICULOS = {"el": "el", "la": "la", "los": "los", "las": "las", "els": "els", "les": "les", "l": "l"}


def articulo(c, preposicion=""):
    """'el' / 'la' (o 'del' / 'de la' con preposicion='de') que va delante del nombre de la carrera.
    Vacío si el nombre ya empieza por artículo ("La Transmontgrí")."""
    palabras = [p for p in re.split(r"[\s'’]+", c["nombre"].lower()) if p]
    if palabras and palabras[0] in ARTICULOS:
        return preposicion
    # Saltar números de edición y romanos: "XXI Carrera...", "28ª Media...", "10K..."
    for p in palabras:
        limpio = re.sub(r"[^a-záéíóúñü0-9]", "", p)
        if re.fullmatch(r"[ivxlcdm]+|\d+(ª|º|a|o)?", limpio):
            continue
        femenino = limpio.translate(str.maketrans("áéíóú", "aeiou")) in FEMENINAS
        break
    else:
        femenino = True
    if preposicion == "de":
        return "de la" if femenino else "del"
    return "la" if femenino else "el"


def con_articulo(c, preposicion=""):
    """'el Cross de Tineo', 'la Carrera de...', 'del Cross...', 'La Transmontgrí'."""
    art = articulo(c, preposicion)
    return f"{art} {e(c['nombre'])}".strip()


def mayuscula_inicial(texto):
    """Solo la primera letra en mayúscula ("la XXI Carrera" -> "La XXI Carrera")."""
    return texto[:1].upper() + texto[1:]


def es_pobre(c):
    """Fichas con tan pocos datos que no merece la pena que Google las indexe (siguen publicadas)."""
    return not lista_km(c)


def tipo_distancia(km):
    if km <= 5.5:
        return "corta"
    if km <= 12:
        return "10K"
    if 20.5 <= km <= 22:
        return "media"
    if 41.5 <= km <= 43:
        return "maraton"
    return "ultra" if km > 43 else "otra"


def titulo_ficha(c, hoy):
    nombre = nombre_con_anio(c)
    if c["fecha"] < hoy:
        if c.get("resultados") or c.get("resultados_web"):
            return f"{nombre}: resultados y clasificaciones · {c.get('municipio')} | RunNear"
        return f"{nombre} ({dia_y_mes(c['fecha'])}) en {c.get('municipio')} | RunNear"
    return f"{nombre}: {dia_y_mes(c['fecha'])} en {c.get('municipio')} · Inscripción | RunNear"


# ---------------------------------------------------------------------------
# Párrafos
# ---------------------------------------------------------------------------

def _presentacion(c, celebrada):
    d = date.fromisoformat(c["fecha"])
    clase = "una carrera de trail por montaña" if c.get("tipo") == "trail" else variante(
        c, ["una carrera popular de asfalto", "una carrera popular", "una prueba de asfalto abierta a todos"])
    verbo = "se celebró" if celebrada else variante(c, ["se celebra", "se corre", "tendrá lugar"], "v")
    texto = (f"{mayuscula_inicial(con_articulo(c))} es {clase} que {verbo} el {DIAS[d.weekday()]} {d.day} de "
             f"{MESES[d.month - 1]} de {d.year} en {e(c.get('municipio'))}, en la provincia de "
             f"{e(c.get('provincia'))} ({e(c.get('comunidad'))}).")
    if c.get("hora") and celebrada:
        texto += f" La salida fue a las {e(c['hora'])}."
    elif c.get("hora"):
        texto += " " + variante(c, [f"La salida está prevista a las {e(c['hora'])}.",
                                    f"Se da la salida a las {e(c['hora'])}.",
                                    f"La salida es a las {e(c['hora'])}."], "h")
    return texto


def _distancias(c):
    kms = lista_km(c)
    if not kms:
        return ("Todavía no hemos encontrado las distancias publicadas: consulta el recorrido en la web "
                "oficial de la carrera.")
    tipos = {tipo_distancia(k) for k in kms}
    if len(kms) == 1:
        k = kms[0]
        texto = variante(c, [f"El recorrido es de {km_texto(k)}", f"La prueba cubre {km_texto(k)}",
                             f"La distancia es de {km_texto(k)}"], "d")
        if "media" in tipos:
            texto += ", la distancia de una media maratón."
        elif "maraton" in tipos:
            texto += ": un maratón completo."
        elif "ultra" in tipos:
            texto += ", más que un maratón: es una prueba de ultradistancia."
        elif "corta" in tipos:
            texto += ", una distancia asequible incluso si estás empezando."
        else:
            texto += "."
    else:
        texto = (variante(c, ["Ofrece", "Tiene", "Se puede elegir entre"], "d") + f" {len(kms)} distancias: "
                 f"{enumerar(km_texto(k) for k in kms)}")
        texto += (", así que hay opción tanto para quien empieza como para quien busca un reto mayor."
                  if "corta" in tipos and len(tipos) > 1 else ".")
    if c.get("tipo") == "trail" and c.get("desnivel_positivo_m"):
        desnivel = int(c["desnivel_positivo_m"])
        esfuerzo = round(max(kms) + desnivel / 100)
        texto += (f" Acumula unos {desnivel:,} metros de desnivel positivo".replace(",", ".")
                  + f", lo que equivale a unos {esfuerzo} km esfuerzo.")
    return texto


def _detalles(c):
    frases = []
    if c.get("precio_desde") is not None:
        frases.append(variante(c, [f"La inscripción cuesta desde {precio_texto(c['precio_desde'])}.",
                                   f"Inscribirse cuesta desde {precio_texto(c['precio_desde'])}.",
                                   f"El precio de inscripción parte de {precio_texto(c['precio_desde'])}."], "p"))
    if c.get("inscritos"):
        frases.append(f"En nuestra última consulta tenía {c['inscritos']:,} inscritos.".replace(",", "."))
    elif c.get("plazas_max"):
        frases.append(f"Tiene un límite de {c['plazas_max']:,} plazas, así que conviene no dejar la inscripción "
                      "para el último momento.".replace(",", "."))
    if c.get("circuito"):
        frases.append(f"Forma parte del {e(c['circuito'])}.")
    if c.get("estado"):
        frases.append(f"Atención: según su web de inscripción, la carrera está {e(c['estado'])}.")
    return " ".join(frases)


# Consejo según la época del año, con su guía ({} = enlace a la guía)
ESTACIONES = {
    (12, 1, 2): ("En pleno invierno, lo normal es correr con frío: abrígate para la espera de la salida y "
                 "lleva ropa seca para después. Repasa {} para ir cómodo.", "ropa-para-correr",
                 "qué ropa ponerte según la temperatura"),
    (3, 4, 5): ("La primavera es una de las mejores épocas del año para correr, con temperaturas agradables "
                "y muchas carreras en el calendario. Si dudas entre varias, mira {}.", "como-elegir-carrera",
                "cómo elegir tu próxima carrera"),
    (6, 7, 8): ("En verano el calor puede apretar: hidrátate bien en los días previos y adapta el ritmo si "
                "hace calor. Te lo explicamos en {}.", "hidratacion-al-correr", "nuestra guía de hidratación"),
    (9, 10, 11): ("El otoño trae temperaturas suaves, de las mejores para correr a gusto o buscar una buena "
                  "marca. Si vas a por ella, calcula tu ritmo con {}.", "calculadora-ritmo",
                  "la calculadora de ritmo"),
}


def _epoca(c, prefijo):
    mes = int(c["fecha"][5:7])
    for meses, (texto, guia, enlace) in ESTACIONES.items():
        if mes in meses:
            return texto.format(f'<a href="{prefijo}guias/{guia}/">{enlace}</a>')
    return ""


def _zona(c, n_provincia, n_finde, mes_ruta, prefijo):
    partes = []
    if n_provincia:
        partes.append(f"En {e(c.get('provincia'))} hay {n_provincia} "
                      f"{'carrera próxima más' if n_provincia == 1 else 'carreras próximas más'}")
    if n_finde:
        partes.append(f"ese mismo fin de semana se corren {n_finde} más en {e(c.get('comunidad'))}")
    texto = (enumerar(partes) + "." if partes else "")
    if mes_ruta:
        mes = MESES[int(c["fecha"][5:7]) - 1]
        texto += (f' Puedes ver todas las de <a href="{prefijo}{mes_ruta}">{mes} de {c["fecha"][:4]} '
                  "en toda España</a>.")
    return texto.strip()


def parrafos_carrera(c, hoy, n_provincia=0, n_finde=0, mes_ruta=None, prefijo="../../"):
    """Párrafos HTML (ya escapados) con la descripción propia de la carrera."""
    celebrada = c["fecha"] < hoy
    parrafos = [_presentacion(c, celebrada), _distancias(c), _detalles(c)]
    if not celebrada:
        parrafos += [_epoca(c, prefijo), _zona(c, n_provincia, n_finde, mes_ruta, prefijo)]
    return [p for p in parrafos if p]


# ---------------------------------------------------------------------------
# Preguntas frecuentes (con las respuestas de SUS datos)
# ---------------------------------------------------------------------------

def preguntas_carrera(c, hoy):
    """[(pregunta, respuesta_html)]"""
    nombre = e(nombre_con_anio(c))
    el = f"{articulo(c)} {nombre}".strip()          # "el Cross de Tineo 2026"
    del_ = f"{articulo(c, 'de')} {nombre}".strip()  # "del Cross de Tineo 2026"
    celebrada = c["fecha"] < hoy
    web = url_segura(c.get("url_oficial"))
    enlace_web = f'<a href="{e(web)}" rel="noopener" target="_blank">su web oficial</a>' if web else "su web oficial"
    preguntas = [
        (f"¿Cuándo {'fue' if celebrada else 'es'} {el}?",
         f"{'Se celebró' if celebrada else 'Se celebra'} el {fecha_larga(c['fecha'])}"
         + (f", con salida a las {e(c['hora'])}." if c.get("hora") else ". La hora de salida se confirma en "
            f"{enlace_web}.")),
        (f"¿Dónde se corre {el}?",
         f"En {e(c.get('municipio'))}, en la provincia de {e(c.get('provincia'))} ({e(c.get('comunidad'))})."),
    ]
    kms = lista_km(c)
    if kms:
        preguntas.append((f"¿Qué distancias tiene {el}?",
                          f"{enumerar(km_texto(k) for k in kms).capitalize()}."))
    if not celebrada:
        if c.get("precio_desde") is not None:
            preguntas.append((f"¿Cuánto cuesta la inscripción {del_}?",
                              f"Desde {precio_texto(c['precio_desde'])}, según su web de inscripción. "
                              f"Confirma el precio y los plazos en {enlace_web}."))
        else:
            preguntas.append((f"¿Cómo me inscribo en {el}?",
                              f"La inscripción se hace en {enlace_web}, donde también están el reglamento y "
                              "el recorrido."))
    elif c.get("resultados") or c.get("resultados_web"):
        preguntas.append((f"¿Dónde están los resultados {del_}?",
                          "En el apartado de resultados de esta página tienes los enlaces a las clasificaciones "
                          "publicadas."))
    return preguntas


def texto_plano(html_texto):
    """Quita las etiquetas (para la descripción de Google)."""
    return re.sub(r"<[^>]+>", "", html_texto)
