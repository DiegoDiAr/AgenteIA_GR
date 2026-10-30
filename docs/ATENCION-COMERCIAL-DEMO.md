# Atención comercial de demostración

## Qué se implementó
La demo /demo conserva el motor Responses, GPT-6 Luna con reasoning none, herramientas Tokko, memoria y galerías existentes. Agrega borradores temporales de visita y contacto con asesor mediante una herramienta local disponible solo cuando la interfaz envía mode=demo. No hay WhatsApp Business, CRM, agenda, base de datos ni notificaciones.

## Duplicados y presentación de fichas
La memoria knownProperties ya usaba un mapa por ID, pero las fichas del turno se acumulaban con push en un array desde búsqueda, get_property y show_property. El mismo ID podía entrar varias veces y responseCards repetía esas entradas. El frontend dibujaba el array recibido sin inventar el duplicado.

Se reprodujo con un inmueble **sintético** con referencia GAP11177376: búsqueda → get_property → show_property producía tres tarjetas de un solo ID. La acumulación ahora usa un mapa por ID canónico de Tokko, por turno. Las búsquedas también deduplican IDs antes de construir referencias, posiciones, conteos y último listado. No se usan títulos, referencias comerciales ni similitud de fotos como identidad. Las respuestas originales de Tokko no se mutan; no se presupone correspondencia entre el ID web y Tokko.

Las fotografías devueltas para el mismo ID se unen por URL, conservando todas las imágenes distintas y evitando multiplicar la misma URL al repetir una ficha. Se conservan orden, IDs y posiciones para referencias posteriores. El mapa de fichas vuelve a empezar vacío en cada turno: show_property puede mostrar de nuevo una propiedad solicitada más tarde.

get_property con un ID conocido lee su descripción íntegra sin añadir una tarjeta nueva. Las propiedades nuevas y enlaces explícitos siguen mostrando su ficha; show_property representa la acción explícita de volver a mostrar. Si varias herramientas se refieren al mismo ID en un turno, se actualiza una sola ficha y responseCards coincide con ella.

## Búsqueda genérica
Se distingue una solicitud sin criterios útiles en mensaje ni historial de una búsqueda parcial útil. En el primer caso el modelo puede aclarar naturalmente compra/alquiler y tipo; no debe abrir un catálogo mezclado por defecto. Con criterios como departamento, alquiler y Miraflores se conserva la búsqueda inmediata sin pedir presupuesto. No se añade un clasificador de frases ni un requisito backend que obligue a completar filtros. OpenAI conserva tool_choice auto.

## Solicitud de visita
Con una propiedad recuperada, el usuario puede pedir visitarla. OpenAI recopila lo que falta y llama a prepare_demo_request con kind=visit. Puede guardar datos incompletos:
1. Propiedad y nombre conocidos: borrador; faltan contacto, fecha preferida y hora aproximada.
2. Se agrega contacto y fecha: se conservan propiedad y nombre; falta hora.
3. Se agrega hora: estado preparado y resumen visible, con comentario opcional.
4. El usuario puede cambiar propiedad, fecha, hora o datos de contacto conversando. Corregir solicitud prepara el campo de escritura; no envía nada automáticamente.

Las fechas y horas son preferencias expresadas, no turnos disponibles. La herramienta no consulta calendarios ni confirma disponibilidad. La propiedad debe ser un ID conocido; una referencia ambigua requiere aclaración del modelo.

## Contacto con asesor
kind=advisor necesita solo nombre y contacto. Reutiliza los datos ya guardados para esta persona, sin exigir fecha u hora. La propiedad es opcional; una visita ya preparada aporta su propiedad elegida para asociarla al nuevo contacto, y una propiedad diferente puede indicarse o corregirse explícitamente. No se elige arbitrariamente entre varios inmuebles.

El cliente puede pedir revisar la solicitud sin volver a escribir los datos, corregirlos o retirarlos. null conserva los valores anteriores; reset_fields retira un campo indicado por el usuario.

## Estado real del prototipo
Un borrador muestra Borrador — simulación. Cuando están los datos necesarios, muestra exactamente:

**Solicitud preparada — simulación, pendiente de confirmación**

El resumen añade No enviada. Sin reserva ni disponibilidad confirmada. Los indicadores internos simulation=true, notified=false y confirmed=false no cambian a valores reales. Ninguna herramienta envía mensajes ni crea citas, incluso con todos los datos completados.

Los resúmenes son UI de estado con texto seguro, no respuestas comerciales predeterminadas del agente. OpenAI mantiene la redacción conversacional y la recopilación progresiva. Los detalles internos y solicitudes no necesitan repetir fichas inmobiliarias.

## Estado temporal y privacidad
El estado comercial está en session.demoState dentro del mapa en memoria del servidor, junto con la sesión existente: no se escribe a disco ni a una base de datos y queda aislado por cookie. Nueva conversación lo elimina; el reinicio lo pierde y se aplica la caducidad existente por inactividad de dos horas. Las referencias de inmuebles elegidos en solicitudes activas se protegen del descarte de la memoria de propiedades.

La demo no persiste su transcripción ni datos personales en sessionStorage. Al recargar se limpia la presentación; mientras la sesión del backend siga vigente, se puede pedir revisar la solicitud para volver a verla. La interfaz original conserva su comportamiento de almacenamiento existente y no expone la herramienta ni el estado estructurado de solicitudes. Ambas vistas comparten la sesión del navegador como antes; el historial de esa sesión sigue siendo común. Los datos enviados en el chat se procesan mediante OpenAI, como el resto de la conversación, y no se remiten a asesores.

AGENT_DIAGNOSTICS conserva solo nombres de herramientas, estados, conteos, latencias y contadores de tokens seguros. No registra argumentos, nombres, contactos ni comentarios. Los errores de validación tienen mensajes fijos sin datos personales.

## Procedimiento de Carlos
El archivo **config/commercial-process.mjs** es el único lugar preparado para incorporar el procedimiento oficial. Actualmente contiene:
- status: pending_carlos.
- source: null.
- rental: null.
- purchase: null.

No hay reglas inventadas. La descripción publicada de un inmueble sigue siendo una fuente propia de condiciones y no se generaliza a todos los demás. La orientación general debe identificarse como tal; no equivale al procedimiento de Grupo Rentabilizarme.

Cuando Carlos entregue el procedimiento: documentar la fuente/aprobación en source, transcribir únicamente sus instrucciones confirmadas en rental y/o purchase, actualizar el estado y sus pruebas y reiniciar el servidor. No completar los campos con supuestos. El modelo recibe esta configuración en el contexto verificado; no se requiere otra integración.

## Markdown seguro
Antes se usaba textContent para todo el mensaje, por eso aparecían los asteriscos. El nuevo renderizador crea nodos de texto y solo strong, em y code para formato inline. Conserva saltos de línea. No interpreta HTML, imágenes, scripts ni enlaces Markdown y no usa innerHTML. El texto del cliente y los datos de solicitudes también se insertan como texto.

## Validación
npm.cmd test: **178 pruebas aprobadas, 0 fallos**. Se conservan los 161 casos anteriores; cuatro expectativas antiguas se adaptan al contrato solicitado de leer detalles sin repetir fichas. Hay 17 casos nuevos: deduplicación/cantidades/galerías, borradores y edición, asesor, aislamiento HTTP, ausencia de notificaciones, datos personales fuera de logs, búsqueda genérica seguida de criterios útiles, procedimiento pendiente y formato seguro.

Todos los proveedores automatizados son sintéticos. La reproducción de duplicados usa datos ficticios identificados; no inserta una propiedad real manualmente en el catálogo.

También se revisaron en navegador el servidor **aislado** scripts/demo-test-server.mjs y sus escenarios etiquetados SOLO PRUEBAS: borrador, visita completa, corrección de fecha/hora/propiedad, contacto con datos reutilizados, negrita sin asteriscos, HTML inerte, carrusel con galerías de 11/16/17 fotos y acceso a la foto 17 de 17 con cierre por Escape. Esta comprobación visual no prueba las decisiones espontáneas del modelo real. Los comandos especiales __visit_draft__, __visit_complete__, __visit_edit__, __advisor__, __markdown__ y __mixed__ existen exclusivamente en ese servidor de pruebas; no son funciones ni respuestas fijas de /demo real.

Queda pendiente comprobar con OpenAI y Tokko reales la naturalidad, la aclaración de búsquedas genéricas y la recopilación espontánea de datos. No se realizaron llamadas reales durante esta implementación, ni push ni despliegue.

## Evaluación manual en /demo
Tras el reinicio pulsa Nueva conversación:
- Solicita una propiedad genéricamente; después concreta departamento de alquiler en Miraflores.
- Con una ficha real, pide visita y proporciona los datos en varios mensajes.
- Cambia fecha, hora o propiedad y revisa el resumen.
- Pide hablar con un asesor y comprueba que reutilice datos ya disponibles sin notificar a nadie.
- Pregunta cómo continuar con compra/alquiler: debe distinguir condiciones publicadas, orientación general y procedimiento pendiente.
- Pide volver a ver una propiedad y revisa toda su galería.

Esta evaluación manual sí usa las APIs reales y su consumo habitual; no se ejecutó automáticamente.

## Archivos de esta entrega
Backend:
- lib/chat.mjs
- lib/property-results.mjs (nuevo)
- lib/demo-requests.mjs (nuevo)
- server.mjs
- config/commercial-process.mjs (nuevo)

Interfaz:
- public/app.js
- public/demo.css
- public/message-format.mjs (nuevo)
- public/demo-requests.js (nuevo)

Pruebas y servidor aislado:
- scripts/demo-test-server.mjs
- test/property-results.test.mjs (nuevo)
- test/demo-requests.test.mjs (nuevo)
- test/message-format.test.mjs (nuevo)
- test/context.test.mjs
- test/personality.test.mjs
- test/model-comparison.test.mjs
- test/demo.test.mjs

Documentación:
- docs/ATENCION-COMERCIAL-DEMO.md (nuevo)
- docs/CONTEXTO-MODELO.md
- docs/DEMO-CARLOS.md

Los cambios locales previos, incluida la configuración de diagnóstico, se conservaron. Esta entrega no cambió .env, claves, lib/tokko.mjs, lib/errors.mjs ni package.json.

## Actualización: fechas normalizadas
La preferencia de visita ahora se guarda como fecha ISO y hora de 24 horas, resuelta en America/Lima con la referencia del mensaje. El resumen incluye día de semana y aclaraciones. Las solicitudes siguen siendo simuladas. Consulta [Fechas y horarios](FECHAS-VISITAS.md) para el contrato, las ambigüedades y las pruebas con reloj controlado.
