// Nómina electrónica (DIAN, por Alanube): los conceptos que se editan en RemHub y el documento que se transmite.
// Módulo aparte de la nómina interna: solo «trae» de ella lo aprobado del mes para no digitarlo otra vez.

export type OvertimeType = "HED" | "HEN" | "HRN" | "HEDDF" | "HRDDF" | "HENDF" | "HRNDF";
export const OVERTIME: Record<OvertimeType, { label: string; code: string }> = {
  HED: { label: "Hora extra diurna (25 %)", code: "1" },
  HEN: { label: "Hora extra nocturna (75 %)", code: "2" },
  HRN: { label: "Recargo nocturno (35 %)", code: "3" },
  HEDDF: { label: "Extra diurna dominical/festiva (100 %)", code: "4" },
  HRDDF: { label: "Recargo dominical/festivo (75 %)", code: "5" },
  HENDF: { label: "Extra nocturna dominical/festiva (150 %)", code: "6" },
  HRNDF: { label: "Recargo nocturno dominical/festivo (110 %)", code: "7" },
};

export type EPayrollData = {
  days: number;
  salary: number;
  transport: number;
  overtime: Array<{ type: OvertimeType; hours: number; amount: number }>;
  vacation_days: number;
  vacation: number;
  prima_days: number;
  prima: number;
  cesantias: number;
  cesantias_pct: number;
  cesantias_interest: number;
  /** Tipo DIAN: 1 común, 2 profesional, 3 laboral. */
  disabilities: Array<{ type: "1" | "2" | "3"; days: number; amount: number }>;
  paid_leave_days: number;
  paid_leave: number;
  unpaid_leave_days: number;
  bonus_s: number;
  bonus_ns: number;
  aid_s: number;
  aid_ns: number;
  commissions: number;
  others: Array<{ description: string; salary: boolean; amount: number }>;
  health_pct: number;
  health: number;
  pension_pct: number;
  pension: number;
  fsp_pct: number;
  fsp: number;
  libranzas: Array<{ description: string; amount: number }>;
  advances: number;
  debt: number;
  withholding: number;
  other_deductions: number;
  payment_dates: string[];
  notes: string;
};

export const EMPTY_EPAYROLL: EPayrollData = {
  days: 30, salary: 0, transport: 0, overtime: [], vacation_days: 0, vacation: 0, prima_days: 0, prima: 0,
  cesantias: 0, cesantias_pct: 12, cesantias_interest: 0, disabilities: [], paid_leave_days: 0, paid_leave: 0, unpaid_leave_days: 0,
  bonus_s: 0, bonus_ns: 0, aid_s: 0, aid_ns: 0, commissions: 0, others: [], health_pct: 4, health: 0, pension_pct: 4, pension: 0,
  fsp_pct: 0, fsp: 0, libranzas: [], advances: 0, debt: 0, withholding: 0, other_deductions: 0, payment_dates: [], notes: "",
};

/** Datos DIAN del trabajador (perfil de la nómina electrónica, aparte de la ficha interna). */
export type EPayrollProfile = {
  worker_type: string;
  sub_type: string;
  high_risk: boolean;
  doc_type: string;
  first_name: string;
  other_names: string;
  last_name: string;
  second_last_name: string;
  contract_type: string;
  integral: boolean;
  city_code: string;
  address: string;
  payment_method: string;
  bank: string;
  account_type: string;
  account_number: string;
  worker_code: string;
};

export const WORKER_TYPES: Array<[string, string]> = [["01", "Dependiente"], ["02", "Servicio doméstico"], ["12", "Aprendiz SENA (etapa lectiva)"], ["19", "Aprendiz SENA (etapa productiva)"], ["20", "Estudiante (régimen especial)"], ["23", "Practicante"]];
export const CONTRACT_TYPES: Array<[string, string]> = [["1", "Término fijo"], ["2", "Término indefinido"], ["3", "Obra o labor"], ["4", "Aprendizaje"], ["5", "Prácticas o pasantías"]];
export const PAYMENT_METHODS: Array<[string, string]> = [["47", "Transferencia bancaria"], ["42", "Consignación bancaria"], ["10", "Efectivo"], ["20", "Cheque"]];
export const ID_TYPES: Array<[string, string]> = [["13", "Cédula de ciudadanía"], ["22", "Cédula de extranjería"], ["12", "Tarjeta de identidad"], ["41", "Pasaporte"], ["47", "PEP"], ["48", "PPT"]];
const INTERNAL_ID: Record<string, string> = { CC: "13", CE: "22", TI: "12", PP: "41", PAS: "41", PEP: "47", PPT: "48" };

const n = (v: unknown) => Math.round((Number(v) || 0) * 100) / 100;
const sum = (xs: number[]) => n(xs.reduce((a, b) => a + (Number(b) || 0), 0));

/** Perfil inicial a partir de la ficha interna (separa nombres y apellidos lo mejor posible). */
export function profileFromEmployee(e: { full_name: string; document_type?: string | null; contract_type?: string | null; bank_name?: string | null; bank_account?: string | null }, saved?: Partial<EPayrollProfile> | null): EPayrollProfile {
  const parts = e.full_name.trim().split(/\s+/).filter(Boolean);
  const [first = "", ...rest] = parts;
  let other = "", last = "", last2 = "";
  if (rest.length === 1) last = rest[0];
  else if (rest.length === 2) [last, last2] = rest;
  else if (rest.length >= 3) { other = rest.slice(0, rest.length - 2).join(" "); [last, last2] = rest.slice(-2); }
  const contract = /fijo/i.test(e.contract_type ?? "") ? "1" : /obra/i.test(e.contract_type ?? "") ? "3" : /aprend/i.test(e.contract_type ?? "") ? "4" : /pr[aá]ctic/i.test(e.contract_type ?? "") ? "5" : "2";
  return {
    worker_type: "01", sub_type: "00", high_risk: false, doc_type: INTERNAL_ID[(e.document_type ?? "CC").toUpperCase()] ?? "13",
    first_name: first.toUpperCase(), other_names: other.toUpperCase(), last_name: last.toUpperCase(), second_last_name: last2.toUpperCase(),
    contract_type: contract, integral: false, city_code: "", address: "",
    // «Efectivo» en el campo banco de la ficha interna = pago en efectivo.
    payment_method: /^efectivo$/i.test(e.bank_name ?? "") || !e.bank_account ? "10" : "47", bank: /^efectivo$/i.test(e.bank_name ?? "") ? "" : e.bank_name ?? "",
    account_type: "Ahorros", account_number: /^efectivo$/i.test(e.bank_name ?? "") ? "" : e.bank_account ?? "", worker_code: "",
    ...(saved ?? {}),
  };
}

/** De lo aprobado en la nómina interna del mes a los conceptos DIAN (para revisar antes de enviar). */
export function prefillFromInternal(items: Array<{ code: string; name: string; kind: string; value: number | null; amount: number }>, days: number, paymentDates: string[]): { data: EPayrollData; review: string[] } {
  const d: EPayrollData = { ...EMPTY_EPAYROLL, overtime: [], disabilities: [], others: [], libranzas: [], payment_dates: [...paymentDates], days: Math.min(30, Number(days) || 0) };
  const review: string[] = [];
  for (const it of items) {
    const amt = n(it.amount);
    if (!amt || it.kind === "employer") continue;
    switch (it.code) {
      case "SALARIO": d.salary = n(d.salary + amt); break;
      case "AUX_TRANSPORTE": d.transport = n(d.transport + amt); break;
      case "COMISIONES": d.commissions = n(d.commissions + amt); break;
      case "BONIFICACION": d.bonus_ns = n(d.bonus_ns + amt); break;
      case "SALUD": d.health = n(d.health + amt); d.health_pct = Number(it.value) || 4; break;
      case "PENSION": d.pension = n(d.pension + amt); d.pension_pct = Number(it.value) || 4; break;
      case "ANTICIPO": d.advances = n(d.advances + amt); break;
      case "VALE": d.debt = n(d.debt + amt); break;
      case "OTRAS_DED": d.other_deductions = n(d.other_deductions + amt); break;
      case "HORAS_EXTRA":
        d.others.push({ description: it.name || "Horas extra y recargos", salary: true, amount: amt });
        review.push("Horas extra: la DIAN las pide por tipo y con cantidad de horas. Pásalas a «Horas extra y recargos».");
        break;
      default:
        if (it.kind === "earning") { d.others.push({ description: it.name || it.code, salary: true, amount: amt }); review.push(`«${it.name}»: revisa si es salarial o no salarial.`); }
        else d.other_deductions = n(d.other_deductions + amt);
    }
  }
  return { data: d, review };
}

export function epayrollTotals(d: EPayrollData) {
  const devengados = sum([
    d.salary, d.transport, ...d.overtime.map((x) => x.amount), d.vacation, d.prima, d.cesantias, d.cesantias_interest,
    ...d.disabilities.map((x) => x.amount), d.paid_leave, d.bonus_s, d.bonus_ns, d.aid_s, d.aid_ns, d.commissions, ...d.others.map((x) => x.amount),
  ]);
  const deducciones = sum([d.health, d.pension, d.fsp, ...d.libranzas.map((x) => x.amount), d.advances, d.debt, d.withholding, d.other_deductions]);
  return { devengados, deducciones, total: n(devengados - deducciones) };
}

/** Problemas que harían rechazar el documento (antes de mandarlo). */
export function epayrollProblems(d: EPayrollData, p: EPayrollProfile): string[] {
  const out: string[] = [];
  if (!(d.days > 0)) out.push("Faltan los días trabajados.");
  if (!(d.salary > 0) && !(d.vacation > 0) && !d.disabilities.length) out.push("Falta el sueldo trabajado.");
  if (!p.first_name || !p.last_name) out.push("Faltan el primer nombre y el primer apellido del trabajador.");
  if (!/^\d{5}$/.test(p.city_code)) out.push("Falta el municipio (código DANE) donde trabaja el trabajador.");
  if (!p.address.trim()) out.push("Falta la dirección del trabajador.");
  if (!d.payment_dates.length) out.push("Falta al menos una fecha de pago.");
  if (d.overtime.some((x) => !(x.hours > 0))) out.push("Cada hora extra lleva su cantidad de horas.");
  if (epayrollTotals(d).total < 0) out.push("Las deducciones superan lo devengado.");
  return out;
}

export type EPayrollContext = {
  prefix: string;
  number: number;
  companyId: string | null;
  period: string;
  employer: { legal_name: string; person_type: string; document_number: string | null; verification_digit: string | null };
  settings: { city_code: string | null; address: string | null; payment_method: string };
  employee: { document: string | null; base_salary: number; pay_frequency: string | null; hired_on: string | null; terminated_on: string | null };
  profile: EPayrollProfile;
  data: EPayrollData;
};

const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "");
const monthEnd = (period: string) => {
  const [y, m] = period.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
const daysBetween = (a: string, b: string) => Math.max(1, Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000) + 1);
const PERIOD_CODE: Record<string, string> = { weekly: "1", decadal: "2", biweekly: "4", quincenal: "4", monthly: "5", mensual: "5" };
const opt = <T,>(cond: unknown, v: T) => (cond ? v : undefined);

/** Cuerpo para POST /payrolls (o /payrolls/{id}/replace) de Alanube. */
export function buildPayrollBody(c: EPayrollContext) {
  const d = c.data;
  const p = c.profile;
  const start = c.period.slice(0, 10);
  const end = monthEnd(start);
  const hired = c.employee.hired_on?.slice(0, 10) ?? start;
  const retired = c.employee.terminated_on && c.employee.terminated_on.slice(0, 10) <= end && c.employee.terminated_on.slice(0, 10) >= start ? c.employee.terminated_on.slice(0, 10) : null;
  const liqStart = hired > start ? hired : start;
  const liqEnd = retired ?? end;
  const city = c.settings.city_code ?? "";
  const totals = epayrollTotals(d);
  const ot = (t: OvertimeType) => d.overtime.filter((x) => x.type === t).map((x) => ({ Cantidad: n(x.hours), Porcentaje: OVERTIME[t].code, Pago: n(x.amount) }));
  const otBlocks = Object.fromEntries((Object.keys(OVERTIME) as OvertimeType[]).filter((t) => ot(t).length).map((t) => [`${t}s`, { [t]: ot(t) }]));
  const natural = c.employer.person_type === "natural";
  const empName = c.employer.legal_name.trim().split(/\s+/);

  const devengados = {
    Basico: { DiasTrabajados: Math.round(d.days), SueldoTrabajado: n(d.salary) },
    ...opt(d.transport > 0, { Transporte: [{ AuxilioTransporte: n(d.transport) }] }),
    ...otBlocks,
    ...opt(d.vacation > 0, { Vacaciones: { VacacionesComunes: [{ Cantidad: Math.round(d.vacation_days), Pago: n(d.vacation) }] } }),
    ...opt(d.prima > 0, { Primas: { Cantidad: Math.round(d.prima_days), Pago: n(d.prima) } }),
    ...opt(d.cesantias > 0 || d.cesantias_interest > 0, { Cesantias: { Pago: n(d.cesantias), Porcentaje: n(d.cesantias_pct), PagoIntereses: n(d.cesantias_interest) } }),
    ...opt(d.disabilities.length, { Incapacidades: { Incapacidad: d.disabilities.map((x) => ({ Cantidad: Math.round(x.days), Tipo: Number(x.type), Pago: n(x.amount) })) } }),
    ...opt(d.paid_leave > 0 || d.unpaid_leave_days > 0, { Licencias: {
      ...opt(d.paid_leave > 0, { LicenciaR: [{ Cantidad: Math.round(d.paid_leave_days), Pago: n(d.paid_leave) }] }),
      ...opt(d.unpaid_leave_days > 0, { LicenciaNR: [{ Cantidad: Math.round(d.unpaid_leave_days) }] }),
    } }),
    ...opt(d.bonus_s > 0 || d.bonus_ns > 0, { Bonificaciones: { Bonificacion: [{ ...opt(d.bonus_s > 0, { BonificacionS: n(d.bonus_s) }), ...opt(d.bonus_ns > 0, { BonificacionNS: n(d.bonus_ns) }) }] } }),
    ...opt(d.aid_s > 0 || d.aid_ns > 0, { Auxilios: { Auxilio: [{ ...opt(d.aid_s > 0, { AuxilioS: n(d.aid_s) }), ...opt(d.aid_ns > 0, { AuxilioNS: n(d.aid_ns) }) }] } }),
    ...opt(d.others.length, { OtrosConceptos: { OtroConcepto: d.others.map((x) => ({ DescripcionConcepto: x.description.slice(0, 100), ...(x.salary ? { ConceptoS: n(x.amount) } : { ConceptoNS: n(x.amount) }) })) } }),
    ...opt(d.commissions > 0, { Comisiones: { Comision: [n(d.commissions)] } }),
  };
  const deducciones = {
    Salud: { Porcentaje: n(d.health_pct), Deduccion: n(d.health) },
    FondoPension: { Porcentaje: n(d.pension_pct), Deduccion: n(d.pension) },
    ...opt(d.fsp > 0, { FondoSP: { Porcentaje: n(d.fsp_pct), DeduccionSP: n(d.fsp) } }),
    ...opt(d.libranzas.length, { Libranzas: { Libranza: d.libranzas.map((x) => ({ Descripcion: x.description.slice(0, 100), Deduccion: n(x.amount) })) } }),
    ...opt(d.advances > 0, { Anticipos: { Anticipo: [n(d.advances)] } }),
    ...opt(d.other_deductions > 0, { OtrasDeducciones: { OtraDeduccion: [n(d.other_deductions)] } }),
    ...opt(d.withholding > 0, { RetencionFuente: n(d.withholding) }),
    ...opt(d.debt > 0, { Deuda: n(d.debt) }),
  };

  return {
    ...(c.companyId ? { company: { id: c.companyId } } : {}),
    prefix: c.prefix,
    number: c.number,
    governmentData: {
      Periodo: {
        FechaIngreso: hired,
        ...(retired ? { FechaRetiro: retired } : {}),
        FechaLiquidacionInicio: liqStart,
        FechaLiquidacionFin: liqEnd,
        TiempoLaborado: daysBetween(hired, liqEnd),
      },
      LugarGeneracionXML: { Pais: "CO", DepartamentoEstado: city.slice(0, 2), MunicipioCiudad: city, Idioma: "es" },
      InformacionGeneral: { PeriodoNomina: PERIOD_CODE[c.employee.pay_frequency ?? ""] ?? "5", TipoMoneda: "COP", ...(d.notes ? { Notas: d.notes.slice(0, 500) } : {}) },
      Empleador: {
        ...(natural
          ? { PrimerNombre: empName[0] ?? "", PrimerApellido: empName.at(-2) ?? empName.at(-1) ?? "", ...(empName.length > 3 ? { SegundoApellido: empName.at(-1) } : {}) }
          : { RazonSocial: c.employer.legal_name }),
        NIT: Number(digits(c.employer.document_number)),
        DV: Number(c.employer.verification_digit ?? 0),
        Pais: "CO", DepartamentoEstado: city.slice(0, 2), MunicipioCiudad: city, Direccion: c.settings.address ?? "",
      },
      Trabajador: {
        TipoTrabajador: p.worker_type, SubTipoTrabajador: p.sub_type, AltoRiesgoPension: Boolean(p.high_risk),
        TipoDocumento: p.doc_type, NumeroDocumento: Number(digits(c.employee.document)),
        PrimerApellido: p.last_name, ...(p.second_last_name ? { SegundoApellido: p.second_last_name } : {}),
        PrimerNombre: p.first_name, ...(p.other_names ? { OtrosNombres: p.other_names } : {}),
        LugarTrabajoPais: "CO", LugarTrabajoDepartamentoEstado: p.city_code.slice(0, 2), LugarTrabajoMunicipioCiudad: p.city_code, LugarTrabajoDireccion: p.address,
        SalarioIntegral: Boolean(p.integral), TipoContrato: p.contract_type, Sueldo: n(c.employee.base_salary),
        ...(p.worker_code ? { CodigoTrabajador: p.worker_code } : {}),
      },
      Pago: {
        Forma: "1",
        Metodo: p.payment_method || c.settings.payment_method || "47",
        ...(p.payment_method !== "10" && p.account_number ? { Banco: p.bank, TipoCuenta: p.account_type, NumeroCuenta: p.account_number } : {}),
      },
      FechasPagos: { FechaPago: d.payment_dates.length ? d.payment_dates : [end] },
      Devengados: devengados,
      Deducciones: deducciones,
      Redondeo: 0,
      DevengadosTotal: totals.devengados,
      DeduccionesTotal: totals.deducciones,
      ComprobanteTotal: totals.total,
    },
  };
}
