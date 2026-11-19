# GMC360 · Contactos del congreso

Mini CRM para captura de contactos en eventos. PWA (se instala en el celular), tarjetas QR por persona del equipo, panel y exportación a CSV.

- **Front:** HTML/CSS/JS sin framework en `public/`.
- **Backend:** una Netlify Function (`netlify/functions/api.mts`) con Netlify Blobs como base.
- **Equipo y textos de las tarjetas:** `public/equipo.json`.
- **Libros de regalo:** PDF en `public/libros/` y registro en `public/libros.json`.
- **Variable de entorno requerida en Netlify:** `ACCESS_KEY` (llave de acceso del equipo; no se guarda en el repo).
