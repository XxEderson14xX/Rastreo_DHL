# Rastreo DHL · Evidencias para tickets

App estática (GitHub Pages) para consultar guías de DHL Express en lote y generar fichas en PNG o PDF que puedes subir al sistema de tickets.

## ¿Por qué hay una Edge Function si es GitHub Pages?
GitHub Pages solo sirve archivos estáticos. Si la DHL API Key va en `app.js`, cualquiera puede verla, y además el navegador puede bloquear la llamada directa a DHL (CORS).
La función `dhl-track` en Supabase guarda la llave como secreto y solo reenvía la consulta.

```
GitHub Pages (index.html)  ──►  Supabase Edge Function (dhl-track)  ──►  api-eu.dhl.com
                                    DHL_API_KEY vive aquí
```

## Paso 1 · DHL API Key
1. Crea tu cuenta en https://developer.dhl.com con tu correo de trabajo.
2. Ve a **My Apps → Create App** y agrega **Shipment Tracking - Unified**.
3. Copia la **API Key**. La API Secret no se usa.

## Paso 2 · Edge Function en Supabase
Puedes usar tu proyecto de Supabase actual o crear uno nuevo.
1. **Edge Functions → Deploy a new function → Via Editor**, con el nombre `dhl-track`.
2. Pega el contenido de `supabase/functions/dhl-track/index.ts` y despliégala.
3. En **Edge Functions → Secrets**, agrega:
   - `DHL_API_KEY` = tu llave de DHL
   - `ALLOWED_ORIGIN` = `https://TU-USUARIO.github.io` (sin `/` al final; separa varios orígenes con coma)
4. Deja **Verify JWT = ON**. La app manda la anon key y así nadie la usa sin ella.
5. Copia la URL: `https://XXXX.supabase.co/functions/v1/dhl-track`

## Paso 3 · GitHub Pages
1. Crea un repositorio nuevo y sube `index.html`, `styles.css`, `app.js` y `README.md`. La carpeta `supabase/` es opcional.
2. Ve a **Settings → Pages → Deploy from branch → main / (root)**.
3. Abre `https://TU-USUARIO.github.io/NOMBRE-REPO/`.

> El repo puede ser público: no contiene llaves ni datos. Las guías y la configuración se guardan solo en el navegador de quien usa la app.

## Paso 4 · Configurar la app
En **⚙️ Configuración**:
- Modo: **Proxy Supabase**
- URL de la Edge Function y la **anon key** del proyecto
- Presiona **Probar conexión**

Si quieres ver cómo se ven las fichas sin llave, usa el modo **Demo**.

## Uso
- **Carga tu Excel** (el mismo formato de PRIME: `TICKET`, `NO GUIA`, `CP DESTINO`, `PDV`, `CONTACTO`, etc.) o pega las líneas como `ticket, guía, cp`.
- **Consultar todas**: consulta las guías visibles y se salta las que ya están entregadas.
- **Ficha**: descárgala en PNG o PDF, o usa **Copiar imagen** para pegarla directo en el ticket.
- **ZIP de capturas**: descarga todas las fichas como `TICKET_GUIA.png`.
- **Resumen Excel**: descarga una tabla con el estatus de cada guía.

### Importante: el CP destino
Sin el CP destino, DHL oculta parte del historial y el comprobante de entrega. La app completa los CP a 5 dígitos (por ejemplo, `6030` pasa a `06030`).

### Límite de consultas
La llave de DHL tiene un límite diario por defecto. Si ves errores 429, sube la **pausa entre consultas** o pide un aumento en developer.dhl.com (My Apps → Actions).
