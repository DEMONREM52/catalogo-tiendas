// Funciones de animación de framer-motion (arrastrar, layout, gestos). Se cargan aparte, después de la página,
// con <LazyMotion> en app/providers.tsx: los componentes usan `m` (importado como `motion`), que pesa mucho menos.
import { domMax } from "framer-motion";

export default domMax;
