"""Formato de textos comunes a las páginas generadas: escapar HTML, direcciones, fechas, distancias y precios."""

import html
import re
import unicodedata
from datetime import date

DIAS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]
MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
         "septiembre", "octubre", "noviembre", "diciembre"]


def e(texto):
    """Escapa texto para HTML."""
    return html.escape(str(texto if texto is not None else ""), quote=True)


def slug(texto):
    # NFKD también convierte "28ª" / "5º" en "28a" / "5o", para poder quitar el número de edición
    t = unicodedata.normalize("NFKD", str(texto or ""))
    t = "".join(ch for ch in t if unicodedata.category(ch) != "Mn").lower()
    return re.sub(r"[^a-z0-9]+", "-", t).strip("-")[:80] or "carrera"


def fecha_larga(iso):
    d = date.fromisoformat(iso)
    return f"{DIAS[d.weekday()]}, {d.day} de {MESES[d.month - 1]} de {d.year}"


def dia_y_mes(iso):
    """'2026-10-18' -> '18 de octubre'"""
    d = date.fromisoformat(iso)
    return f"{d.day} de {MESES[d.month - 1]}"


def url_segura(url):
    """La URL solo si es http(s): un enlace "javascript:" de una fuente podría ejecutar código."""
    url = str(url or "").strip()
    return url if re.match(r"https?://", url, re.I) else None


def km_texto(km):
    return f"{km:g}".replace(".", ",") + " km"


def lista_km(c):
    return c.get("distancias_km") or ([c["distancia_km"]] if c.get("distancia_km") else [])


def distancias_texto(c):
    lista = lista_km(c)
    return " / ".join(km_texto(k) for k in lista) if lista else "Distancia por confirmar"


def precio_texto(p):
    return (f"{p:g}".replace(".", ",") if float(p).is_integer() else f"{p:.2f}".replace(".", ",")) + " €"


def tipo_texto(c):
    return "Trail / montaña" if c.get("tipo") == "trail" else "Asfalto (carrera popular)"


def enumerar(elementos):
    """['a', 'b', 'c'] -> 'a, b y c'"""
    elementos = list(elementos)
    return elementos[0] if len(elementos) == 1 else ", ".join(elementos[:-1]) + " y " + elementos[-1]
