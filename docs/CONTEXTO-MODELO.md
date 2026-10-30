# Contexto del modelo sin fichas duplicadas

## Causa y alcance
Antes de esta corrección local, cada búsqueda proyectaba la misma descripción en tres lugares del siguiente payload de Responses: el resultado de herramienta, `lastSearch.properties` y `knownProperties`. `responseCards` indicaba las fichas visibles, pero no eliminaba esa duplicación. La proyección también cortaba las descripciones a 5000 caracteres, aunque el backend conservaba el original.

Esto daba peso innecesario al texto comercial del proveedor. Que favoreciera el tono de catálogo es una hipótesis coherente con el payload; no se ha demostrado con una evaluación nueva de OpenAI real.

## Contrato actual
- `knownProperties` tiene un único resumen estructurado por ID: conserva todos los campos normalizados salvo descripción y URLs de fotografías. Incluye precios y operaciones, ubicación, tipo, superficies, dormitorios, ambientes, baños, cocheras, características, referencias, enlaces y conteo de fotos. `descriptionAvailable` indica si hay una descripción guardada.
- `lastSearch.properties` y las salidas de herramientas contienen referencias `{ id, photoCount }`, sin repetir el inmueble. Se mantienen el orden, filtros, ubicación resuelta, paginación y estados de búsqueda.
- `search_properties` proporciona los resúmenes para recomendar sin enviar descripciones comerciales. `show_property` muestra fichas y galerías sin cargar la descripción en el contexto del modelo.
- `get_property` con un ID conocido lee el inmueble completo de la memoria de la sesión, sin consultar Tokko. Si el ID no es conocido o se comparte un enlace, conserva la recuperación existente mediante Tokko y la resolución oficial del enlace.
- Después de `get_property`, `propertyDetails` entrega la descripción íntegra asociada al ID. Un mapa mantiene una sola copia por inmueble en el payload, incluso si se consulta varias veces en el mismo turno. No se aplica el recorte anterior de 5000 caracteres.
- `propertyDetails` comienza vacío en el siguiente turno. Las descripciones originales siguen en la sesión: pueden recuperarse de nuevo. El historial, IDs del último listado y última ficha consultada se conservan como antes.
- `responseCards` se deriva de las mismas fichas completas que se envían al frontend. Consultar un ID conocido ahora lee los detalles sin repetir la ficha; para mostrarla explícitamente se usa show_property. Véase ATENCION-COMERCIAL-DEMO.md para el ajuste posterior de duplicados y atención comercial. Una galería conserva todas sus imágenes.
- OpenAI decide si necesita consultar detalles que no figuran en los datos estructurados. No hay clasificación por frases, plantillas ni reescritura posterior. No se añade una llamada para corregir estilo; leer detalles utiliza el ciclo existente de herramientas.

Solo se ajustan las proyecciones del modelo y las indicaciones técnicas sobre su lectura. La voz, el modelo configurado, parámetros y esquemas strict de herramientas, filtros, integración Tokko, sesiones y frontend permanecen conservados. La descripción sigue tratándose como datos externos, nunca como instrucciones ni como guion de estilo.

## Medición reproducible, sin APIs reales
Se capturó el payload local antes de editar y después con el mismo escenario sintético: un departamento con descripción de **2100 caracteres**, **11 fotografías**, búsqueda parcial y consulta posterior de detalles. Los proveedores y decisiones están simulados; no se emplean credenciales reales ni datos de clientes.

Comando para reproducir la medición de la versión actual:

```powershell
node scripts/measure-context.mjs
```

| Momento | Datos/contexto + herramientas antes (bytes UTF-8) | Después | Copias de la descripción antes → después | Payload JSON completo antes → después |
| --- | ---: | ---: | --- | --- |
| Antes de buscar | 153 | 174 | 0 → 0 | 15816 → 16980 |
| Después de buscar | 9631 | 2195 | 3 → 0 | 26240 → 19809 |
| Turno posterior, antes de pedir detalles | 6524 | 1729 | 2 → 0 | 22619 → 18897 |
| Después de pedir detalles | 9270 | 4072 | 3 → 1 | 25637 → 21452 |

La parte de datos y herramientas tras buscar se reduce aproximadamente **77,2 %**. El payload JSON completo baja aproximadamente **24,5 %** en ese paso, pese a añadir instrucciones técnicas para consultar los detalles. Antes de buscar sin propiedades, el payload crece por ese contrato técnico y el campo vacío de detalles. No son mediciones de tokens ni de facturación.

La columna de datos suma la serialización del contexto verificado y de las salidas de herramientas decodificadas. El payload completo incluye instrucciones, historial y esquemas con los escapes JSON correspondientes. No se suman encabezados ni se imprime el cuerpo: el script solo muestra cantidades. Los conteos de descripción buscan campos de datos, no textos del historial natural.

En el escenario, la búsqueda sigue ejecutándose una vez. La lectura posterior de un ID conocido pasa de una consulta simulada a Tokko a **cero**, al usar memoria local. Ninguna consulta real fue ejecutada.

## Pruebas y límites
`npm.cmd test`: **151 pruebas aprobadas, 0 fallos**. Se conservan los 147 casos locales previos y se añaden cuatro regresiones de contexto. Las verificaciones anteriores que exigían descripciones duplicadas se actualizan al contrato de resumen y recuperación explícita; no se eliminan sus escenarios.

Se comprueban resúmenes completos, referencias y posiciones, precios de comparación, filtros y presupuesto, respuesta completa al frontend, ausencia de mutaciones del proveedor, galerías de 11/16/17 fotos, descripción superior a 5000 caracteres, deduplicación incluso tras consultas repetidas, enlaces, datos ausentes y reinicio de detalles por turno. Las consultas de memoria no invocan Tokko y los saludos siguen sin requerir búsquedas.

Las pruebas simulan qué herramientas elige el modelo. Falta evaluar con OpenAI real si:
1. Recomienda desde el resumen sin recitar la ficha.
2. Usa `get_property` cuando necesita condiciones o detalles que solo están en la descripción.
3. Mantiene referencias y precisión al comparar, y la voz cercana después de usar herramientas.
4. No ofrece como pendientes fotos ya visibles.

Abre [la demo](http://127.0.0.1:8787/demo) y pulsa **Nueva conversación** después del reinicio. Esa evaluación manual sí utiliza las APIs reales; no se realizó durante esta implementación.
