"""
Guías de RunNear: datos de cada una (título para Google, descripción, preguntas frecuentes...).
El texto de cada guía está en sitio/guias/<slug>.html; generar.py le pone la plantilla, los
datos estructurados (Article, FAQPage) y la incluye en el sitemap.

En el texto se pueden usar estas marcas, que generar.py sustituye:
  {{R}}             ruta a la raíz de la web (para enlaces: {{R}}calendario/)
  {{AÑO}}           año en curso
  {{SAN_SILVESTRE}} lista actualizada de San Silvestre por comunidades
  {{TABLA_RITMOS}}  tabla de ritmos y tiempos finales

Para cambiar una guía: editar su .html y, si cambia el contenido, la fecha "actualizada".
"""

GUIAS = [
    {
        "slug": "calculadora-ritmo",
        "titulo": "Calculadora de ritmo para correr",
        "titulo_seo": "Calculadora de ritmo running: min/km, tiempo final y parciales",
        "descripcion": "Calcula tu ritmo por kilómetro, tu tiempo final en 5K, 10K, media maratón o maratón y tus parciales. Con tabla de ritmos y estimación de marcas.",
        "resumen": "Ritmo por kilómetro, tiempo final, parciales y estimación de tus marcas en otras distancias.",
        "icono": "⏱️",
        "publicada": "2026-10-12",
        "actualizada": "2026-10-12",
        "faq": [
            ("¿Cómo se calcula el ritmo de carrera?",
             "Se divide el tiempo total entre los kilómetros recorridos. Por ejemplo, 10 km en 55 minutos son 5,5 minutos por kilómetro, es decir, 5:30 min/km."),
            ("¿Qué ritmo hace falta para bajar de 50 minutos en un 10K?",
             "Hay que correr a menos de 5:00 min/km de media: a 5:00 exactos se termina en 50:00, así que conviene ir algo por debajo, sobre 4:55 min/km."),
            ("¿Cómo paso de km/h a min/km?",
             "Divide 60 entre la velocidad en km/h. Por ejemplo, 12 km/h son 60 / 12 = 5 minutos por kilómetro."),
            ("¿Son fiables las estimaciones de marca en otras distancias?",
             "Son orientativas. Se basan en una fórmula muy usada (la de Peter Riegel) que funciona bien si has entrenado la distancia; en maratón suele ser optimista si no has hecho tiradas largas."),
        ],
    },
    {
        "slug": "primera-carrera-5-km",
        "titulo": "Cómo preparar tu primera carrera de 5 km",
        "titulo_seo": "Cómo preparar tu primera carrera de 5 km: plan de 8 semanas para principiantes",
        "descripcion": "Plan de 8 semanas para pasar de no correr a terminar tu primer 5K, alternando caminar y correr. Consejos de ritmo, descanso, material y cómo elegir tu carrera.",
        "resumen": "Plan de 8 semanas, tres días por semana, para pasar de no correr a terminar tu primer 5K.",
        "icono": "🏃",
        "publicada": "2026-10-12",
        "actualizada": "2026-10-12",
        "faq": [
            ("¿Cuánto tiempo se tarda en preparar un 5K desde cero?",
             "Con tres sesiones por semana, la mayoría de personas sanas puede terminar 5 km corriendo en unas 8 semanas. Si alguna semana cuesta, repítela: no hay prisa."),
            ("¿Cuántos días a la semana hay que entrenar para un 5K?",
             "Tres días a la semana, con un día de descanso entre sesiones, es suficiente para empezar y deja tiempo para que el cuerpo se adapte."),
            ("¿Qué tiempo es bueno en una primera carrera de 5 km?",
             "El objetivo de la primera es terminar a gusto. Como referencia, muchas personas que empiezan tardan entre 30 y 40 minutos, y caminar algún tramo es perfectamente normal."),
            ("¿Es malo caminar durante una carrera popular?",
             "No. En las carreras populares mucha gente alterna correr y caminar. Solo hay que apartarse a un lado para no cortar el paso."),
        ],
    },
    {
        "slug": "dia-de-la-carrera",
        "titulo": "El día de la carrera: guía para tu primera carrera popular",
        "titulo_seo": "Tu primera carrera popular: dorsal, chip, calentamiento y ritmo el día de la carrera",
        "descripcion": "Qué hacer antes, durante y después de una carrera popular: recoger el dorsal, colocar el chip, desayunar, calentar, salir a buen ritmo y los avituallamientos.",
        "resumen": "Dorsal, chip, desayuno, calentamiento, ritmo y avituallamientos: todo lo que pasa el día de la carrera.",
        "icono": "🎽",
        "publicada": "2026-10-12",
        "actualizada": "2026-10-12",
        "faq": [
            ("¿Dónde se pone el dorsal?",
             "En la parte delantera, a la altura del pecho o el abdomen y bien visible, sujeto con imperdibles en las cuatro esquinas o con un portadorsal. No lo dobles: muchas veces lleva el chip de cronometraje."),
            ("¿Cuánto antes hay que llegar a una carrera popular?",
             "Entre 45 minutos y una hora antes de la salida es lo razonable: da tiempo a aparcar, recoger el dorsal si no lo tienes, ir al baño y calentar sin prisas."),
            ("¿Qué desayunar antes de una carrera?",
             "Algo que ya hayas probado en tus entrenamientos, fácil de digerir y unas 2 o 3 horas antes: por ejemplo tostadas, fruta o cereales. El día de la carrera no es el momento de probar nada nuevo."),
            ("¿Qué es el cajón de salida?",
             "Es la zona de la salida que te corresponde según el tiempo que esperas hacer. Colocarte en el cajón adecuado evita adelantamientos y empujones en los primeros metros."),
        ],
    },
    {
        "slug": "elegir-zapatillas-running",
        "titulo": "Cómo elegir zapatillas de running",
        "titulo_seo": "Cómo elegir zapatillas de running: guía para asfalto y trail",
        "descripcion": "Qué mirar al comprar zapatillas para correr: terreno, amortiguación, drop, talla, pisada y cuándo cambiarlas. Diferencias entre zapatillas de asfalto y de trail.",
        "resumen": "Terreno, amortiguación, drop, talla y cuándo cambiarlas, para asfalto y para montaña.",
        "icono": "👟",
        "publicada": "2026-10-12",
        "actualizada": "2026-10-12",
        "faq": [
            ("¿Cada cuántos kilómetros hay que cambiar las zapatillas de correr?",
             "Como orientación, entre 600 y 900 km, según tu peso, tu forma de correr y el modelo. Más que los kilómetros, fíjate en si la suela está muy gastada o la amortiguación se nota hundida."),
            ("¿Las zapatillas de correr deben ser de mi talla habitual?",
             "Suelen necesitar algo más de espacio: deja aproximadamente un dedo entre el dedo más largo y la puntera, porque el pie se hincha al correr. A menudo eso supone medio número más."),
            ("¿Puedo usar zapatillas de asfalto para hacer trail?",
             "En pistas anchas y caminos secos, sí. En senderos técnicos, barro o piedra suelta, una zapatilla de trail agarra y protege mucho mejor."),
            ("¿Qué es el drop de una zapatilla?",
             "Es la diferencia de altura entre el talón y la puntera, en milímetros. Si cambias a un drop mucho más bajo que el que usas, hazlo de forma progresiva."),
        ],
    },
    {
        "slug": "san-silvestre",
        "titulo": "Carreras de San Silvestre en España",
        "titulo_seo": "San Silvestre {{AÑO}}: carreras de fin de año en España por comunidades",
        "descripcion": "Todas las San Silvestre de {{AÑO}} que tenemos registradas en España, por comunidades, con fecha, distancia y enlace a la inscripción. Qué son y consejos para correrlas.",
        "resumen": "Las San Silvestre de este año por comunidades, actualizadas cada día, y consejos para correrlas.",
        "icono": "🎄",
        "publicada": "2026-10-12",
        "actualizada": "2026-10-12",
        "faq": [
            ("¿Qué es una San Silvestre?",
             "Es una carrera popular que se celebra en torno al 31 de diciembre, día de San Silvestre, para despedir el año. Suelen ser recorridos cortos y urbanos, con ambiente festivo y muchos corredores disfrazados."),
            ("¿Cuándo se celebran las San Silvestre?",
             "La mayoría se corren el 31 de diciembre, pero muchas localidades las organizan en los días o fines de semana anteriores para no coincidir con las más grandes."),
            ("¿Qué distancia tiene una San Silvestre?",
             "Lo más habitual son entre 5 y 10 km, y muchas tienen además carreras infantiles. También hay versiones de trail por montaña."),
            ("¿Hay que inscribirse con antelación?",
             "Sí, y en las más populares las plazas se agotan semanas antes. Consulta la web oficial de cada carrera y no lo dejes para el último día."),
        ],
    },
]

# Guías que se recomiendan en las fichas de carreras y calendarios
GUIA_SAN_SILVESTRE = "san-silvestre"
GUIAS_GENERALES = ["dia-de-la-carrera", "calculadora-ritmo", "primera-carrera-5-km"]
