# Resolución geográfica y resultados vigentes

## Evidencia y alcance
Se revisaron lib/tokko.mjs y lib/chat.mjs, el contexto de Responses y las fichas enviadas al frontend. No se consultaron APIs reales. Los IDs y propiedades de las reproducciones son sintéticos y no representan un mapa de IDs reales de San Miguel.

Documentación oficial consultada:
- https://developers.tokkobroker.com/docs/ubicaciones
- https://developers.tokkobroker.com/docs/search

Tokko documenta id, name, full_location, resource_uri y type; full_location incluye país, región, cero o más divisiones padre y el nombre final. quicksearch con scope=full busca términos en la jerarquía; minimal busca en name. El tipo administrativo depende del catálogo, no de un código geográfico inventado por la aplicación. property/search recibe current_localization_id y current_localization_type.

## Defectos reproducidos antes de corregir
1. El resolutor exigía full_location[2] == Lima para candidatos metropolitanos antes de comparar profundidad. No utilizaba type. Una fixture compatible con los padres opcionales documentados, Perú | Lima | San Miguel, se descartaba frente a sectores Perú | Lima | Lima | Otro distrito | San Miguel. Dos sectores provocaban needsLocation incluso con San Miguel, Lima confirmado. Un sector y un distrito con igual ruta aportaban ambos IDs.
2. Cada búsqueda ejecutaba quicksearch otra vez; el ID previamente verificado se conservaba solo dentro de lastSearch y nunca se reutilizaba para consultar.
3. one_search_per_turn rechazaba otra búsqueda después de cualquier resultado positivo. No era un problema del límite de siete pasos: el rechazo sucedía antes de invocar Tokko y podía inducir a posponer una búsqueda que sí cabía en el mismo turno.
4. Las tarjetas del turno se acumulaban. Un intento nuevo fallido retenía lastSearch y lastResultIds antiguos; el modelo veía el intento fallido junto con referencias que parecían vigentes. El frontend dibujaba las propiedades que recibía, sin comprobar la geografía por su cuenta.

Las primeras cuatro regresiones se ejecutaron sobre el código anterior: 0 aprobadas, 4 fallidas. Tras la corrección pasan.

## Selección verificada
lib/locations.mjs interpreta toda la jerarquía, con país y región documentados, sin fijar la ciudad en un índice. Filtra por todos los términos geográficos especificados, conserva los padres explícitos y aplica el contexto metropolitano para homónimos no calificados. Distingue etiquetas textuales de distrito y sector cuando Tokko las proporciona; para tipos desconocidos no inventa el significado de códigos numéricos.

Prioriza ámbitos directos/exactos, el contexto de Lima metropolitana, el tipo pertinente y la profundidad de la jerarquía. Sectores con el mismo nombre no desplazan al distrito. Si solo hay sectores homónimos y falta su padre, devuelve sus jerarquías para una aclaración útil; especificar el padre permite buscar el sector. Los candidatos equivalentes con rutas distintas requieren aclaración. IDs duplicados en una misma ruta se conservan como IDs únicos.

quicksearch sigue usando scope=full. Si el proveedor indica más páginas, se leen antes de seleccionar; no se utiliza una URL next que pueda contener claves. Una paginación que no progresa o un ID inválido genera error técnico.

La respuesta resolvedLocation incluye IDs, tipo de búsqueda, rutas y evidencia name/type/full_location. Se guarda en la sesión y reutiliza con ubicaciones equivalentes (mayúsculas, acentos, separadores y calificadores Lima/Perú). Una ubicación distinta invalida esa resolución. También se conserva cuando falla property/search después de resolver; el reintento no vuelve a solicitar confirmación geográfica. No hay caché global compartida entre sesiones, ni IDs de distritos en el código o en el esquema de herramientas.

## Estado de resultados
Cada nuevo intento de search_properties sustituye el conjunto activo del turno:
- properties/responseCards: únicamente fichas del intento vigente.
- lastSearch y lastResultIds: búsqueda vigente y posiciones actuales; no permanecen activos tras un error.
- lastSearchAttempt: matches, no_matches, needs_location, outside_coverage o error.
- knownProperties: conserva inmuebles anteriores, descripciones, IDs y todas sus fotografías para referencias explícitas y solicitudes de visita.

Las propiedades anteriores siguen consultables por ID y show_property puede mostrarlas otra vez explícitamente. No se cambia get_property, la galería ni la interfaz. El texto previo de herramientas sigue formando parte del ciclo; el contexto actualizado identifica el intento vigente y separa la memoria histórica.

Se retira one_search_per_turn. Se mantiene el límite existente de siete pasos, tool_choice auto y el mismo número de llamadas por cada acción que el modelo decida realizar; no se agregan llamadas para clasificar o reescribir.

La ubicación completa de resultados y detalles se contrasta con el ámbito resuelto, permitiendo hijos de ese ámbito y eliminando repeticiones administrativas adyacentes como Lima | Lima. Una contradicción explícita produce inconsistent_results, sin adjuntar fichas ajenas ni describirla como ausencia de inventario. Si falta una jerarquía suficiente no se inventa un distrito. No se modifica ningún campo original ni se recortan fotografías.

## Validación
npm.cmd test: **228 pruebas aprobadas, 0 fallos**. Se conservan los 203 casos anteriores y se agregan 25 pruebas en test/geography-regression.test.mjs:
- San Miguel en venta, departamento, PEN y máximo 500000; IDs exactos enviados.
- Padres opcionales, sectores homónimos, tipos y jerarquía completa.
- Confirmaciones, refinamientos y reintentos con un único quicksearch para la ubicación resuelta.
- San Miguel → Miraflores en el mismo turno y en turnos distintos, con filtros compatibles.
- Vacíos, ambigüedades, errores HTTP simulados e inconsistencias entre búsqueda/detalle.
- Ausencia de fichas antiguas como resultados nuevos y recuperación explícita posterior.
- Todas las fotografías, almacenes, distritos nuevos, paginación e IDs inválidos.
- Aislamiento HTTP de sesiones y conservación de GPT-6 Luna, reasoning none y tool_choice auto.

Se ajustan dos fixtures anteriores para que sus propiedades correspondan a la ubicación que declaraban probar: país sintético → Lima en test/app.test.mjs y Lince → Cieneguilla en el caso de rutas duplicadas de test/behavior.test.mjs. No se eliminan casos ni se debilitan sus aserciones.

No se modifican personalidad, modelo, esquemas de herramientas, credenciales, visitas, asesores, frontend, fotos o normalización de propiedades. Cambian únicamente la resolución/consistencia de búsqueda de Tokko, la gestión del conjunto activo y sus pruebas.

## Evaluación real pendiente
El defecto del código está reproducido y corregido con fixtures. No se dispone de la respuesta original real de quicksearch de la conversación reportada; no se afirma haber verificado sus IDs ni disponibilidad actuales. Las simulaciones no garantizan las decisiones espontáneas de OpenAI.

En /demo, con una nueva conversación:
1. Pedir departamento en venta en San Miguel, Lima, hasta S/ 500000.
2. Comprobar búsqueda inmediata, ubicación resuelta y propiedades realmente coincidentes o un vacío válido.
3. Cambiar a Miraflores: conservar venta/departamento/PEN/presupuesto y mostrar solo ese listado.
4. Pedir el inmueble anterior por referencia y revisar todas sus fotos.
5. Si falla Tokko, comprobar que se informa como error y no se presentan inmuebles previos como nuevas coincidencias.

Esta evaluación usa proveedores reales y la ejecutará el usuario. No se realizó push ni despliegue.

## Diagnóstico real posterior — 30/10/2026
La hipótesis sobre Barrio/Localidad de esta entrega anterior quedó refutada por ocho GET reales autorizadas. En Tokko, San Miguel (Lima) y Miraflores metropolitano son Barrio; descartar ese tipo escogía Yauyos o impedía resolver San Miguel. Consulta [el diagnóstico real y la corrección](TOKKO-REAL-2026-10-30.md), que sustituye las conclusiones geográficas basadas únicamente en fixtures anteriores.
