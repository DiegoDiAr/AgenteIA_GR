# Diagnóstico controlado de Tokko — 30/10/2026

Se ejecutaron exactamente **8 GET autorizadas a Tokko**, todas HTTP 200, y **0 solicitudes a OpenAI**. No se modificaron datos del CRM. El archivo [TOKKO-CONTROLADO-2026-10-30.json](TOKKO-CONTROLADO-2026-10-30.json) conserva únicamente parámetros no sensibles, IDs, estados, precios publicados y conteos. No contiene claves, cabeceras, URLs autenticadas, respuestas completas ni datos personales.

También se hizo un GET sin credenciales al enlace público oficial: respondió 200 y las imágenes publicadas identificaron el ID Tokko 7233794. Esa correspondencia fue comprobada para este enlace; no se generaliza a otras publicaciones.

## San Miguel: causa comprobada
La consulta q=san miguel, scope=full, limit=100 devolvió 100 filas y meta.total_count=100, next=null. No incluía el registro del distrito. Sí contenía el hijo SAN MIGUEL (250516), cuya jerarquía era:

Peru | Lima | Lima | San Miguel (Lima) | SAN MIGUEL

Consultar el nombre de ese padre observado, q=San Miguel (Lima), scope=minimal, devolvió un único registro:
- ID 250468.
- Nombre San Miguel (Lima).
- Tipo **Barrio**.
- Jerarquía Peru | Lima | Lima | San Miguel (Lima).

La corrección anterior asumía que Barrio equivalía a un sector de otro distrito. Esa premisa era incorrecta en el catálogo real de Perú. Además, el quicksearch amplio puede devolver una muestra limitada sin señalar más páginas; no prueba que falte la ubicación.

La consulta real con ese ID verificado, division, departamento [2], venta [1], PEN, máximo 500000 y only_available=checked devolvió **3 propiedades**: 9485687, 7267790 y 9487738, con precios publicados de S/ 414000, S/ 465675 y S/ 479300. Las respuestas incluyeron 15, 11 y 16 fotografías, respectivamente. No se agregan esas propiedades manualmente al código.

## Miraflores y GAP7233794: causa comprobada
El quicksearch real devolvió simultáneamente:
- 248359: Miraflores, **Barrio**, Peru | Lima | Lima | Miraflores.
- 240072: MIRAFLORES, **Localidad**, Peru | Lima | Yauyos | MIRAFLORES.
- Hijos y otros homónimos.

Al ejecutar el selector anterior sobre esa respuesta real eligió 240072, porque excluía Barrio antes de evaluar la jerarquía metropolitana. No era una exclusión por dúplex, moneda, presupuesto o visibilidad.

El detalle actual de 7233794 respondió:
- Referencia GAP7233794.
- Tipo 2, Departamento; no requiere otro tipo especial para dúplex.
- Operación 1, Venta.
- Ubicación 248359, Miraflores metropolitano.
- Precios publicados USD 279854 y PEN 989801.
- Superficie 170 m², 12 fotos, status=2 y web_price=true.

No se atribuye por su cuenta un significado al código status=2: la inclusión en property/search con only_available=checked demuestra que estaba visible para esta clave y este filtro al verificarlo.

## Comparación cambiando una condición
Todas las búsquedas usaron division, property_types=[2], operation_types=[1], currency=PEN, price_from=0, filters=[], only_available=checked, limit=100 y offset=0.

| GET | Ubicación | Máximo PEN | Resultado |
| --- | --- | ---: | --- |
| 4 | Miraflores 248359 | 1000000 | 1: GAP7233794 |
| 6 | Yauyos 240072 | 1000000 | 0 |
| 8 | Miraflores 248359 | 500000 | 0 |
| 7 | San Miguel 250468 | 500000 | 3 |

GET 4 y 6 difieren únicamente en el ID geográfico. GET 4 y 8 difieren únicamente en price_to. Los resultados reales de esas búsquedas indicaron total igual al número recibido y next=null: el dúplex no estaba oculto en otra página de ellas.

Se detuvo la relajación de filtros al identificar la causa: no hacía falta abrir otros tipos, operaciones, moneda o disponibilidad. No se afirma haber probado todas las combinaciones imaginables con ocho consultas.

Tokko documenta que puede convertir monedas para aplicar filtros, sin devolver necesariamente el precio convertido:
https://developers.tokkobroker.com/discuss/5f4a623b4cde81002513579f

Se conservan currency=PEN y el presupuesto solicitado; no se añade un tipo de cambio local ni se comparan soles contra el primer precio en USD. En esta propiedad existen ambos precios publicados. El máximo de S/ 500000 excluye correctamente S/ 989801.

## Corrección del backend
- La jerarquía y el contexto geográfico preceden a etiquetas como Barrio o Localidad. El tipo solo desempata dentro del mismo nivel/contexto; no elimina distritos metropolitanos válidos.
- Si full_location revela un padre pertinente ausente de quicksearch, se consulta su nombre publicado con scope=minimal. Solo se aceptan registros cuya jerarquía coincida con el padre observado. No se inventan IDs, nombres ni listas de distritos.
- Se conserva la lectura de páginas anunciadas por el proveedor. Una respuesta amplia de 100 filas sin next no se considera exhaustiva si falta un padre relevante.
- Si el proveedor no permite verificar ese ámbito, se devuelve location_unavailable. Se distingue de no_matches, de un fallo técnico y de una ambigüedad real; repetir la misma confirmación no lo soluciona.
- Se conservan IDs resueltos entre refinamientos, reemplazo de resultados vigentes, memoria histórica, deduplicación y todas las fotos.
- No se cambia la construcción de filtros monetarios, tipos, operación o disponibilidad: las GET reales demostraron que eran correctos con el ID adecuado.
- No fue necesario buscar inventario más amplio ni filtrar una muestra parcial como si fuera exhaustiva: el distrito sí existe como ubicación seleccionable.

Archivos de código: lib/locations.mjs, lib/tokko.mjs y lib/chat.mjs. Pruebas nuevas: test/tokko-real-regressions.test.mjs y test/fixtures/tokko-geography-observed.json. La fixture contiene solo metadata pública mínima; las respuestas del modelo, el transporte y las fotos automatizadas son sintéticos y no se usan en producción.

## Validación y límites
npm.cmd test: **240 pruebas aprobadas, 0 fallos**. Se conservan las 228 anteriores y se añaden 12 regresiones basadas en las causas observadas: etiquetas reales, padres ausentes, tope de quicksearch, presupuestos, tipo Departamento/dúplex, precios originales, enlace, cambios de distrito, memoria, fotos, duplicados y errores. Se mantienen las regresiones anteriores de visitas, asesores, sesiones y galerías.

La evidencia real confirma ubicaciones y resultados de Tokko con los filtros indicados. Las regresiones verifican el flujo del código con transporte simulado basado en esa evidencia. No se realizó una conversación real de OpenAI ni otra ejecución completa con hidratación de fichas después del parche, porque habría excedido las 8 GET. La evaluación conversacional posterior queda a cargo del usuario.

Modelo GPT-6 Luna, razonamiento, personalidad, visitas, asesores e interfaz permanecen intactos. Sin claves modificadas, push ni despliegue.
