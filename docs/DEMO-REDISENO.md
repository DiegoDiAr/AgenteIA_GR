# Rediseño de la demo de mensajería

## Alcance y criterio visual
Intervención sobre la rama existente `codex/demo-whatsapp`. La revisión inicial partió de la demo real y de capturas a 1366 × 768 y 390 × 844. Se conservan el cliente compartido, sus datos, endpoints, sesión y galerías; no se cambian instrucciones del modelo, integración OpenAI/Tokko ni archivos de `lib/`.

## Revisión y correcciones
1. **Contexto:** conversación inmobiliaria para una demostración a Carlos, con prioridad móvil y estética sobria verde.
2. **Jerarquía:** el contenedor blanco agrupaba texto y resultados como un documento. Ahora la burbuja tiene ancho de lectura independiente y las fichas aparecen debajo, sobre el fondo del chat.
3. **Distribución:** el panel podía crecer más que la cuadrícula y cortar el encabezado. Se establecieron filas y alturas mínimas correctas; el sidebar mantiene un ancho proporcionado, título completo y scroll propio cuando falta altura.
4. **Resultados:** fotografía proporcionada, precio destacado, ubicación completa, datos publicados, iconos discretos, descripción desplegable y acciones de 44 px como mínimo. El carrusel usa scroll nativo, botones, flechas y Home/End; oculta controles innecesarios cuando caben todas las fichas.
5. **Fotografías:** se reutilizan todas las imágenes y miniaturas originales. La demo añade ampliación y navegación horizontal táctil mediante eventos de puntero; conserva anterior/siguiente, contador, teclado y Escape.
6. **Interacción:** el scroll sigue mensajes nuevos mientras se está al final. Si el lector sube, mantiene su posición y ofrece «Mensajes nuevos». Indicador de espera, bloqueo durante envío/reinicio, foco sin desplazar el panel y movimiento reducido.
7. **Validación:** pruebas y revisión de navegador descritas debajo. Las capturas antes/después se guardaron como evidencia local fuera del repositorio; los ejemplos inmobiliarios de esas capturas están rotulados SOLO PRUEBAS.

## Verificación ejecutada
- `npm.cmd test`: **127 aprobadas, 0 fallos**, incluidas las 116 anteriores (111 regresiones del agente y 5 pruebas de la demo).
- 11 pruebas nuevas: estado del scroll, límites del carrusel, discriminación de gestos, recursos locales, galerías mixtas completas y mensajes breves/extensos.
- Navegador: 1366 × 768, 1440 × 960, 390 × 844, 320 × 740 y viewport reducido de 320 × 480. Sin desbordamiento horizontal de la página; encabezado, título lateral de escritorio y compositor visibles.
- Con servidor aislado: envío/espera/bloqueo, respuesta de 3006 caracteres íntegra, errores con recuperación del texto, nueva conversación, fichas múltiples, descripción completa, ausencia de fotos, navegación con ratón/teclado, apertura de foto con Enter, ampliación y Escape.
- Galerías: 11, 16 y 17 miniaturas; última foto accesible; avance circular y contador coherente. Las 44 URLs del escenario mixto se verifican por HTTP local.
- Scroll: subida al inicio durante una respuesta demorada; tras recibirla el scroll siguió en 0 y apareció el botón de novedades. Ese botón recuperó el final.
- La vista original se abrió y envió un mensaje contra el servidor aislado, conservando el historial de la misma pestaña.
- La suite inyecta proveedores simulados. El servidor visual aislado rechaza cualquier solicitud upstream. No se ejecutaron llamadas reales a OpenAI ni Tokko.

## Límites de esta comprobación
Los tamaños se verificaron mediante viewport del navegador, no con teléfonos físicos. La interpretación de los gestos está cubierta por pruebas unitarias; el deslizamiento táctil y el teclado virtual de iOS/Android quedan para una comprobación en dispositivo. La integración y naturalidad reales requieren una conversación real; esta fase no consumió saldo de las APIs. La preferencia de movimiento reducido está implementada en CSS y navegación; no se emuló esa preferencia en un dispositivo.

## Archivos y dependencias
- `public/demo.html`, `public/demo.css`, `public/demo.js`: estructura y presentación de la demo.
- `public/demo-state.js`: estado puro de scroll, carrusel y gesto; sin datos comerciales ni solicitudes.
- `public/app.js`: eventos de presentación para la demo, foco sin scroll y bloqueo durante reinicio. La vista original conserva su scroll habitual.
- `server.mjs`: solo se añaden rutas estáticas explícitas para el módulo visual y los SVG locales.
- `public/demo-icons/`: iconos Lucide distribuidos localmente con su licencia; sin paquetes nuevos.
- `scripts/demo-test-server.mjs`, `test/demo.test.mjs`, `test/demo-state.test.mjs`: fixtures y comprobaciones aisladas.
- `docs/DEMO-CARLOS.md` y este documento: guía y evidencia de alcance.

No se añadieron dependencias, no se modificaron credenciales y no se hizo push ni despliegue.

## Apertura de la demo normal
El servidor se reinició en `http://127.0.0.1:8787/demo` y los recursos nuevos respondieron HTTP 200. Se abrió la demo con el historial previo ya guardado en el navegador y sus dos fotografías principales cargaron correctamente; esto no constituye una consulta nueva ni verifica disponibilidad actual del catálogo. También se comprobó la distribución a 1011 × 668, tamaño normal del panel de esta computadora, sin desbordamiento horizontal.

El reinicio elimina las sesiones temporales del backend. El historial visual del navegador se conserva; para conversar después del reinicio, pulsa «Nueva conversación» y comienza una sesión nueva.
