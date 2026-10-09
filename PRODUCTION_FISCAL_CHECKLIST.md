# Checklist para salir a producción con facturación electrónica

Esta lista se repasa **antes de que cualquier punto transmita documentos reales**. Cada casilla tiene un responsable: 🧑‍💼 dueño o administrador, 🧮 contadora, 🔌 proveedor tecnológico, 💻 técnico.

## Contribuyente y DIAN
- [ ] 🧮 El RUT de cada contribuyente está actualizado; nombre, NIT, DV, régimen, responsabilidades y CIIU coinciden con lo registrado en RemHub.
- [ ] 🧮 El contribuyente está **habilitado como facturador electrónico** ante la DIAN (proceso de habilitación terminado).
- [ ] 🧮 Se decidió, por punto, qué documento emite el POS (factura electrónica o documento equivalente electrónico POS).
- [ ] 🧮 Se decidió si algún rango de numeración se comparte entre puntos o si cada punto tiene el suyo.
- [ ] 🧮 Se definió la regla de remisiones (sin control / avisar / bloquear) y el plazo.
- [ ] 🧮 Se definió el tratamiento de los números «anulados sin transmitir» y de los documentos rechazados.
- [ ] 🧮 Se validaron los conceptos de notas crédito y débito con el proveedor.
- [ ] 🧮 Se confirmó si los precios del POS incluyen IVA (opción del contribuyente).
- [ ] 🧮 Se validó la identificación del consumidor final.

## Numeración
- [ ] 🧑‍💼 Las resoluciones de **producción** están cargadas con número, fecha, prefijo, rango y vigencia, en estado activo.
- [ ] 🧑‍💼 La clave técnica de cada resolución está guardada (aparece `🔑 ••••1234`).
- [ ] 🧑‍💼 Si se usaron números en otro sistema, el «siguiente número» está ajustado.
- [ ] 🧑‍💼 Hay numeración para notas crédito y débito.
- [ ] 🧑‍💼 Las alertas de % de uso y días antes del vencimiento están configuradas.
- [ ] 🧑‍💼 Las numeraciones de **pruebas** no tienen puntos de producción autorizados.

## Proveedor tecnológico
- [ ] 🔌 El contrato está firmado y hay credenciales de **producción** separadas de las de pruebas.
- [ ] 💻 El adaptador del proveedor está implementado según su **documentación oficial vigente** (Alegra: completar los `TODO` de `src/lib/fiscal/providers/alegra.ts` y `provider-fields.ts`).
- [ ] 💻 El flujo completo se probó en **pruebas**: factura aceptada, rechazo y reenvío, nota crédito parcial y total, nota débito, falla de red y reintento, contingencia.
- [ ] 💻 El proveedor se marcó como disponible solo después de probarlo: `update fiscal_providers set status='available' where code='<proveedor>';`.
- [ ] 🧑‍💼 La cuenta de producción tiene la prueba de conexión en ✅.
- [ ] 🔌 El webhook está configurado con la URL de la cuenta y su secreto, y en la pestaña Webhooks llega al menos un evento ✅.
- [ ] 🔌 Si el proveedor exige certificado propio, está registrado con su vencimiento.

## Servidor y secretos
- [ ] 💻 `SUPABASE_SERVICE_ROLE_KEY`, `FISCAL_SECRETS_KEY` y `CRON_SECRET` están en el hosting **sin** `NEXT_PUBLIC_`.
- [ ] 💻 `FISCAL_SECRETS_KEY` está respaldada en un gestor seguro: si se pierde, hay que volver a escribir las credenciales.
- [ ] 💻 **Se rotó la llave `service_role`** si alguna vez se compartió `.env.example` (antes contenía la llave real).
- [ ] 💻 La cola automática está programada: `GET /api/fiscal/jobs` con `Authorization: Bearer <CRON_SECRET>` cada 5–10 minutos (Vercel Cron, Supabase `pg_cron` + `pg_net` o un programador externo).
- [ ] 💻 El bucket privado `fiscal-docs` existe en Storage (lo crea la migración) y **no** es público.

## Permisos y RLS
- [ ] 🧑‍💼 Se revisaron los permisos de cada usuario. Los permisos fiscales sensibles los tienen solo personas de confianza.
- [ ] 🧑‍💼 Cada usuario de punto tiene su punto principal correcto y los puntos adicionales que realmente necesita.
- [ ] 💻 `npm run test:sql` pasa (148 verificaciones) y `npm test` pasa (21).
- [ ] 💻 En Panel Admin → Fiscal y seguridad → Seguridad no hay **tablas sin RLS**.
- [ ] 💻 Se comprobó en el proyecto real con dos usuarios de prueba que María no ve los documentos de Javier, y al revés.
- [ ] 💻 Se repitió la prueba de concurrencia en *staging*: dos sesiones facturando a la vez, sin números repetidos.

## Auditoría, respaldos y monitoreo
- [ ] 💻 Los respaldos automáticos de Supabase están activos (ideal: recuperación a un punto en el tiempo, *PITR*). Se probó restaurar un respaldo.
- [ ] 🧑‍💼 Alguien revisa a diario la campana y la pestaña Documentos: rechazados, errores y en cola.
- [ ] 💻 Los logs del hosting se conservan para revisar mensajes `[fiscal]`.
- [ ] 🧑‍💼 Se genera y archiva el **expediente fiscal** de cada punto cada mes.
- [ ] 🧑‍💼 Hay un procedimiento de contingencia escrito: quién la abre, qué se le dice al cliente y quién la cierra.

## Activación (por punto)
- [ ] 🧑‍💼 La ficha del punto → Fiscalidad está en **🟢 Listo para facturar**.
- [ ] 🧑‍💼 Se cambió el ambiente a producción con la cuenta de producción y se escribió el motivo de la confirmación.
- [ ] 🧑‍💼 La primera venta real se emitió, fue aceptada y el comprobante impreso muestra el número, la resolución y el CUFE.
- [ ] 🧮 La contadora revisó el primer día de documentos.
