# Confirmaciones breves e iniciativa contextual

## Evidencia y diagnóstico
En los registros existentes de la evaluación manual se observan dos respuestas sin herramientas, seguidas de un evento `agent_model_result` con `search_properties`. Para esa llamada, `agent_tokko` termina con `status=matches` y `resultCount=5`; después el modelo genera texto. El modelo solicitó una búsqueda real y el backend la ejecutó. No fue solamente una reaparición visual de fichas.

Los registros no guardan mensajes ni IDs de sesión. Por sí solos no permiten vincular cada evento a una frase específica ni reconstruir el payload privado de aquel intercambio. La secuencia observada es consistente con el caso reportado por el usuario; no se volvió a ejecutar contra OpenAI real durante esta corrección.

El historial se construye con los mensajes de la sesión y el mensaje actual. El servidor crea un objeto, historial y mapa de propiedades independientes por cookie de sesión. Las fichas de cada respuesta empiezan vacías y solo se añaden al ejecutar herramientas. El frontend representa `data.properties` del turno; no inyecta automáticamente las propiedades recordadas. Su transcripción visual guardada no se envía al modelo. Las vistas / y /demo comparten deliberadamente la sesión del navegador; Nueva conversación la reinicia.

No se encontró un defecto de aislamiento en esta revisión. Se añadió una comprobación HTTP que intercala dos sesiones y reinicia una de ellas: no se cruzan mensajes, criterios, IDs ni fichas, y una cookie eliminada recibe session_expired.

## Cambio mínimo
Se ajustan cuatro fragmentos de `INSTRUCTIONS` en `lib/chat.mjs`:
1. La iniciativa se aplica a una solicitud inmobiliaria o a la aceptación contextual de una propuesta concreta. Buscar por falta de resultados queda dentro de esa solicitud.
2. El distrito predeterminado Lima se aplica a una búsqueda solicitada, no a una charla social.
3. Las respuestas breves toman su significado de la pregunta/propuesta anterior y del historial. Una aceptación de buscar permite ejecutar esa propuesta; un asentimiento social no crea una solicitud ni elige filtros. Un referente realmente ambiguo admite una aclaración breve.
4. Tener propiedades recordadas no obliga a recomendarlas: esa instrucción se aplica cuando el cliente pide opciones.

La causa probable de la regresión era el alcance ambiguo de imperativos proactivos como buscar si no hay resultados o usar Lima por defecto, junto con la pauta de retomar opciones tras una aceptación. Aunque existía la indicación de que la conversación social no necesitaba búsquedas, no se explicitaba que un asentimiento social tampoco las iniciaba.

No hay un detector de palabras, un veto de herramientas por mensaje ni una nueva máquina de estados. OpenAI conserva `tool_choice: auto`. La personalidad y sus ejemplos permanecen iguales, al igual que modelo `gpt-6-luna`, `reasoning.effort=none`, parámetros, esquemas, contexto, filtros y ejecución de herramientas. No cambian Tokko, credenciales, frontend, galerías ni sesiones.

## Pruebas locales
`npm.cmd test`: **161 pruebas aprobadas, 0 fallos**. Se conservan las 155 previas y se añaden seis casos en `test/initiative-context.test.mjs`:
- Diálogo social completo con historial exacto, sin llamadas al proveedor ni fichas.
- Hola → Bien bien → confirmación, probando sí, ok, dale y claro en sesiones nuevas.
- Aceptación de una propuesta explícita con distrito, departamento y alquiler; búsqueda con sus criterios y ficha completa.
- Solicitud directa sin presupuesto: el proveedor simulado recibe tipo y operación correctos, excluyendo casa, almacén y venta.
- Cambio de distrito y presupuesto, conservando tipo, operación, moneda y todas las fotos.
- Dos sesiones HTTP intercaladas, fichas desde memoria, confirmación social y reinicio: aislamiento de historial y criterios.

Los diagnósticos simulados distinguen no_tool_calls de la búsqueda con resultados. El catálogo y las decisiones están inyectados y marcados como sintéticos. Estas pruebas verifican el transporte y las consecuencias de decisiones simuladas; no demuestran que OpenAI real elija siempre la herramienta adecuada.

## Repetición manual pendiente
Después del reinicio, abre [la demo](http://127.0.0.1:8787/demo) y pulsa **Nueva conversación**:
- Repite Hola → Bien bien → Sí. Debe seguir conversando sin fichas ni búsquedas.
- En otra conversación, acepta una propuesta explícita de buscar. Debe retomar los criterios de esa propuesta.
- Solicita directamente un departamento de alquiler en Miraflores sin presupuesto; después cambia distrito o presupuesto. Debe conservar los filtros que no cambian y devolver fichas pertinentes.

El diagnóstico permanece apagado por defecto. El servidor de evaluación se inicia con AGENT_DIAGNOSTICS=1 en su proceso local para revisar la siguiente prueba real, sin registrar contenido del cliente ni claves. En el caso social esperado deben aparecer eventos no_tool_calls y ninguno agent_tokko. Si vuelve a buscar, la llamada quedará distinguida de un problema de presentación.

No se realizaron solicitudes reales a OpenAI ni Tokko durante esta tarea. Leer los registros de pruebas manuales previas no constituye una nueva prueba real. El efecto de esta corrección en las decisiones espontáneas del modelo queda pendiente de esa evaluación. No se hizo push ni despliegue.
