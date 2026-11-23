# Landing page: content draft (Spanish)

Draft copy for the new `index.html` landing (TODO section 4). Spanish is the source; English will be translated into `locales/en.js`.
Notes for implementation are in *italics* and are not part of the copy. Every string ends up in `locales/es.js` / `locales/en.js`.

---

## 1. Hero

**JustID**
### Comparte tu DNI, solo lo justo

Tapa los datos que no hacen falta, marca para qué es la copia y envíala en PDF. Todo ocurre en tu móvil: tu DNI no sale de tu dispositivo.

[ Proteger mi DNI ] *(→ `/app/`)*  [ Pedir un DNI a alguien ] *(→ request flow, once it exists)*

<small>Gratis · Sin registro · Sin anuncios · Código abierto</small>

*Before/after slider: specimen front (`img/`), left half original, right half redacted with the "SOLO PARA: …" watermark. Draggable handle, keyboard accessible. Label each side: "Antes" / "Después".*

---

## 2. Vídeo

### Mira cómo funciona en 30 segundos

*Video placeholder (16:9 box with play icon and the text below) until the real video exists. Self-hosted only: the CSP blocks YouTube embeds.*

Próximamente: un vídeo corto con el proceso completo, de la foto al PDF.

---

## 3. Por qué importa

### Una fotocopia del DNI vale más de lo que parece

Cada vez que envías una foto completa de tu DNI (para alquilar un piso, apuntarte a un gimnasio o recoger un paquete), entregas mucho más de lo que te piden: tu firma, el número de soporte, el nombre de tus padres, tu dirección… Con esa copia, otra persona puede hacerse pasar por ti.

- **Suplantación de identidad.** Con una copia de tu DNI se pueden contratar servicios, pedir préstamos o abrir cuentas a tu nombre.
- **No sabes dónde acaba.** La copia queda en correos, chats y carpetas compartidas que no controlas.
- **La ley dice "solo lo necesario".** La protección de datos exige que solo se pidan los datos imprescindibles para cada fin.

Organismos como INCIBE y la AEPD recomiendan no enviar copias completas del DNI, tapar los datos que no hacen falta e indicar en la copia para qué es.

**Para saber más:**
- INCIBE (Instituto Nacional de Ciberseguridad): consejos para evitar la suplantación de identidad. *(link to the INCIBE / OSI article)*
- AEPD (Agencia Española de Protección de Datos): qué datos te pueden pedir y cómo protegerte. *(link to the AEPD guide)*
- RTVE: reportaje sobre fraudes con copias del DNI. *(link to the RTVE article)*

*Paraphrase only; do not copy text from these sources. Links open in a new tab with `rel="noopener noreferrer"`. Exact URLs still to be chosen and checked.*

---

## 4. Qué hace

### Todo lo que necesitas, nada más

- **Detecta tu DNI en la foto** y lo endereza solo. Puedes ajustar las esquinas a mano.
- **Reconoce la versión** de tu DNI (3.0 de 2015–2021 o 4.0 desde 2021) y te avisa si has hecho la foto de la cara equivocada.
- **Tapa los datos uno a uno.** Te proponemos qué ocultar según las recomendaciones; tú decides. Pixelado o tapado sólido.
- **Marca de agua con el motivo.** "SOLO PARA: …" cruza toda la tarjeta, así la copia no sirve para otra cosa.
- **PDF a tamaño real**, con el motivo y la fecha. Lo compartes directamente desde el móvil.
- **Pide un DNI a alguien** con un enlace que indica qué datos necesitas y por qué. *(only once the request feature ships)*

### Qué se ve por defecto

| Se ve | Se tapa |
|---|---|
| Nombre y apellidos | Firma |
| Número de DNI | Número de soporte |
| Foto | CAN (número de 6 cifras del anverso) |
| Fecha de nacimiento | Domicilio y lugar de nacimiento |
| Fecha de caducidad | Nombre de los padres |
| | Sexo, nacionalidad, fecha de expedición |
| | Zona de lectura mecánica (las 3 líneas del reverso) |

*Keep this table in sync with `templates/dni_es.js` (`show` flags).*

---

## 5. Cómo funciona

### Tres pasos, un minuto

1. **Haz una foto** de cada cara de tu DNI (el reverso es opcional).
2. **Elige qué tapar** y escribe para qué es la copia.
3. **Comparte el PDF** por WhatsApp, correo o donde lo necesites.

<details><summary><b>Explicación sencilla</b></summary>

La web es como una app que se descarga entera a tu móvil al abrirla. Después, todo el trabajo (recortar la foto, tapar los datos, crear el PDF) lo hace tu propio teléfono. No hay ningún servidor que reciba tus fotos: la página tiene prohibido enviar nada por internet, y es tu navegador quien hace cumplir esa prohibición, no nosotros.

</details>

<details><summary><b>Explicación técnica</b></summary>

- La foto se dibuja en un `<canvas>`, lo que elimina sus metadatos EXIF (ubicación, modelo de móvil…).
- Una transformada de Hough basada en gradientes encuentra los bordes de la tarjeta, y una homografía la endereza a 1012 × 638 px (tamaño ID-1 a unos 300 ppp).
- La versión del DNI se reconoce comparando una "firma" en escala de grises con imágenes de referencia.
- Las zonas ocultas se pixelan con ruido o se tapan; la marca de agua se dibuja encima. Los píxeles originales no quedan en el PDF.
- Un generador de PDF propio, sin dependencias, incrusta las imágenes ya tapadas.
- La política de seguridad (CSP) de todas las páginas incluye `connect-src 'none'` y `form-action 'none'`: el navegador bloquea cualquier envío de datos, aunque hubiera código malicioso.
- Sin compilación ni dependencias: los archivos del repositorio son exactamente los que ejecuta tu navegador.

</details>

---

## 6. No te fíes de nosotros: compruébalo

### Verifica tú mismo que no enviamos nada

**Mira las conexiones de la página** (en ordenador):
1. Abre JustID en Chrome, Edge o Firefox.
2. Pulsa `F12` (o `Cmd + Opción + I` en Mac) y ve a la pestaña **Red** (*Network*).
3. Usa la app normalmente: haz o elige las fotos, tapa datos y genera el PDF.
4. Comprueba que no aparece ninguna petición nueva al procesar tu DNI. Solo verás la carga inicial de los archivos de la propia web.

**Pregúntale a una IA.** Copia este texto en ChatGPT, Claude, Gemini o la que uses:

> Revisa el código fuente de https://github.com/lcandea/justid y dime si esta web puede enviar a algún servidor las fotos o los datos del DNI que se procesan en ella. Fíjate en la política de seguridad de contenido (CSP), en cualquier uso de fetch, XMLHttpRequest, WebSocket, sendBeacon o formularios, y en si carga scripts de terceros. Explícamelo en lenguaje sencillo.

[ Copiar el texto ] *(copy-to-clipboard button; writing to the clipboard is allowed)*

**Lee el código.** El proyecto es de código abierto (licencia MIT): [github.com/lcandea/justid](https://github.com/lcandea/justid)

---

## 7. Pedir un DNI

*(Only once the request feature ships.)*

### ¿Necesitas el DNI de otra persona?

Si eres casero, gestor o empresa, no pidas una foto completa. Crea un enlace que indique qué datos necesitas y para qué: la otra persona verá tu petición, decidirá qué comparte y te enviará una copia con marca de agua por WhatsApp o correo.

Tu petición viaja dentro del propio enlace: no se guarda en ningún servidor.

[ Crear una petición ]

---

## 8. Preguntas frecuentes

**¿Es gratis?**
Sí. Sin registro, sin anuncios y sin letra pequeña.

**¿Funciona sin internet?**
Una vez cargada la página, todo el proceso ocurre en tu dispositivo.

**¿Guardáis mis fotos?**
No. Al cerrar la página desaparecen. No usamos cookies, analíticas ni rastreadores.

**¿Una copia tapada sigue siendo válida?**
Depende de quién la pida. Muchos trámites solo necesitan comprobar tu nombre y tu número de DNI. Si te piden más datos, pregunta para qué los necesitan.

**¿Qué DNI admite?**
El DNI español 3.0 (2015–2021) y 4.0 (desde 2021). Con el marcador de zonas puedes adaptarlo a otros documentos.

---

## 9. Pie de página

JustID es un proyecto independiente y de código abierto. **No está afiliado a la Policía Nacional, al Ministerio del Interior ni a ningún organismo público.**

[Código fuente](https://github.com/lcandea/justid) · Licencia MIT · Idioma: Español / English
