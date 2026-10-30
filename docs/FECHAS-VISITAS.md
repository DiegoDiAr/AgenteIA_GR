# Fechas y horarios de visitas simuladas

La preferencia se normaliza localmente en el backend. No se consulta disponibilidad, no se crea una cita y no se envía nada a asesores. El estado completo sigue siendo **Solicitud preparada — simulación, pendiente de confirmación**.

## Contrato
- preferred_date: fecha civil ISO YYYY-MM-DD, o null si falta o necesita aclaración.
- preferred_time: HH:mm de 24 horas, o null si falta una hora concreta.
- schedule: zona America/Lima, fragmentos originales, instante de recepción, fecha de referencia, etiquetas legibles, franja, problemas y aclaraciones.
- Una preferencia pasada no permite el estado prepared. Si un horario ya guardado pasa, se conserva su valor exacto para corregirlo, con estado draft y explicación; no se desplaza a otro día.

lib/visit-schedule.mjs usa Intl.DateTimeFormat con America/Lima para obtener el día y la hora de referencia. La aritmética civil con Date.UTC opera sobre esa fecha local ya obtenida: no convierte el día UTC del servidor en el día de Lima. El reloj es inyectable para las pruebas; en producción se utiliza la fecha actual del servidor.

## Interpretación
Se reconocen hoy, mañana, pasado mañana, días de semana, fechas ISO, día/mes/año y días con meses en español. Sin año se utiliza el año local actual únicamente si no produce una fecha pasada; de lo contrario se pide confirmar el año. Un día de semana es la siguiente ocurrencia; si coincide con hoy, se pide aclarar, salvo una indicación explícita como este viernes o próximo viernes. Fechas inexistentes, contradictorias o no reconocidas quedan pendientes de aclaración.

Se reconocen horas de 24 horas, AM/PM, mañana/tarde/noche, horas en palabras y minutos con media/cuarto. Una hora como a las 5 necesita franja; al corregir una preferencia ya conocida puede conservar la franja anterior. Una nueva franja sin hora, como por la mañana, retira la hora precisa anterior y pide una aproximada. No se asigna una hora ficticia a una franja.

Ejemplo con reloj de prueba viernes 30/10/2026, 09:00 en Lima:
- Mañana a las 3 de la tarde → 2026-10-31, 15:00.
- Pasado mañana → 2026-11-01.
- El lunes → 2026-11-02.
- El próximo martes a las 10 de la mañana → 2026-11-03, 10:00.

Estos valores son ejemplos de reloj controlado, no fechas de producción.

## Integración con el agente
prepare_demo_request recibe las expresiones originales; el modelo no tiene que calcular el calendario. En demo, el contexto incluye demoClock y los resultados de normalización con schedule.feedback. La expresión temporal reconocida en el mensaje actual prevalece sobre un cálculo distinto enviado por el modelo.

La referencia se toma al entrar el mensaje al ciclo del agente, antes de esperar a OpenAI. Se guardan temporalmente, por sesión, fragmentos de fecha/hora con su instante de recepción (máximo 40 referencias). Si la herramienta guarda una expresión de un turno anterior, se usa esa referencia. No se registran en logs ni se agrega una llamada a OpenAI.

Una fecha normalizada permanece fija al revisar, aportar nombre/contacto o continuar después de medianoche; reenviar por error la expresión guardada tampoco la desplaza. Una nueva expresión en un mensaje de corrección sí se calcula con su nueva referencia. Los datos antiguos sin referencia fiable requieren confirmación.

El resumen existente muestra día de semana, fecha legible, hora, expresión recibida y aclaraciones mediante nodos de texto seguros, manteniendo el diseño. Nombre, contacto, propiedad y estado siguen visibles. No se añade calendario visual.

## Validación y alcance
npm.cmd test conserva los 178 casos anteriores e incorpora regresiones con reloj controlado: ejemplos, cambios de mes/año/bisiesto, zona local frente a UTC, fines de semana, fechas explícitas y ambiguas, franjas, correcciones, fechas pasadas, cruce de medianoche durante y entre turnos, herramienta diferida y aislamiento HTTP entre sesiones. También se verifica el resumen seguro y la conservación de fotos y del modelo/razonamiento.

Los proveedores son simulados; estas pruebas no demuestran que OpenAI real elija siempre la herramienta o recopile la expresión correctamente. La conversación manual posterior sigue pendiente. El servidor aislado scripts/demo-test-server.mjs usa un reloj y datos ficticios identificados solo para comprobar la interfaz, sin proveedores externos.

No cambian personalidad, modelo, filtros, Tokko, fotografías ni galerías. No hay integraciones nuevas ni credenciales modificadas. Las expresiones que no se puedan resolver de forma fiable deben aclararse; el prototipo no pretende aceptar cualquier formulación del calendario.

Resultado de esta entrega: **203 pruebas aprobadas, 0 fallos** (178 anteriores conservadas y 25 regresiones nuevas). La revisión visual aislada mostró sábado 31/10/2026 a las 4:00 p. m. y su corrección a lunes 02/11/2026 a las 10:00 a. m., manteniendo nombre/contacto y el estado de simulación. / y /demo respondieron HTTP 200 y /api/health indicó ambas credenciales configuradas; esto no verifica validez contra proveedores. No se enviaron conversaciones reales ni consultas Tokko durante esta tarea.
