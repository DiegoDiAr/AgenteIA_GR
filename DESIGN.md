---
name: Grupo Rentabilizarme
description: Interfaz de conversación para explorar el catálogo inmobiliario.
colors:
  green: "#123e32"
  muted: "#5b6c63"
  line: "#dce5de"
  accent: "#c8dfbf"
  paper: "#fff"
  text: "#172e27"
  background: "#f8faf7"
  sidebar: "#eff3eb"
  user-message: "#eff4ec"
  focus: "#74955e"
  send-hover: "#225e49"
  field-border: "#b9cabc"
  field-focus: "#426b4e"
  error-text: "#8b302c"
  error-background: "#fff2ee"
typography:
  display:
    fontFamily: 'Georgia, "Times New Roman", serif'
    fontSize: "clamp(30px, 3.3vw, 50px)"
    fontWeight: 400
    lineHeight: 1.13
    letterSpacing: "-.035em"
  title:
    fontFamily: '"Segoe UI", system-ui, sans-serif'
    fontSize: "15px"
    fontWeight: 600
    letterSpacing: "-.02em"
  body:
    fontFamily: '"Segoe UI", system-ui, sans-serif'
    fontSize: "14px"
    lineHeight: 1.8
  label:
    fontFamily: '"Segoe UI", system-ui, sans-serif'
    fontSize: "9px"
    fontWeight: 700
    letterSpacing: ".14em"
rounded:
  thumbnail: "5px"
  control: "6px"
  media: "8px"
  composer: "12px"
spacing:
  gap-small: "8px"
  gap-control: "10px"
  gap-heading: "12px"
  gap-content: "16px"
components:
  button-send:
    backgroundColor: "{colors.green}"
    textColor: "{colors.paper}"
    rounded: "{rounded.media}"
    height: "37px"
    width: "37px"
  button-send-hover:
    backgroundColor: "{colors.send-hover}"
  button-new-chat:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "10px 14px"
  composer:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.composer}"
    padding: "10px 10px 10px 17px"
  property-media:
    rounded: "{rounded.media}"
    height: "170px"
---

# Design System: Grupo Rentabilizarme

## Overview

Este documento describe la interfaz implementada en `public/styles.css` y `public/index.html`. El usuario eligió blanco y verde oscuro y priorizó las funcionalidades. La implementación fue directa; no hubo una composición visual aprobada previamente ni se estableció una metáfora de marca.

La conversación ocupa el área principal. Un panel de introducción acompaña el chat en pantallas amplias; las propiedades aparecen como tarjetas dentro de la conversación. El blanco, los fondos verdes claros y los separadores finos organizan la información.

**Key Characteristics:**

- Chat como área principal de interacción.
- Blanco y verde oscuro como colores de identidad confirmados.
- Tipografía de sistema para controles y contenido; serif para el título del panel lateral.
- Fotografías de propiedades con galería modal.

## Colors

Los valores normativos están en el frontmatter; los nombres describen sus usos actuales.

### Primary

- **Green:** botón de envío, indicador del asistente, marca y enlaces de propiedades.
- **Send hover:** estado hover del botón de envío.
- **Accent:** selección de texto, acompañada de texto verde oscuro.

### Neutral

- **Paper:** cabecera, chat y compositor.
- **Background:** fondo general y superficie de la galería.
- **Sidebar:** fondo del panel de introducción.
- **Text:** texto principal.
- **Muted:** información secundaria, ubicaciones y estados.
- **Line:** separadores de cabecera, paneles, sugerencias y tarjetas.
- **User message:** fondo de los mensajes del usuario.
- **Field border / Field focus:** borde del compositor en reposo y con foco interno.
- **Focus:** contorno visible de navegación por teclado.

Los errores usan **Error text** sobre **Error background**. El aviso de configuración usa un fondo crema y texto marrón, tal como está implementado; no constituye un segundo color de marca.

## Typography

**Display Font:** Georgia con Times New Roman y serif de respaldo.

**Body Font:** Segoe UI con system-ui y sans-serif de respaldo. No se descargan fuentes externas.

El título del panel lateral usa la variante display del frontmatter y ajusta su tamaño a 32px cuando el ancho es de 900px o menos. El encabezado del chat usa title. Los títulos de propiedades comparten tamaño y peso, con interlineado de 1.45.

Los mensajes usan body y conservan saltos de línea; su ancho de lectura máximo es de 72ch. El saludo inicial usa texto de 18px con interlineado de 1.65; en móvil aumenta a 19px. El texto auxiliar del saludo usa 14px y un máximo de 46ch. Los rótulos del asistente usan label en mayúsculas. Los precios usan 17px, peso 600 y cifras tabulares.

## Layout

La cabecera mide 94px de alto. El área de trabajo se centra y tiene un máximo de 1600px. Su cuadrícula combina un panel lateral `minmax(280px, 33%)` con un chat `minmax(0, 1fr)`. El chat mide `calc(100dvh - 94px)`, con mínimo de 510px. El historial tiene desplazamiento vertical propio; encabezado y compositor conservan su espacio dentro del panel.

Los márgenes interiores del chat usan un 6% en escritorio. Los resultados se disponen en dos columnas con separación de 22px por 16px. Una única propiedad ocupa ambas columnas, con ancho máximo de 600px. Las imágenes se recortan con `object-fit: cover`; la galería las muestra completas con `object-fit: contain`.

- **Hasta 900px:** el panel lateral pasa a `minmax(230px, 30%)`; los resultados usan una columna y fotografías de 220px de alto.
- **Hasta 640px:** se oculta el panel lateral y el estado de conexión de la cabecera. El chat ocupa todo el ancho; la cabecera mide 76px. El chat mide `calc(100dvh - 76px)`, con mínimo de 420px. El historial usa márgenes interiores laterales de 22px y el contenedor del compositor, 18px. Todas las imágenes de tarjetas miden 220px de alto.
- **Desde 1500px:** el área de trabajo incorpora bordes laterales finos.

La galería usa un ancho de 94vw, máximo de 1100px y alto máximo de 94dvh. En móvil ocupa hasta 100vw por 100dvh y elimina las esquinas redondeadas. La fotografía mide 55dvh de alto en escritorio y 52dvh en móvil. Las miniaturas se desplazan horizontalmente.

## Elevation & Depth

La interfaz principal se organiza con fondos y bordes, sin sombras en tarjetas. El compositor muestra una sombra leve al recibir foco (`0 2px 10px #123e320a`). La galería usa una sombra modal (`0 20px 80px #071c1b55`) y un fondo de superposición oscuro (`#0a1f1ae6`) para separarse de la conversación.

## Shapes

Los controles usan esquinas suavemente redondeadas: botón de nueva conversación y flechas de galería (6px), envío y fotografías de tarjetas (8px), compositor y galería de escritorio (12px). Las miniaturas y el contador de fotos usan 5px. La burbuja del usuario usa `14px 14px 3px 14px`. Los indicadores de estado son círculos pequeños. Las tarjetas se separan mediante un borde inferior y espacio, sin contenedor exterior elevado.

## Components

### Buttons

El envío es un botón cuadrado verde con icono de flecha blanco. Nueva conversación usa superficie blanca, borde fino y texto pequeño. Las sugerencias son filas de texto con separador inferior y flecha; cambian a fondo verde muy claro al pasar el cursor.

Los botones y la marca usan transiciones de fondo y color de 0.18s con `ease`. Los botones deshabilitados reducen la opacidad a 0.5 y muestran cursor de espera.

### Inputs / Fields

El compositor agrupa un textarea y el botón de envío dentro del borde redondeado. El foco interno cambia borde y sombra. El textarea usa interlineado de 1.6, altura mínima de 35px y máxima de 135px. Tiene etiqueta accesible y un máximo de 4000 caracteres. Los errores aparecen sobre el compositor con `role="alert"`; el aviso de configuración usa `role="status"`.

### Cards / Containers

Las tarjetas de propiedades contienen fotografía, contador de fotos, metadatos, título, ubicación, precio, características, detalles desplegables y enlace público cuando esos datos están disponibles. El texto largo puede romper líneas para evitar desbordamientos. El contador de fotos conserva un fondo blanco translúcido sobre la imagen.

### Navigation

La cabecera contiene un enlace de inicio con nombre accesible, estado de conexión y acción Nueva conversación. La marca combina texto con un símbolo de casa SVG; no se recibió un logotipo oficial.

### Photo gallery

La galería es un elemento nativo `dialog`, identificado por su título. Incluye cerrar, anterior y siguiente con nombres accesibles, contador, pie y miniaturas de todas las fotografías disponibles. La miniatura actual se distingue mediante un borde y `aria-current`. Existe un mensaje visible si una fotografía no puede cargarse.

### Accessibility and motion

Los elementos enfocables muestran un contorno de 3px y separación de 4px. El textarea comunica el foco mediante el contenedor; las miniaturas colocan su contorno hacia dentro. El historial usa `role="log"`, anuncios `polite` y relevancia para adiciones. Los iconos decorativos se ocultan de la lectura asistida.

El indicador de espera anima su opacidad durante 1.2s. La preferencia `prefers-reduced-motion: reduce` elimina animaciones y transiciones y desactiva el desplazamiento suave.

## Do's and Don'ts

### Do:

- **Do** conservar blanco y verde oscuro como colores de identidad confirmados.
- **Do** mantener nombres accesibles, foco visible y anuncios de estado al reutilizar los componentes.
- **Do** conservar la presentación del chat a ancho completo y el panel lateral oculto en móvil.
- **Do** mostrar fotografías completas en la galería y respetar la preferencia de movimiento reducido.

### Don't:

- **Don't** presentar el símbolo SVG actual como un logotipo oficial suministrado por la marca.
- **Don't** sustituir fotografías ausentes por imágenes inventadas de propiedades.
- **Don't** describir esta implementación directa como una composición previamente aprobada.
