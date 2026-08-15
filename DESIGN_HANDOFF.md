# Diseño de Battle — límites obligatorios

Esta rama (`codex/design-new-ui`) es exclusivamente para renovar la interfaz visual.

## Se puede modificar

- `src/`
- `public/`
- estilos, componentes visuales, copy, iconos y assets que sean necesarios para el diseño

## No se puede modificar

- `api/`
- `server/`
- `supabase/`
- `vercel.json`, `.env*`, ni variables de entorno
- `package.json` y `package-lock.json`
- lógica de wallet, Privy, Solana, tesorería, depósitos, liquidación, cron o comisiones

## Reglas de trabajo

1. Mantener intactos los flujos y props existentes: conectar/desconectar wallet, crear/unirse a una batalla, depósitos, historial y enlaces de transacciones.
2. No simular datos ni sustituir las llamadas existentes por datos fijos.
3. No borrar páginas funcionales. Se pueden rediseñar, pero deben seguir accesibles y operativas.
4. No publicar en producción. Usar un Preview de Vercel para mostrar el diseño.
5. Antes de finalizar, ejecutar `npm run lint` y `npm run build`.
6. Informar exactamente qué archivos se cambiaron y no tocar archivos fuera del alcance permitido.

## Entrega esperada

Un rediseño visual de alto nivel para Battle, responsive, manteniendo el backend y todas las integraciones sin cambios.
