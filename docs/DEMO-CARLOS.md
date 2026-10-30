# Demostración para Carlos · Grupo Rentabilizarme

## Preparación

Desde la rama `codex/demo-whatsapp`, configura las claves solo en el `.env` privado del backend y ejecuta `npm.cmd run dev`. Abre [la demo de mensajería](http://127.0.0.1:8787/demo). La interfaz anterior continúa en [la raíz](http://127.0.0.1:8787/).

Es una simulación visual de la experiencia WhatsApp: no está conectada con WhatsApp Business, no envía mensajes a teléfonos y no usa Meta Cloud API. En el servidor normal, los mensajes sí consultan al agente existente de OpenAI y a su catálogo Tokko: una demostración conversacional real consume la cuota normal de esas APIs y requiere autorización del titular.

Usa una sola pestaña por conversación. Ambas interfaces comparten la cookie y la memoria del backend; para cambiar de vista, navega en la misma pestaña. «Nueva conversación» borra ese contexto. Las sesiones son temporales y se pierden al reiniciar el servidor.

## Escenarios comparables

Ejecuta las mismas solicitudes en ambas soluciones y anota el resultado, sin entrenar respuestas para estos ejemplos. Adapta las frases naturalmente, manteniendo los criterios. Verifica el catálogo y las publicaciones al momento de evaluar.

| Escenario | Qué probar | Qué observar |
| --- | --- | --- |
| Conversación natural | «Hola, ¿cómo estás?», seguido de una necesidad expresada con tus propias palabras. | Responde con naturalidad y empieza a ayudar con la información disponible. |
| Departamento en Miraflores | Pedir un departamento en alquiler en Miraflores hasta 1700 soles. | Interpreta Lima, consulta datos reales y no repite confirmaciones innecesarias. Un resultado vacío puede ser correcto. |
| Cambio de presupuesto | Continuar: «Ahora puedo llegar a 5000». | Conserva Miraflores, alquiler, departamento y PEN; reemplaza el límite previo. |
| Almacenes | En una conversación nueva, pedir almacenes en Lima y después elegir un distrito o presupuesto. | Consulta el tipo inmobiliario y la ubicación correctos sin exigir todos los filtros. |
| Enlace oficial | Compartir [una publicación oficial](https://gruporentabilizarme.com/Propiedades/Detalle?id=11177376) y pedir más información. | Intenta recuperar la ficha sin una búsqueda previa; explica si ya no está disponible o no puede vincularla. |
| Recomendación y comparación | Con resultados: «¿Cuál me recomiendas y por qué?», «Compara la primera y la segunda». | Usa precios y características verificadas, conserva el orden y explica diferencias útiles. |
| Todas las fotografías | «Muéstrame todas las fotos de la segunda» o «de la que te pasé». | Abre la ficha correcta y permite recorrer todas las fotos, incluida la última. |

No hay respuestas programadas para estos escenarios. La disponibilidad cambia y el agente puede pedir una aclaración cuando falta información necesaria.

## Criterios objetivos

Puntúa cada dimensión de 1 a 5 con la misma pauta en ambas soluciones. Registra las frases exactas, las aclaraciones repetidas, el resultado y un ejemplo que justifique la puntuación.

| Dimensión | Evidencia a registrar |
| --- | --- |
| Precisión | Ubicación, operación, tipo, moneda y límites respetados; coincidencia con Tokko; distingue errores técnicos de cero coincidencias. |
| Naturalidad | Comprende reformulaciones y referencias; número de preguntas repetidas; evita convertir la conversación en un formulario. |
| Utilidad | Recomienda con datos concretos, explica diferencias y permite afinar criterios sin perder contexto. |
| Tiempo de respuesta | Segundos desde pulsar enviar hasta recibir la respuesta completa. Medir al menos tres veces por escenario, con la misma red; anotar errores y usar la mediana. |
| Presentación | Legibilidad en móvil, estados de espera y error, facilidad de recorrer opciones y todas sus fotos, sin perder información. |

Una puntuación de 1 indica que no completa la tarea; 3, que la completa con fricción; 5, que la completa correctamente sin ayuda adicional. Mantén separados fallos de interfaz, calidad del modelo y disponibilidad del catálogo.

## Revisión sin consumir APIs

`npm.cmd test` ejecuta las regresiones y pruebas de la nueva vista con servicios simulados.

Para comprobar solo la interfaz: `node scripts/demo-test-server.mjs`, luego abre [la demo de pruebas](http://127.0.0.1:8789/demo). Este servidor separado muestra permanentemente «SOLO PRUEBAS», devuelve fichas sintéticas e imágenes rotuladas y nunca llama a OpenAI o Tokko. No sirve para evaluar inteligencia, precisión del inventario o latencia de las APIs. No se habilita desde el servidor normal.

En ese servidor, cualquier mensaje muestra fichas de prueba. Los comandos exclusivos de pruebas `__error__`, `__empty__`, `__no-photo__` y `__slow__` permiten revisar error recuperable, cero coincidencias, ficha sin fotos y espera prolongada. No existen en el agente real. Detén el servidor con Ctrl+C.

También están disponibles `__mixed__` (galerías de 11, 16 y 17 imágenes), `__short__` y `__long__` (burbujas breves y extensas). En la demo, las flechas y Home/End recorren las fichas; Enter sobre la imagen abre su galería. «Ampliar imagen» permite explorarla y Escape cierra el visor. Si subes por el historial, una respuesta nueva no interrumpe la lectura: aparece «Mensajes nuevos».

La revisión de escritorio y móvil puede hacerse con anchos de 1440, 390 y 320 píxeles. Verifica envío, espera, desplazamiento, navegación entre fichas, descripción completa, fotos 1 y 17, cierre de galería y nueva conversación.

## Verificación de esta entrega

- `npm.cmd test`: 127 pruebas aprobadas tras el rediseño, incluidas las 116 anteriores. Véase [alcance y comprobaciones del rediseño](DEMO-REDISENO.md).
- Navegador con vistas de 1440 × 960, 390 × 844 y 320 × 740 píxeles: sin desbordamiento horizontal de la página y con el campo de escritura visible. Son comprobaciones de viewport, no pruebas en teléfonos físicos.
- Comprobados con el servidor sintético: envío, indicador de espera, bloqueo de doble envío, desplazamiento al final, navegación horizontal de fichas, descripción completa, galería hasta la foto 17, flechas del teclado, Escape, error recuperable y nueva conversación.
- Comprobada la navegación a la interfaz anterior y la conservación del historial en la misma pestaña.
- No se ejecutaron conversaciones reales de OpenAI ni lecturas reales de Tokko durante esta fase. La evaluación de inteligencia y latencia de proveedores queda pendiente de una demostración real autorizada.
