# Prueba controlada: GPT-6 Luna

## Actualización posterior: confirmaciones contextuales
Se mantiene Luna con reasoning none. Tras la comparación inicial se acotaron cuatro fragmentos de iniciativa, sin cambiar la voz ni herramientas. El diagnóstico y la validación actual (**161 pruebas**) están en [CONFIRMACIONES-CONTEXTUALES.md](CONFIRMACIONES-CONTEXTUALES.md). La huella y el resultado de 155 pruebas descritos debajo corresponden a la preparación anterior de la comparación.

Estado: configuración preparada para evaluación manual. No se ejecutaron conversaciones reales ni consultas reales a Tokko durante esta tarea.

## Referencia y cambio
- Modelo anterior, leído de `.env`: `gpt-4.1-mini`. No había una variable `OPENAI_MODEL` heredada que lo sustituyera.
- Modelo de la prueba en el `.env` privado: `OPENAI_MODEL=gpt-6-luna`.
- Parámetro de la prueba: `reasoning: { effort: 'none' }`. Solo se envía cuando el modelo configurado es exactamente `gpt-6-luna`; al volver al modelo anterior deja de enviarse.
- Referencia privada sin claves: `.env.model-reference.json`. Tanto este archivo como `.env` están excluidos de Git.
- Todas las demás variables del archivo, incluidas las credenciales, se comprobaron iguales antes y después del cambio.

La [ficha oficial de GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna) documenta Responses API, function calling y `reasoning.effort=none`. El esfuerzo por defecto es medium; se elige none para esta comparación enfocada en conversación y herramientas. No se presupone una mejora de calidad o latencia sin medirla.

Se comprobó acceso con **GET /v1/models/gpt-6-luna**, que respondió **HTTP 200** con el ID solicitado. Fue una lectura de metadatos sin generación ni tokens de inferencia. Esto confirma acceso al modelo, no valida todavía una conversación real ni todos sus parámetros con esa cuenta.

El ciclo existente conserva todos los elementos de `response.output` dentro del turno, incluidos elementos de razonamiento opacos si llegan, como indica la [guía oficial de razonamiento](https://developers.openai.com/api/docs/guides/reasoning). No fue necesario modificarlo.

## Variables mantenidas
La prueba no modifica el prompt de personalidad, el JSON de contexto, esquemas ni descripciones de herramientas, filtros, memoria, Tokko, fichas o galerías. Tampoco cambia `tool_choice: auto`, ejecución secuencial, `store: false`, máximo de siete pasos ni el límite de 2200 tokens de salida. No hay otra llamada para reescribir respuestas.

Las instrucciones conservan la misma huella SHA-256 que antes de la comparación:
`f240a00af493f02cac826744bc23ded7630a103d872afc697e7495f901c1c37f`.

## Evaluación manual
Abre [la demo](http://127.0.0.1:8787/demo) y pulsa **Nueva conversación** después del reinicio. Ejecuta estas tres situaciones en orden dentro de la misma conversación:

| Paso | Mensaje | Qué observar |
| --- | --- | --- |
| 1 | Hola, quiero alquilar un departamento en Miraflores. ¿Qué me recomiendas? | Busca con criterios parciales; presenta resultados reales con relevancia y cercanía; complementa la ficha sin recitarla ni ofrecer fotos pendientes. |
| 2 | Uy, está bastante caro JAJAJA. ¿No tienes algo más económico? | Reacciona naturalmente sin forzar humor; conserva distrito, operación y tipo; usa el precio y moneda conocidos para buscar algo más económico sin inventar datos. |
| 3 | Cuéntame todos los detalles de ese departamento. | Identifica la referencia, recupera descripción íntegra mediante get_property cuando corresponda y explica datos publicados sin inventar condiciones. |

No se exige encontrar una propiedad específica. Una búsqueda válida sin coincidencias y un error técnico deben mantenerse diferenciados. Comprueba que las fichas y todas sus fotos se conserven y que un inmueble no se presente como disponible sin evidencia.

Para una comparación justa, repite luego la misma secuencia en una conversación nueva con el modelo de referencia, conservando el código y configuración restante. Los resultados de catálogo pueden cambiar con el tiempo. Registra por separado naturalidad, carisma, precisión, uso de herramientas, repetición y completitud de fichas/fotografías. No puntúes al modelo por copiar frases o usar emojis.

## Métricas locales
El diagnóstico existente sigue desactivado por defecto. Para esta sesión de evaluación se inicia el servidor con `AGENT_DIAGNOSTICS=1` solo en su proceso local, sin cambiar el archivo privado por ese motivo.

Los eventos `agent_model_result` ahora incluyen modelo, esfuerzo configurado, `elapsedMs` y contadores numéricos de uso cuando el proveedor los devuelve:
- `inputTokens`, `outputTokens`, `totalTokens`.
- `cachedInputTokens` y `reasoningTokens`.

Un contador ausente o inválido aparece como null; no equivale a cero. Para consumo por turno, suma los contadores de sus solicitudes con el mismo traceId, considerando que `cachedInputTokens` forma parte de la entrada y `reasoningTokens` de la salida: no vuelvas a sumarlos al total. La latencia de cada evento corresponde a la solicitud de modelo; los eventos de Tokko permiten separar el tiempo del proveedor. El tiempo percibido incluye ambos y la interfaz.

No se registran mensajes, argumentos, descripciones, URLs de propiedades ni credenciales. No se añaden solicitudes para medir. Estas métricas todavía no contienen una comparación real de calidad, latencia o consumo entre modelos.

## Pruebas ejecutadas
`npm.cmd test`: **155 aprobadas, 0 fallos**. Se conservan las 151 previas y se añaden cuatro regresiones con proveedores sintéticos:
1. Igualdad de prompt, contexto, herramientas y límites entre modelos, salvo modelo y reasoning.
2. Búsqueda parcial, precio más económico, referencias, fotos y descripción completa desde memoria, incluyendo replay de elementos opacos de Responses.
3. Métricas numéricas seguras, sin datos privados ni contadores inventados.
4. Selección de OPENAI_MODEL en el backend HTTP para las dos interfaces y su endpoint compartido.

No se emplearon credenciales reales en estas pruebas. No demuestran que el modelo real sea más natural ni que escoja espontáneamente las herramientas correctas.

## Reversión
En el `.env` privado vuelve a dejar:

```dotenv
OPENAI_MODEL=gpt-4.1-mini
```

Reinicia únicamente este servidor con `npm.cmd start` y abre una conversación nueva. No cambies claves ni otros valores. No hace falta revertir el código: con el modelo anterior se omite reasoning automáticamente y las métricas locales no cambian las respuestas.

Si una evaluación manual devuelve model_not_found, falta de acceso o incompatibilidad de parámetros, conserva el código y restaura ese valor antes de continuar. No se programa un cambio silencioso de modelo ni reintentos adicionales que puedan consumir saldo. No se encontraron errores de acceso en la consulta de metadatos ni errores en las pruebas locales; la ejecución real de Responses queda para el usuario.
