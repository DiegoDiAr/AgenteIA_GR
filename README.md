# Asistente inmobiliario · Grupo Rentabilizarme

Primera versión local: un servidor Node.js y una interfaz HTML/CSS/JavaScript, sin dependencias de terceros ni proceso de compilación. OpenAI decide si necesita consultar Tokko mediante function calling. El navegador nunca recibe las claves.

## Iniciar

Requiere Node.js 22.16 o superior. Desde este directorio:

```powershell
npm start
```

Abre [el chat local](http://127.0.0.1:8787). No necesitas ejecutar `npm install`. `npm run dev` reinicia el servidor cuando cambian los archivos.

El archivo `.env` ya está preparado con valores vacíos. Ábrelo localmente y completa:

```dotenv
OPENAI_API_KEY=
TOKKO_API_KEY=
OPENAI_MODEL=gpt-4.1-mini
PORT=8787
HOST=127.0.0.1
```

Pon cada clave después de `=`. No las pegues en el chat, el código frontend ni capturas de pantalla. `.env` está excluido de Git; `.env.example` sirve de plantilla si falta. Las variables del proceso tienen prioridad sobre `.env`. **Reinicia el servidor después de cambiar las claves.**

Usa la clave API de la cuenta de **Grupo Rentabilizarme**, con las propiedades habilitadas para visualizarse en la web. No se utiliza la clave demo publicada en la documentación de Tokko. Si la cuenta permite consultar propiedades de otras inmobiliarias de una red, restringe esos permisos en Tokko para que su catálogo API corresponda al inventario que quieres mostrar.

`OPENAI_MODEL` permite elegir otro modelo que admita Responses API y function calling, accesible desde tu cuenta. La API de OpenAI necesita una clave y cuota de API disponibles. La cobertura comercial actual es Lima, Perú: si falta distrito se consulta Lima completa, con ubicaciones e IDs resueltos desde Tokko. No hay una lista cerrada de distritos. Si el puerto no está disponible cambia `PORT`.

## Demostración de mensajería

La vista independiente [/demo](http://127.0.0.1:8787/demo) usa el mismo cliente, endpoint, sesiones y agente que la interfaz original. Presenta fichas compactas que se recorren horizontalmente y conserva la galería completa. Es una simulación de la experiencia WhatsApp, sin conexión con WhatsApp Business ni Meta Cloud API. El servidor normal sigue usando las APIs reales cuando se envían mensajes.

La guía [docs/DEMO-CARLOS.md](docs/DEMO-CARLOS.md) incluye escenarios de evaluación y criterios comparables. Para revisar la interfaz sin llamadas externas, ejecuta `node scripts/demo-test-server.mjs` y abre `http://127.0.0.1:8789/demo`: el aviso permanente, las fichas y las imágenes identifican que todo son datos sintéticos.

## Funcionalidad

- Conversación natural con OpenAI y contexto mantenido en el servidor.
- Herramienta de búsqueda Tokko con ubicación resuelta por su API, tipo, venta/alquiler/alquiler temporal, moneda, rango de precio, mínimos y máximos de dormitorios, ambientes, baños, cocheras y superficie.
- Presupuesto sin moneda y ubicación ambigua requieren precisión, sin sustituir silenciosamente el criterio.
- Cinco fichas por página, con paginación conversacional. **El límite de fichas no limita fotografías:** cada ficha se consulta por ID y se conserva todo el arreglo `photos`.
- Precio publicado, ubicación pública, descripción completa, características disponibles y enlace público cuando Tokko lo entrega. Se respeta `web_price=false` y se excluyen comentarios internos y dirección privada `real_address`.
- Galería con todas las miniaturas, contador, navegación anterior/siguiente y flechas del teclado. `Escape` cierra la galería; las imágenes se cargan de forma diferida cuando corresponde.
- «¿Cuánto cuesta la segunda?» usa los datos del contexto; «muéstrame todas sus fotos» muestra la ficha conocida sin otra búsqueda. Abrir una ficha no cambia el orden del último listado.
- Enlaces oficiales de `/Propiedades/Detalle?id=...` e IDs explícitos de Tokko pueden consultarse sin una búsqueda anterior. Se devuelve la misma ficha y galería del chat, y se conserva la referencia para preguntas posteriores.
- Al modificar criterios se heredan los anteriores: un presupuesto nuevo sustituye el límite previo y conserva ubicación, operación, tipo y moneda. La herramienta usa `reset_fields` para quitar preferencias explícitamente; no obliga al cliente a completar un formulario.
- Saludos y agradecimientos reciben una respuesta normal: `tool_choice: auto` deja a la IA decidir; no se disparan búsquedas mediante palabras clave del navegador.

Las características libres, como piscina o terraza, se contrastan **exclusivamente con etiquetas explícitas de Tokko** (con equivalencias como piscina/pileta). No basta una mención en la descripción: podría decir «sin piscina» o referirse a una piscina cercana. Se revisan hasta 100 candidatos por página y se informa cuando quedan más. La ausencia de una etiqueta no demuestra que el atributo no exista físicamente; el asistente explica esta limitación. Los filtros numéricos se envían a Tokko. La superficie usa la unidad publicada por Tokko; el asistente pide precisión cuando corresponde, sin convertir unidades ni monedas automáticamente.

La resolución geográfica usa la jerarquía de Tokko y prefiere Lima metropolitana cuando un nombre tiene homónimos en otras provincias de la región. Una provincia indicada expresamente participa en la resolución; las ambigüedades que permanecen se devuelven como `needsLocation`, sin consultar un inventario con ubicación equivocada.

Los enlaces se recuperan exclusivamente desde el dominio oficial (HTTPS, sin seguir redirecciones). El ID de la web no se considera automáticamente un ID de Tokko: se extrae el candidato de las imágenes Tokko publicadas en la página y se verifica una coincidencia con las fotos de la ficha devuelta por la cuenta API. Si falta esa evidencia, la herramienta explica que no puede resolver la publicación. Los datos y la galería se obtienen de Tokko, no se fabrican a partir del texto de la página.

## Pruebas

```powershell
npm test
npm run check:live
```

`npm test` ejecuta pruebas aisladas con servicios simulados: filtros y moneda, ubicaciones ambiguas, paginación, fotos completas, referencias, refinamientos, errores, sesiones independientes y rutas privadas. Los datos sintéticos viven exclusivamente en las pruebas y **nunca se sirven en el chat real**. Estas pruebas no demuestran que una cuenta real tenga acceso o inventario.

`test/conversation.test.mjs` cubre los casos A–G, cambios de presupuesto con conservación de criterios, aclaraciones geográficas, enlaces con IDs distintos, fallos técnicos y entrega de fichas y fotos por HTTP. Las respuestas de OpenAI están programadas: se comprueban las herramientas y el contexto, no las decisiones de un modelo real. Evaluar la naturalidad y la elección de herramientas requiere una conversación real con autorización para consumir API.

`npm run check:live` hace consultas **reales** a OpenAI y Tokko y consume la cuota correspondiente. Primero comprueba un saludo sin búsqueda, luego solicita propiedades y comprueba la referencia a una ficha y sus fotos. No imprime claves, cuerpos upstream ni URLs privadas. Si faltan credenciales se detiene e indica la configuración necesaria. Opcionalmente establece `LIVE_SEARCH_MESSAGE` con una búsqueda concreta de tu catálogo.

Para reproducir una comprobación visual aislada: `node scripts/ui-test-server.mjs`, abre `http://127.0.0.1:8788`, envía cualquier mensaje y recorre las 17 imágenes **identificadas como imágenes de prueba**. Este servidor separado nunca llama a OpenAI ni Tokko. Deténlo con Ctrl+C al terminar.

Comprobación manual con credenciales:

1. Envía «Hola», luego solicita inmuebles con ubicación, operación y presupuesto con moneda.
2. Comprueba precio, descripción, características y enlace contra las fichas de Tokko.
3. Abre el botón de fotos de una ficha y recorre hasta la última; compara el número con Tokko.
4. Pregunta «¿Cuánto cuesta la segunda?», «Muéstrame todas sus fotos» y «¿Tienes una más barata?».
5. Envía «Gracias»; no debería iniciar una nueva búsqueda.
6. Inicia una nueva conversación y verifica que no conozca la «segunda» anterior.

## Arquitectura y límites de esta versión

```text
public/              Interfaz de chat y galería
server.mjs           HTTP, sesiones, validación y archivos públicos
lib/chat.mjs         Responses API, herramientas y contexto
lib/tokko.mjs        API Tokko, filtros y normalización pública
lib/errors.mjs       Errores seguros y peticiones con tiempo límite
test/app.test.mjs    Pruebas de integración aisladas
scripts/check-live.mjs  Verificación real con las claves configuradas
```

Memoria temporal, sin base de datos: sesiones por navegador de dos horas de inactividad, máximo 60 turnos, últimos 20 intercambios y hasta 40 fichas conocidas. El historial visible puede sobrevivir a una recarga en la pestaña; al reiniciar el backend se solicita iniciar una conversación nueva. Pestañas del mismo navegador comparten cookie de sesión: usa una sola pestaña por conversación. No hay autenticación, CRM, reservas ni automatizaciones.

El servidor escucha únicamente en `127.0.0.1` por defecto. Esta entrega es local; no publica un sitio en Internet. Hay límites básicos por sesión, validación de origen y contenido, cookies HttpOnly y una lista fija de archivos públicos. Antes de abrir un servicio público conviene añadir controles globales de abuso y configurar HTTPS en el entorno de alojamiento; no se ha agregado infraestructura en esta versión.

## Documentación oficial consultada

- [Tokko: API y autenticación por inmobiliaria](https://developers.tokkobroker.com/docs/atributos)
- [Tokko: propiedades con visualización web](https://developers.tokkobroker.com/docs/properties)
- [Tokko: búsqueda, tipos, operaciones y precios](https://developers.tokkobroker.com/docs/search)
- [Tokko: resolver ubicaciones](https://developers.tokkobroker.com/docs/ubicaciones)
- [Tokko: detalles de la ficha y visibilidad del precio](https://developers.tokkobroker.com/docs/result)
- [Tokko: dormitorios, baños y otros campos](https://developers.tokkobroker.com/docs/informaci%C3%B3n-b%C3%A1sica)
- [OpenAI: function calling con Responses API](https://developers.openai.com/api/docs/guides/function-calling)
- [OpenAI: modelo configurable GPT-4.1 mini](https://developers.openai.com/api/docs/models/gpt-4.1-mini)
