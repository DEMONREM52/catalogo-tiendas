import { Suspense } from "react";
import ResetPasswordClient from "./ResetPasswordClient";

export default function Page() {
  return (
    <Suspense fallback={<main className="p-6">Cargando...</main>}>
      <ResetPasswordClient />
    </Suspense>
  );
}
