"""
Pruebas del recolector de carreras (scraper/): provincias, textos, distancias, fechas,
unión de fuentes y conservación de las carreras ya celebradas.

    py -m unittest discover -s tests -t .
"""

import json
import os
import tempfile
import unittest
from datetime import date, timedelta

from scraper import comun, ejecutar, fusion


class Provincias(unittest.TestCase):
    def test_nombres_y_alias(self):
        casos = {"CIUDAD REAL": "Ciudad Real", "CR": "Ciudad Real", "Lérida": "Lleida", "Gerona": "Girona",
                 "La Coruña": "A Coruña", "A CORUÑA": "A Coruña", "Vizcaya": "Bizkaia", "Guipúzcoa": "Gipuzkoa",
                 "Araba/Álava": "Álava", "Illes Balears": "Baleares", "València": "Valencia",
                 "Alacant": "Alicante", "Castelló": "Castellón", "Orense": "Ourense",
                 "Comunidad de Madrid": "Madrid", "Navarra": "Navarra", "Francia": None, "": None}
        for texto, esperado in casos.items():
            with self.subTest(texto=texto):
                self.assertEqual(comun.normalizar_provincia(texto), esperado)

    def test_52_provincias_en_19_comunidades(self):
        self.assertEqual(len(comun.PROVINCIAS), 52)
        self.assertEqual(len(comun.COMUNIDADES), 19)
        self.assertEqual(comun.comunidad_de("Toledo"), "Castilla-La Mancha")
        self.assertEqual(comun.comunidad_de("Lleida"), "Cataluña")
        self.assertIsNone(comun.comunidad_de("Atlántida"))

    def test_provincia_por_coordenadas(self):
        puntos = {(40.4168, -3.7038): "Madrid", (41.3874, 2.1686): "Barcelona", (37.3891, -5.9845): "Sevilla",
                  (43.2630, -2.9350): "Bizkaia", (42.8782, -8.5448): "A Coruña", (39.5696, 2.6502): "Baleares",
                  (28.1235, -15.4363): "Las Palmas", (28.4636, -16.2518): "Santa Cruz de Tenerife",
                  (39.8628, -4.0273): "Toledo", (35.8894, -5.3213): "Ceuta", (35.2923, -2.9381): "Melilla",
                  (42.4627, -2.4450): "La Rioja", (43.3614, -5.8494): "Asturias", (38.3452, -0.4810): "Alicante",
                  (48.8566, 2.3522): None, (38.7223, -9.1393): None}
        for (lat, lng), esperado in puntos.items():
            with self.subTest(punto=(lat, lng)):
                self.assertEqual(comun.provincia_por_punto(lat, lng), esperado)


class Textos(unittest.TestCase):
    def test_normalizar(self):
        self.assertEqual(comun.normalizar("Alcázar  de San-Juan"), "alcazar de san juan")

    def test_mayusculas_a_titulo(self):
        self.assertEqual(comun.titulo_municipio("ALCALÁ DEL JÚCAR"), "Alcalá del Júcar")
        self.assertEqual(comun.titulo_municipio("HOYA-GONZALO"), "Hoya-Gonzalo")
        self.assertEqual(comun.titulo_carrera("XXI CARRERA POPULAR DE LA MANCHA 10K"),
                         "XXI Carrera Popular de la Mancha 10K")
        self.assertEqual(comun.titulo_carrera("Ya Está Bien"), "Ya Está Bien")

    def test_texto_visible(self):
        self.assertEqual(comun.texto_visible("<p>Hola <b>mundo</b></p><script>x()</script> &amp; más"),
                         "Hola mundo & más")


class DistanciasYFechas(unittest.TestCase):
    def test_distancias_en_texto(self):
        self.assertEqual(comun.extraer_distancias_km("4km, 8km y 4 km"), [4.0, 8.0])
        self.assertEqual(comun.extraer_distancias_km("21,097 km"), [21.097])
        self.assertEqual(comun.extraer_distancias_km("sin distancias"), [])

    def test_distancias_por_nombre(self):
        self.assertEqual(comun.distancias_por_nombre("10K Ciudad de Toledo"), [10.0])
        self.assertEqual(comun.distancias_por_nombre("XXX Media Maratón de Albacete"), [21.097])
        self.assertEqual(comun.distancias_por_nombre("Maratón de Valencia"), [42.195])

    def test_desnivel(self):
        self.assertEqual(comun.extraer_desnivel("+1.700 m de desnivel"), 1700)
        self.assertEqual(comun.extraer_desnivel("desnivel+670m"), 670)
        self.assertEqual(comun.extraer_desnivel("D+ 1200"), 1200)
        self.assertIsNone(comun.extraer_desnivel("llano"))

    def test_fechas(self):
        self.assertEqual(comun.fecha_ddmmaaaa("04/10/2026"), "2026-10-04")
        self.assertEqual(comun.fecha_texto("Domingo 11 octubre 2026"), "2026-10-11")
        self.assertEqual(comun.fecha_texto("18 de octubre", 2026), "2026-10-18")
        self.assertIsNone(comun.fecha_texto("18 de octubre"))

    def test_tipo(self):
        self.assertEqual(comun.tipo_por_nombre("Trail de la Sierra"), "trail")
        self.assertEqual(comun.tipo_por_nombre("Subida al Castillo"), "trail")
        self.assertEqual(comun.tipo_por_nombre("10K Nocturno"), "popular")


def carrera(id_, nombre, fecha, municipio, fuente, **extra):
    return {"id": id_, "nombre": nombre, "fecha": fecha, "municipio": municipio, "provincia": "Albacete",
            "fuente": {"nombre": fuente}, **extra}


class Fusion(unittest.TestCase):
    def test_misma_carrera_en_dos_fuentes_se_une(self):
        a = carrera("a", "XXIX Media Maratón Ciudad de Albacete", "2026-11-08", "Albacete", "A",
                    distancias_km=[21.097])
        b = carrera("b", "Medio Maratón Albacete", "2026-11-08", "Albacete", "B", distancias_km=[21.097],
                    hora="10:00")
        unicas, _ = fusion.unir([("A", [a]), ("B", [b])])
        self.assertEqual(len(unicas), 1)
        self.assertEqual(unicas[0]["hora"], "10:00")            # dato completado desde la otra fuente
        self.assertEqual(unicas[0]["fuentes"], ["A", "B"])

    def test_carreras_distintas_no_se_unen(self):
        a = carrera("a", "San Silvestre Albacete", "2026-12-31", "Albacete", "A")
        b = carrera("b", "San Silvestre Tarancón", "2026-12-31", "Tarancón", "B")
        unicas, _ = fusion.unir([("A", [a]), ("B", [b])])
        self.assertEqual(len(unicas), 2)

    def test_se_descartan_pruebas_que_no_son_a_pie(self):
        self.assertFalse(fusion.es_carrera_a_pie("Duatlón de Hellín"))
        self.assertFalse(fusion.es_carrera_a_pie("Ruta BTT Sierra"))
        self.assertTrue(fusion.es_carrera_a_pie("Trail de Yeste"))


class FuenteQueFalla(unittest.TestCase):
    """Si una fuente falla o devuelve de pronto mucho menos, se usan sus carreras de ayer
    (el 19/10/2026 Running.life devolvió 248 carreras en vez de ~1.500)."""

    def lista(self, n):
        return [{"id": f"c{i}", "nombre": f"Carrera {i}", "fecha": "2099-01-01", "municipio": "Toledo"}
                for i in range(n)]

    def test_caida_a_medias_usa_las_de_ayer(self):
        ayer = self.lista(1500)
        self.assertIs(ejecutar.elegir_carreras("X", self.lista(248), ayer, "2000-01-01"), ayer)

    def test_error_usa_las_de_ayer(self):
        ayer = self.lista(100)
        self.assertIs(ejecutar.elegir_carreras("X", None, ayer, "2000-01-01"), ayer)

    def test_dia_normal_usa_las_de_hoy(self):
        hoy = self.lista(1450)
        self.assertEqual(len(ejecutar.elegir_carreras("X", hoy, self.lista(1500), "2000-01-01")), 1450)

    def test_fuente_pequena_sin_ayer_que_falla(self):
        self.assertIsNone(ejecutar.elegir_carreras("X", None, [], "2000-01-01"))


class ConservarCelebradas(unittest.TestCase):
    """Las carreras de los últimos 14 días se conservan para "Resultados" aunque la fuente ya no las dé."""

    def test_conserva_solo_las_recientes_y_no_duplica(self):
        hoy = date.today()
        dia = lambda n: (hoy - timedelta(days=n)).isoformat()
        anteriores = [
            {"id": "rl-sevilla", "nombre": "10K Sevilla", "fecha": dia(3), "municipio": "Sevilla",
             "provincia": "Sevilla", "fuente": {"nombre": "Running.life"}},
            {"id": "rl-vieja", "nombre": "Carrera antigua", "fecha": dia(20), "municipio": "Lugo",
             "provincia": "Lugo", "fuente": {"nombre": "Running.life"}},
            {"id": "rl-futura", "nombre": "Carrera futura", "fecha": dia(-5), "municipio": "León",
             "provincia": "León", "fuente": {"nombre": "Running.life"}},
            {"id": "rl-repetida", "nombre": "Media Maratón de Toledo", "fecha": dia(2), "municipio": "Toledo",
             "provincia": "Toledo", "fuente": {"nombre": "Running.life"}},
        ]
        resultado = [{"id": "clm-1", "nombre": "Media Maratón Ciudad de Toledo", "fecha": dia(2),
                      "municipio": "Toledo", "provincia": "Toledo", "fuente": {"nombre": "Carreras CLM"}}]
        with tempfile.TemporaryDirectory() as carpeta:
            ruta = os.path.join(carpeta, "carreras.json")
            with open(ruta, "w", encoding="utf-8") as f:
                json.dump(anteriores, f)
            salida_original = ejecutar.SALIDA
            ejecutar.SALIDA = ruta
            try:
                n = ejecutar.conservar_celebradas(resultado, dia(14), hoy.isoformat())
            finally:
                ejecutar.SALIDA = salida_original
        self.assertEqual(n, 1)
        self.assertEqual(sorted(c["id"] for c in resultado), ["clm-1", "rl-sevilla"])


if __name__ == "__main__":
    unittest.main()
