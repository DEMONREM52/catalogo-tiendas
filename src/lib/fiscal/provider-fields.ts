// Campos de credenciales por proveedor (seguro para el navegador: solo describe los campos,
// nunca contiene valores). Los adaptadores del servidor usan esta misma lista.
export type CredentialFieldInfo = { key: string; label: string; secret: boolean; required: boolean; help?: string };

export const PROVIDER_CREDENTIAL_FIELDS: Record<string, CredentialFieldInfo[]> = {
  sandbox: [
    { key: "webhook_secret", label: "Secreto del webhook", secret: true, required: false, help: "Se genera con «Generar secreto»; sirve para firmar webhooks de prueba." },
  ],
  // TODO: reemplazar por los campos exactos que exija Alegra según el contrato (no inventados aquí).
  alegra: [
    { key: "api_user", label: "Usuario de la API", secret: false, required: true, help: "Según el contrato con Alegra (confirmar en su documentación oficial)." },
    { key: "api_token", label: "Token / llave de la API", secret: true, required: true, help: "Se guarda cifrado; nunca se muestra completo." },
    { key: "webhook_secret", label: "Secreto de los webhooks", secret: true, required: false, help: "Solo si Alegra firma los webhooks (confirmar esquema)." },
  ],
};

/** Opciones visibles (no secretas) que entiende cada adaptador. */
export const PROVIDER_SETTINGS_HELP: Record<string, Array<{ key: string; label: string; options?: Array<[string, string]>; help?: string }>> = {
  sandbox: [
    {
      key: "simulate",
      label: "Comportamiento del simulador",
      options: [
        ["accept", "Aceptar documentos válidos"],
        ["reject", "Rechazar todo (probar correcciones)"],
        ["error", "Falla de conexión (probar reintentos)"],
        ["pending", "Responder después (probar estados y webhooks)"],
      ],
      help: "Solo para pruebas. Nada se transmite a la DIAN.",
    },
  ],
  alegra: [],
};
