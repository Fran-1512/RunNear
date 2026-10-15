"""
Pruebas del generador de páginas (sitio/): direcciones de las carreras, horas con su zona
horaria, enlaces entre guías, huecos de anuncios y la lista de provincias de la web.

    py -m unittest discover -s tests -t .
"""

import os
import re
import unittest

from scraper.comun import PROVINCIAS
from sitio import generar
from sitio.guias import GUIAS, GUIAS_DE_CALENDARIO, GUIAS_GENERALES, GUIAS_LARGAS, GUIAS_TRAIL, TEMAS

RAIZ = generar.RAIZ


class Direcciones(unittest.TestCase):
    def test_slug(self):
        self.assertEqual(generar.slug("Alcázar de San Juan"), "alcazar-de-san-juan")
        self.assertEqual(generar.slug("  ¡¡Hola!!  "), "hola")

    def test_direccion_estable_entre_ediciones(self):
        """Sin año ni número de edición: la misma dirección sirve el año que viene."""
        casos = {
            ("XXI Carrera de Tomelloso 2026", "Tomelloso"): "carrera-de-tomelloso",
            ("10K Ciudad de Tomelloso 2026", "Tomelloso"): "10k-ciudad-de-tomelloso",
            ("28ª Media Maratón de Alcázar", "Alcázar de San Juan"): "media-maraton-de-alcazar-alcazar-de-san-juan",
            ("Inforun VI Carrera Solidaria Ruidera 26", "Ruidera"): "inforun-carrera-solidaria-ruidera",
        }
        for (nombre, pueblo), esperado in casos.items():
            with self.subTest(nombre=nombre):
                self.assertEqual(generar.slug_evento({"nombre": nombre, "municipio": pueblo, "fecha": "2026-10-04"}),
                                 esperado)


class Seguridad(unittest.TestCase):
    def test_solo_enlaces_http(self):
        self.assertEqual(generar.url_segura("https://carrera.es/inscripcion"), "https://carrera.es/inscripcion")
        self.assertEqual(generar.url_segura(" http://x.es "), "http://x.es")
        for mala in ("javascript:alert(1)", "JAVASCRIPT:alert(1)", "data:text/html,hola", "//x.es", "", None):
            with self.subTest(url=mala):
                self.assertIsNone(generar.url_segura(mala))

    def test_misma_politica_de_seguridad_en_todas_las_paginas(self):
        meta = f'<meta http-equiv="Content-Security-Policy" content="{generar.CSP}">'
        for nombre in ("mapa.html", "legal.html"):
            with self.subTest(pagina=nombre), open(os.path.join(RAIZ, nombre), encoding="utf-8") as f:
                self.assertIn(meta, f.read())
        script_src = re.search(r"script-src ([^;]*);", generar.CSP).group(1)
        self.assertTrue(script_src.startswith("'self'"))
        self.assertNotIn("unsafe", script_src)              # nunca 'unsafe-inline' ni 'unsafe-eval'

    def test_textos_escapados(self):
        self.assertEqual(generar.e('<img src=x onerror="alert(1)">'),
                         "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;")


class Direccion(unittest.TestCase):
    def test_una_sola_direccion_publica(self):
        """mapa.html y el resto del código usan la misma dirección que SITIO_URL (nada de la antigua)."""
        with open(os.path.join(RAIZ, "mapa.html"), encoding="utf-8") as f:
            mapa = f.read()
        self.assertIn(f'<link rel="canonical" href="{generar.SITIO_URL}mapa.html">', mapa)
        for ruta in ("mapa.html", "js/propuestas.js", "scraper/fuentes/propuestas.py",
                     "supabase/functions/avisos/index.ts", "sitio/generar.py"):
            with self.subTest(archivo=ruta), open(os.path.join(RAIZ, ruta), encoding="utf-8") as f:
                self.assertNotIn("github.io/RunNear", f.read())


class AdSense(unittest.TestCase):
    def test_misma_cuenta_en_paginas_y_ads_txt(self):
        cuenta = generar.ADSENSE_CUENTA
        self.assertRegex(cuenta, r"^ca-pub-\d{16}$")
        meta = f'<meta name="google-adsense-account" content="{cuenta}">'
        for nombre in ("mapa.html", "legal.html"):
            with self.subTest(pagina=nombre), open(os.path.join(RAIZ, nombre), encoding="utf-8") as f:
                self.assertIn(meta, f.read())
        with open(os.path.join(RAIZ, "ads.txt"), encoding="utf-8") as f:
            self.assertEqual(f.read().strip(), f"google.com, {cuenta[3:]}, DIRECT, f08c47fec0942fa0")
        with open(os.path.join(RAIZ, "js", "anuncios.js"), encoding="utf-8") as f:
            self.assertIn(f'const CLIENTE = "{cuenta}";', f.read())


class DatosParaGoogle(unittest.TestCase):
    """Campos que Search Console pide en los eventos (SportsEvent) de cada ficha de carrera."""

    def carrera(self, **extra):
        return {"id": "x", "nombre": "10K Ciudad de Toledo", "fecha": "2099-05-10", "hora": "10:00",
                "municipio": "Toledo", "provincia": "Toledo", "url_oficial": "https://10ktoledo.es",
                "actualizado": "2099-01-15", **extra}

    def test_campos_del_evento(self):
        d = generar.datos_evento(self.carrera(precio_desde=12), "https://gorunnear.com/carrera/x/")
        for campo in ("name", "startDate", "endDate", "location", "organizer", "performer", "offers", "eventStatus"):
            self.assertIn(campo, d)
        self.assertEqual(d["endDate"], "2099-05-10")
        self.assertEqual(d["organizer"]["url"], "https://10ktoledo.es")
        self.assertEqual(d["offers"]["validFrom"], "2099-01-15")
        self.assertEqual(d["offers"]["availability"], "https://schema.org/InStock")

    def test_sin_precio_no_se_inventa_oferta(self):
        self.assertNotIn("offers", generar.datos_evento(self.carrera(), "https://gorunnear.com/carrera/x/"))


class HoraOficial(unittest.TestCase):
    def test_verano_invierno_y_canarias(self):
        self.assertEqual(generar.desfase_horario("2026-07-15", "Madrid"), "+02:00")
        self.assertEqual(generar.desfase_horario("2026-12-15", "Madrid"), "+01:00")
        self.assertEqual(generar.desfase_horario("2026-07-15", "Las Palmas"), "+01:00")
        self.assertEqual(generar.desfase_horario("2026-12-15", "Santa Cruz de Tenerife"), "+00:00")

    def test_cambio_de_hora(self):
        # 2026: horario de verano del domingo 29 de marzo al domingo 25 de octubre
        self.assertEqual(generar.desfase_horario("2026-03-28", "Madrid"), "+01:00")
        self.assertEqual(generar.desfase_horario("2026-03-29", "Madrid"), "+02:00")
        self.assertEqual(generar.desfase_horario("2026-10-24", "Madrid"), "+02:00")
        self.assertEqual(generar.desfase_horario("2026-10-25", "Madrid"), "+01:00")


class Guias(unittest.TestCase):
    def test_cada_guia_tiene_su_texto_y_datos(self):
        slugs = [g["slug"] for g in GUIAS]
        self.assertEqual(len(slugs), len(set(slugs)), "guías repetidas")
        for g in GUIAS:
            with self.subTest(guia=g["slug"]):
                self.assertTrue(os.path.exists(os.path.join(RAIZ, "sitio", "guias", g["slug"] + ".html")))
                self.assertIn(g["tema"], TEMAS)
                self.assertGreaterEqual(len(g["faq"]), 3)
                self.assertLessEqual(len(g["descripcion"]), 200, "descripción demasiado larga para Google")

    def test_enlaces_entre_guias(self):
        """Ninguna guía enlaza (en el texto o en "Sigue leyendo") a una guía que no existe."""
        for g in GUIAS:
            with self.subTest(guia=g["slug"]):
                with open(os.path.join(RAIZ, "sitio", "guias", g["slug"] + ".html"), encoding="utf-8") as f:
                    generar.comprobar_enlaces_guias(g["slug"], f.read())

    def test_listas_de_guias_recomendadas(self):
        existentes = {g["slug"] for g in GUIAS}
        for lista in (GUIAS_GENERALES, GUIAS_TRAIL, GUIAS_LARGAS, GUIAS_DE_CALENDARIO):
            self.assertTrue(set(lista) <= existentes, lista)

    def test_paginas_informativas(self):
        for p in generar.PAGINAS_FIJAS:
            with self.subTest(pagina=p["slug"]):
                self.assertTrue(os.path.exists(os.path.join(RAIZ, "sitio", "paginas", p["slug"] + ".html")))


class Anuncios(unittest.TestCase):
    def test_huecos_repartidos_en_una_guia(self):
        texto = "<p>Intro</p>" + "".join(f"<h2>Apartado {i}</h2><p>Texto {i}</p>" for i in range(1, 9))
        resultado = generar.con_anuncios(texto)
        self.assertEqual(resultado.count('class="anuncio"'), 3)        # tras la intro y antes del 3.º y 6.º
        self.assertTrue(resultado.startswith('<p>Intro</p><div class="anuncio"'))

    def test_sin_anuncio_pegado_a_la_calculadora(self):
        texto = '<p>Intro</p><form id="calculadora"></form><h2>A</h2><p>x</p>'
        self.assertNotIn('class="anuncio"', generar.con_anuncios(texto))


class ProvinciasDeLaWeb(unittest.TestCase):
    def test_provincias_js_al_dia(self):
        """js/provincias.js debe coincidir con scraper/comun.py (lo regenera sitio/generar.py)."""
        esperado = generar.contenido_provincias_js({p: c for p, (c, _) in PROVINCIAS.items()})
        with open(os.path.join(RAIZ, "js", "provincias.js"), encoding="utf-8") as f:
            self.assertEqual(f.read(), esperado)
        self.assertEqual(len(re.findall(r'^  "', esperado, flags=re.M)), 52)


if __name__ == "__main__":
    unittest.main()
