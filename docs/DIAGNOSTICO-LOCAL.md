# Diagnóstico local de iniciativa y herramientas

## Alcance y configuración
El diagnóstico está apagado por defecto: `AGENT_DIAGNOSTICS=0` en `.env.example`, y `createChat` no registra eventos nuevos salvo activación explícita. El servidor solo lo habilita con `AGENT_DIAGNOSTICS=1` y un HOST local: `127.0.0.1`, `localhost` o `::1`. No crea archivos, telemetría ni endpoints HTTP de diagnóstico.

Para activar manualmente, detén con Ctrl+C el servidor de este proyecto y, desde la carpeta del clon, ejecuta en PowerShell:

```powershell
$env:AGENT_DIAGNOSTICS = '1'
npm.cmd start
```

Para desactivar, detén ese proceso y ejecuta:

```powershell
Remove-Item Env:AGENT_DIAGNOSTICS -ErrorAction SilentlyContinue
npm.cmd start
```

Esto no cambia las claves ni exige editar `.env`. También se puede configurar el indicador en el entorno privado. Si se configuró ahí en 1, hay que volverlo a 0 para apagarlo.

En la ejecución preparada para esta entrega, el indicador se activa solo en el proceso local para facilitar la evaluación posterior. La configuración por defecto sigue apagada. Los registros se leen en la consola de ese servidor; no aparecen en el navegador.

## Qué permite distinguir
| Evento | Qué indica |
| --- | --- |
| `agent_model_result`, `status=no_tool_calls` | OpenAI respondió sin solicitar herramientas. Si la solicitud era inmobiliaria y ya podía buscar, este registro sitúa el problema en la decisión del modelo, no en una búsqueda fallida de Tokko. No revela el razonamiento interno. |
| `agent_model_result`, `status=tool_calls` | Herramientas solicitadas, por nombre conocido; los nombres desconocidos se registran como `unknown`. |
| `agent_model_result`, `status=error` o `invalid_response` | Falló la petición o el formato de respuesta del modelo. Se conserva el diagnóstico técnico seguro de errores OpenAI que ya existía. |
| `agent_tokko`, `phase=start` | Se invocó el método del adaptador: `search`, `fromUrl` o `detail`. |
| `agent_tokko`, `phase=end` | Estado: `matches`, `no_matches`, `needs_location`, `outside_coverage`, `property` o `error`; conteo cuando corresponde y duración en milisegundos. |
| `agent_tool_result` | La herramienta terminó o devolvió un error. `show_property` puede completarse sin evento Tokko porque usa fichas ya verificadas en memoria. |

Cada turno recibe un `traceId` aleatorio nuevo para agrupar sus eventos y un número de paso. No es la cookie ni el identificador de la sesión del cliente.

Las duraciones del modelo incluyen la petición y recepción JSON. Las de Tokko corresponden al método completo del adaptador; una búsqueda puede incluir resolución geográfica, búsqueda y fichas. No son un desglose de cada solicitud HTTP. Que el método se invoque no garantiza que haya completado una petición de red: una validación puede fallar antes; el estado final lo diferencia de una búsqueda sin coincidencias.

## Privacidad y conservación
Solo se registran eventos, identificadores efímeros, nombres de herramientas conocidos, estados, conteos y tiempos. No se registran mensajes, respuestas del asistente, argumentos, filtros, presupuestos, nombres, teléfonos, direcciones, IDs de inmuebles, enlaces, claves, cabeceras ni cuerpos de errores. Un fallo al escribir el diagnóstico no altera la conversación.

No se agrega ninguna llamada a OpenAI ni a Tokko para diagnosticar. No hay clasificación de mensajes por palabras clave, reintentos que fuercen búsquedas ni cambios en `tool_choice: auto`.

## Comparación y corrección de iniciativa
La comparación con el respaldo `e19a808` encontró que la ejecución previa a este cambio coincidía, salvo el contexto de presentación `responseCards`; Tokko, los esquemas y el frontend permanecían iguales. No se encontró un filtro nuevo que justificara bloquear solicitudes parciales.

Las instrucciones de búsqueda estaban detrás de los ejemplos de estilo. Además, el ejemplo de criterios suficientes incluía presupuesto y podía interpretarse como una solicitud de completar preferencias. Se reemplazó ese párrafo y se adelantó la iniciativa comercial: buscar con lo conocido, incluso sin presupuesto, recuperar criterios del historial aunque nunca se haya buscado y reutilizar resultados pertinentes cuando ya existen.

Se aclaró que un anuncio sin identificar no debe bloquear una búsqueda coincidente ni tratarse como una publicación ya conocida; que una aceptación de ver opciones retoma el contexto, no pide un informe completo; y que las fichas se acompañan de orientación útil, sin propuestas de visita o preguntas de cierre rutinarias. Se conservan las aclaraciones imprescindibles existentes, como moneda ante un importe sin moneda, sin convertir campos opcionales en requisitos.

Esto es una hipótesis de corrección respaldada por el diff y las regresiones. **Las decisiones espontáneas de OpenAI siguen pendientes de evaluación real.**

## Reproducción manual preparada
Tras el reinicio, abre [la demo](http://127.0.0.1:8787/demo) y pulsa «Nueva conversación». Estas acciones manuales sí usan los proveedores reales; no fueron ejecutadas durante el desarrollo.

1. «Me gustaría alquilar un departamento en Miraflores, por ahí vi que estaban anunciando uno». Observar si busca sin exigir presupuesto o dormitorios. No debe afirmar que identificó el anuncio.
2. Continuar con «Mmmmm, no sé, ¿qué me recomiendas tú?». Si ya hay opciones pertinentes, debe usarlas; si todavía no las consultó, debe buscar usando la conversación anterior.
3. «Sí, a ver, muéstrame». Debe presentar la ficha correspondiente con una explicación complementaria, sin recitarla ni ofrecer fotos o visitas por rutina.
4. Saludar o agradecer. Debe poder responder sin una búsqueda innecesaria.
5. Cambiar el presupuesto o pedir una comparación/detalle. Contrastar los datos y las fotografías con las fichas reales.

Anota el intercambio que tú observas y consulta los eventos de ese turno. Las trazas muestran la secuencia de ejecución, no la intención que el modelo debería haber inferido. No hace falta activar registros de mensajes para analizarlas.

## Resultado automatizado
`npm.cmd test`: **147 aprobadas, 0 fallos**. Se conservan las 136 anteriores y se incorporan tres regresiones de iniciativa y ocho del diagnóstico.

Los proveedores de pruebas están simulados: la llamada de herramienta es una decisión programada del modelo de prueba. Se verifican filtros parciales, contexto, fichas, fotos, privacidad, estados, modo apagado, control de host y ausencia de llamadas adicionales. Se corrigió el proveedor sintético para aceptar moneda `ANY`, igual que el comportamiento existente de Tokko, al probar búsquedas sin presupuesto. No se modificó la integración real.
