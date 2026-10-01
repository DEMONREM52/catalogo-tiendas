export type ContentFinding = {
  phrase: string;
  category:
    | "Lenguaje ofensivo"
    | "Contenido sexual"
    | "Alcohol"
    | "Violencia o amenaza"
    | "Acoso o discurso de odio";
  explanation: string;
};

const offensivePhrases = [
  "hijueputa",
  "hijueputas",
  "gonorrea",
  "malparido",
  "malparida",
  "malparidos",
  "malparidas",
  "marica",
  "maricon",
  "mierda",
  "mierdas",
  "pendejo",
  "pendeja",
  "pendejos",
  "pendejas",
  "estupido",
  "estupida",
  "idiota",
  "imbecil",
  "puto",
  "puta",
  "perra",
  "zorra",
  "cabron",
  "cabrona",
  "cagon",
  "culo",
  "joder",
  "fuck",
  "bitch",
  "shit",
  "asshole",
  "motherfucker",
  "bastard",
  "cunt",
];

const sexualPhrases = [
  "sexo",
  "sexual",
  "pornografia",
  "porno",
  "desnudo",
  "desnuda",
  "desnudos",
  "desnudas",
  "genitales",
  "masturbacion",
  "prostitucion",
  "violacion",
  "violador",
  "violadora",
];

const alcoholPhrases = [
  "alcohol",
  "bebida alcoholica",
  "bebidas alcoholicas",
  "licor",
  "cerveza",
  "vino",
  "aguardiente",
  "whisky",
  "vodka",
  "ron",
  "tequila",
];

const violentActions = [
  "matar",
  "asesinar",
  "apuñalar",
  "apuñala",
  "apuñalamiento",
  "atacar",
  "ataca",
  "herir",
  "hieren",
  "disparar",
  "dispara",
  "golpear",
  "golpea",
  "amenazar",
  "amenaza",
  "torturar",
  "tortura",
  "lastimar",
  "lastima",
  "dañar",
  "daña",
  "mata",
  "mato",
  "matarte",
  "matarlo",
  "matarla",
  "matarlos",
  "matarlas",
  "matara",
  "matare",
  "maten",
  "asesinarte",
  "asesinarlo",
  "asesinarla",
  "apuñalarte",
  "apuñalarlo",
  "apuñalarla",
  "dispararte",
  "dispararle",
  "golpearte",
  "golpearlo",
  "golpearla",
  "herirte",
  "herirlo",
  "herirla",
  "lastimarte",
  "lastimarlo",
  "lastimarla",
  "hacer daño",
  "hacerte daño",
  "te hare daño",
  "te voy a matar",
  "te vamos a matar",
  "voy a matarte",
  "vamos a matarte",
  "te voy a atacar",
  "te voy a apuñalar",
  "te voy a disparar",
  "te voy a golpear",
  "te voy a envenenar",
  "te voy a lastimar",
  "te voy a herir",
  "te voy a dañar",
  "voy a acabar contigo",
  "vas a morir",
  "deberias morir",
  "mereces morir",
  "amenaza de muerte",
  "envenenar",
  "envenena",
];

const violentTargets = [
  "persona",
  "personas",
  "alguien",
  "cliente",
  "clientes",
  "mujer",
  "hombre",
  "niño",
  "niña",
  "enemigo",
  "enemiga",
  "familia",
  "hijo",
  "hija",
  "pareja",
  "vecino",
  "vecina",
];

const harassmentPhrases = [
  "te voy a violar",
  "ojala te violen",
  "muerte a",
  "hay que exterminar",
  "vamos a exterminar",
  "odio a todos los",
  "odio a todas las",
];

function normalizeWords(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[013457@$!]/g, (character) => {
      const replacements: Record<string, string> = {
        "0": "o",
        "1": "i",
        "3": "e",
        "4": "a",
        "5": "s",
        "7": "t",
        "@": "a",
        "$": "s",
        "!": "i",
      };
      return replacements[character] ?? character;
    })
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function findTerms(text: string, terms: string[]) {
  const normalizedWords = normalizeWords(text).split(" ");
  const normalizedText = ` ${normalizedWords.join(" ")} `;
  return terms.filter((term) => {
    const normalizedTerm = normalizeWords(term);
    if (normalizedText.includes(` ${normalizedTerm} `)) return true;
    if (!normalizedTerm.includes(" ") && normalizedTerm.length >= 6) {
      return normalizedWords.some((word) => word.startsWith(normalizedTerm));
    }
    return false;
  });
}

export function reviewCommercialContent(text: string): ContentFinding[] {
  const normalized = normalizeWords(text);
  const findings: ContentFinding[] = [];

  for (const phrase of findTerms(text, offensivePhrases)) {
    findings.push({
      phrase,
      category: "Lenguaje ofensivo",
      explanation: "Elimina insultos o expresiones degradantes del texto comercial.",
    });
  }

  for (const phrase of findTerms(text, sexualPhrases)) {
    findings.push({
      phrase,
      category: "Contenido sexual",
      explanation: "Revisa esta referencia antes de enviar el contenido a revisión.",
    });
  }

  for (const phrase of findTerms(text, alcoholPhrases)) {
    findings.push({
      phrase,
      category: "Alcohol",
      explanation: "La mención de alcohol puede estar restringida según la plataforma y el público.",
    });
  }

  const actions = findTerms(text, violentActions);
  const targets = findTerms(text, violentTargets);
  const mentionsWeapon = /\b(cuchillo|navaja|machete|arma|pistola|rifle|bala|explosivo|bomba)\b/.test(normalized);
  const threats = findTerms(text, violentActions.filter((term) => term.includes(" ") && term !== "hacer daño"));
  if (threats.length || (actions.length && (targets.length || mentionsWeapon))) {
    findings.push({
      phrase: [...new Set([...threats, ...actions, ...targets, ...(mentionsWeapon && actions.length ? ["arma"] : [])])].join(", "),
      category: "Violencia o amenaza",
      explanation: "El contexto parece describir daño, amenaza o uso agresivo. Verifica y corrige el texto.",
    });
  }

  for (const phrase of findTerms(text, harassmentPhrases)) {
    findings.push({
      phrase,
      category: "Acoso o discurso de odio",
      explanation: "Evita amenazas de violencia sexual, llamados a la muerte o expresiones de odio hacia grupos.",
    });
  }

  return findings;
}
