# Voz conversacional y presentación de fichas

## Actualización: resúmenes y detalles bajo consulta
La duplicación descrita en las etapas anteriores queda corregida en [CONTEXTO-MODELO.md](CONTEXTO-MODELO.md): un resumen por ID, referencias en herramientas y última búsqueda, descripción íntegra disponible mediante get_property desde memoria. Resultado actual: **151 pruebas aprobadas**, sin llamadas reales. La evaluación de naturalidad con OpenAI real sigue pendiente.

## Actualización: iniciativa comercial y diagnóstico
El ajuste posterior prioriza la consulta con filtros conocidos antes de pedir preferencias opcionales. Se mantiene esta voz y `responseCards`. El diagnóstico local, apagado por defecto, permite distinguir ausencia de herramientas, invocación de Tokko y resultados/errores sin registrar contenido del cliente. Véase [DIAGNOSTICO-LOCAL.md](DIAGNOSTICO-LOCAL.md) para la comparación con `e19a808`, activación y reproducción manual de los tres casos.

Resultado de esa etapa: **147 pruebas aprobadas, 0 fallos**, incluidas las 136 de la etapa descrita debajo. La validación de iniciativa y naturalidad con OpenAI real sigue pendiente.

## Diagnóstico del prompt efectivo
Cada petición a OpenAI contiene las instrucciones de `lib/chat.mjs`, el contexto JSON verificado, las herramientas y el historial del intercambio. Después de ejecutar una herramienta, también contiene su resultado como `function_call_output`.

La voz ya diferenciaba conversar, presentar y explicar, pero esa indicación era general. El contexto no identificaba qué fichas iban a acompañar la respuesta actual: `knownProperties` incluye propiedades recordadas, no solo las que se van a mostrar. `get_property` y `show_property` incluían `galleryDisplayed`; la búsqueda no incluía ese indicador.

Una medición con un proveedor **sintético**, sin conexiones externas, confirmó que una descripción de 2100 caracteres aparecía tres veces tras la búsqueda: en el resultado de herramienta, en `lastSearch.properties` y en `knownProperties`. El modelo recibía 11 como conteo de fotos y el frontend las 11 URLs, pero no había una lista de fichas de esa respuesta en el contexto.

Ese peso del texto comercial y la falta de una señal por turno pueden favorecer la reproducción de la descripción. Es una explicación técnica plausible, no una demostración causal de cómo razonó OpenAI en las conversaciones reales.

## Ajuste concreto
- Se sustituyó el párrafo general de presentación por una pauta que aplica la misma voz al recomendar, comparar y comentar enlaces. El texto aporta una razón útil para el cliente; una comparación destaca diferencias decisivas y una pregunta puntual recibe una respuesta directa.
- Se explicitó que la descripción de Tokko aporta datos, no el tono de voz ni el guion de la respuesta.
- Se reemplazaron las indicaciones repetidas sobre enumerar y justificar opciones por un contrato de presentación conectado con las fichas reales del turno.
- Se conserva la voz cercana, alegre y resolutiva, adaptada al interlocutor, con emojis y humor opcionales y ejemplos orientativos. La explicación amplia sigue disponible cuando se solicita.
- No se agregan plantillas, detección de frases, cuotas de longitud ni un filtro que reescriba la respuesta.

Los ajustes previos ya habían retirado de la descripción de `search_properties` la orden de preguntar después de buscar. Esta entrega conserva ese cambio y las demás modificaciones locales existentes.

## Señal de presentación
Se añade solamente `responseCards` al JSON que acompaña cada petición del modelo. Se deriva de las mismas propiedades que el backend devolverá al frontend en esa respuesta:

```json
{
  "responseCards": [
    { "propertyId": 123, "resultIndex": 1, "photoCount": 11 }
  ]
}
```

El ID anterior es solo ilustrativo del formato, no una propiedad incorporada al catálogo. La lista empieza vacía en cada turno y se actualiza cuando las herramientas añaden fichas. Conserva su orden, admite posiciones nulas para propiedades externas al último listado y señala cero cuando una ficha no tiene fotos. Una propiedad recordada no se anuncia automáticamente como una ficha nueva.

El prompt explica que esas fichas se adjuntarán al texto y ofrecerán precio, ubicación, características, descripción, enlace y galería según los datos disponibles. No hay un clasificador de intención: **OpenAI sigue decidiendo si corresponde presentar, comparar, explicar o conversar**. Tener una ficha adjunta no impide una explicación detallada solicitada.

En esa etapa todavía no se eliminaban las descripciones repetidas y se mantenía el límite previo de 5000 caracteres para el modelo. Ambas limitaciones quedan reemplazadas por el contrato actual de resúmenes y detalles documentado en CONTEXTO-MODELO.md. Las descripciones y fotografías completas conservadas en la sesión y enviadas a las fichas permanecen intactas.

No cambian esquemas, filtros, búsquedas, geografía, memoria, enlaces, endpoint Responses, modelo, límite de salida, número de pasos, sesiones ni frontend. No hay otra llamada al modelo para editar el texto.

## Pruebas
Resultado de la etapa anterior: **136 pruebas aprobadas, 0 fallos**.

Se ejecutan las 133 pruebas de la versión local anterior, que incluyen las 131 solicitadas, más tres regresiones:
- Una consulta detallada mantiene sus datos recordados sin anunciar fichas nuevas ni volver a consultar el proveedor.
- Un resultado vacío y un error mantienen sus estados distintos y no anuncian propiedades recordadas como fichas nuevas.
- Una ficha sin fotos informa cero sin perder el resto de los datos publicados.

Además, las regresiones de búsqueda/comparación y enlace verifican que `responseCards` coincida con las fichas, posiciones y conteos devueltos; que se acumule correctamente tras varias herramientas y que se reinicie en el siguiente turno. Siguen comprobándose presupuestos, filtros y galerías de 11, 16 y 17 fotos.

Todos los proveedores y publicaciones de pruebas son sintéticos e inyectados mediante `fetchImpl`. No se realizaron llamadas reales a OpenAI ni Tokko. Las pruebas verifican transporte de datos y herramientas ante decisiones simuladas; **no validan el carisma ni la elección de herramientas del modelo real**.

## Evaluación manual preparada: cinco escenarios
Abre [la demo](http://127.0.0.1:8787/demo) y pulsa «Nueva conversación» tras el reinicio. Tus envíos desde esa vista sí usarán los proveedores reales y su consumo habitual. Estos escenarios quedaron preparados, no ejecutados durante el desarrollo.

| Escenario | Punto de partida | Qué observar con OpenAI real |
| --- | --- | --- |
| Saludo informal | Conversación nueva: «Holaa, ¿qué tal?». Continúa con un comentario cotidiano. | Cercanía sin introducir propiedades artificialmente, sin repetir fórmulas ni inventar vivencias humanas. |
| Recomendación de propiedad | «Me gustaría alquilar un depa en Miraflores hasta 5000 soles, ¿qué me recomiendas?». | Busca con los criterios conocidos. Si hay resultados, mantiene la voz cercana al explicar por qué encajan y aprovecha las fichas; no recita descripciones ni ofrece las fotos disponibles como un paso pendiente. |
| Reacción al precio elevado | Tras recibir una ficha real: «Uy, está carísima JAJAJA. Bajemos a 2500 soles». | Acompaña el humor sin forzarlo ni atribuir un presupuesto inventado. Actualiza el límite, conserva ubicación, operación y moneda y busca alternativas reales. |
| Comparación inmobiliaria | Con dos opciones verificadas: «¿Cuál de estas dos me recomendarías para lo que te conté?». | Explica las diferencias útiles y su recomendación con criterio, sin recorrer nuevamente todos los campos de ambas fichas. Si solo hay una opción real, no inventa una segunda para completar la comparación. |
| Consulta detallada de una propiedad | Sobre una ficha recuperada: «Explícame sus características, costos y condiciones publicados con detalle». Después: «¿Tiene ascensor?». | Puede desarrollar lo necesario con datos publicados y reconocer lo desconocido; la pregunta puntual posterior recibe una respuesta directa, sin otra presentación comercial. |

Si no hay coincidencias o falla el proveedor, evalúa que lo explique con empatía y exactitud; no exijas un inmueble concreto. También puedes compartir una publicación oficial de otra zona o expresar entusiasmo para comprobar la continuidad de la voz.

Registra el intercambio completo y contrasta precios, características y condiciones con las fichas. Valora cercanía, utilidad, precisión y adecuación del detalle, sin exigir frases, emojis o cantidades de palabras. Comprueba especialmente que la voz se mantenga después de usar herramientas, no solamente en el saludo.

Queda pendiente validar con OpenAI real si la señal de fichas y el ajuste del prompt consiguen esa continuidad. No se da por resuelto el tono solo porque pasen las regresiones simuladas.
