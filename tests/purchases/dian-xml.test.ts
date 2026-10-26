import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { normName, parseDianInvoice, parseXml, xmlFromZip } from "../../src/lib/purchases/dian-xml";

const INVOICE = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:cac" xmlns:cbc="urn:cbc">
  <cbc:ID>FE1001</cbc:ID>
  <cbc:UUID schemeName="CUFE-SHA384">abc123</cbc:UUID>
  <cbc:IssueDate>2026-10-20</cbc:IssueDate>
  <cbc:DueDate>2026-11-19</cbc:DueDate>
  <cac:AccountingSupplierParty><cac:Party>
    <cac:PartyName><cbc:Name>Sur</cbc:Name></cac:PartyName>
    <cac:PartyTaxScheme><cbc:RegistrationName>DISTRIBUIDORA SUR S.A.S.</cbc:RegistrationName><cbc:CompanyID schemeID="7" schemeName="31">900123456</cbc:CompanyID></cac:PartyTaxScheme>
    <cac:Contact><cbc:Telephone>6041234</cbc:Telephone><cbc:ElectronicMail>ventas@sur.co</cbc:ElectronicMail></cac:Contact>
  </cac:Party></cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty><cac:Party><cac:PartyTaxScheme><cbc:CompanyID>1017</cbc:CompanyID></cac:PartyTaxScheme></cac:Party></cac:AccountingCustomerParty>
  <cac:PaymentMeans><cbc:ID>2</cbc:ID><cbc:PaymentMeansCode>ZZZ</cbc:PaymentMeansCode></cac:PaymentMeans>
  <cac:TaxTotal><cbc:TaxAmount currencyID="COP">19000.00</cbc:TaxAmount></cac:TaxTotal>
  <cac:LegalMonetaryTotal><cbc:LineExtensionAmount currencyID="COP">100000.00</cbc:LineExtensionAmount><cbc:PayableAmount currencyID="COP">119000.00</cbc:PayableAmount></cac:LegalMonetaryTotal>
  <cac:InvoiceLine><cbc:ID>1</cbc:ID><cbc:InvoicedQuantity unitCode="94">3</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="COP">60000.00</cbc:LineExtensionAmount>
    <cac:TaxTotal><cbc:TaxAmount>11400</cbc:TaxAmount><cac:TaxSubtotal><cbc:TaxableAmount>60000</cbc:TaxableAmount><cac:TaxCategory><cbc:Percent>19.00</cbc:Percent></cac:TaxCategory></cac:TaxSubtotal></cac:TaxTotal>
    <cac:Item><cbc:Description>ALCOHOL &amp; GEL  700ML</cbc:Description><cac:SellersItemIdentification><cbc:ID>P-77</cbc:ID></cac:SellersItemIdentification><cac:StandardItemIdentification><cbc:ID schemeID="010">7701234567890</cbc:ID></cac:StandardItemIdentification></cac:Item>
    <cac:Price><cbc:PriceAmount>22000</cbc:PriceAmount></cac:Price></cac:InvoiceLine>
  <cac:InvoiceLine><cbc:ID>2</cbc:ID><cbc:InvoicedQuantity>4</cbc:InvoicedQuantity><cbc:LineExtensionAmount>40000.00</cbc:LineExtensionAmount>
    <cac:Item><cbc:Description>Guantes</cbc:Description></cac:Item><cac:Price><cbc:PriceAmount>10000</cbc:PriceAmount></cac:Price></cac:InvoiceLine>
</Invoice>`;

const ATTACHED = `<?xml version="1.0"?><AttachedDocument xmlns="urn:AttachedDocument" xmlns:cac="c" xmlns:cbc="b">
<cbc:ID>FE1001</cbc:ID><cac:Attachment><cac:ExternalReference><cbc:MimeCode>text/xml</cbc:MimeCode><cbc:EncodingCode>UTF-8</cbc:EncodingCode>
<cbc:Description><![CDATA[${INVOICE}]]></cbc:Description></cac:ExternalReference></cac:Attachment></AttachedDocument>`;

test("lee la factura sola", () => {
  const f = parseDianInvoice(INVOICE);
  assert.equal(f.number, "FE1001");
  assert.equal(f.cufe, "abc123");
  assert.equal(f.issueDate, "2026-10-20");
  assert.equal(f.dueDate, "2026-11-19");
  assert.equal(f.credit, true);
  assert.deepEqual([f.supplier.nit, f.supplier.dv, f.supplier.name, f.supplier.email], ["900123456", "7", "DISTRIBUIDORA SUR S.A.S.", "ventas@sur.co"]);
  assert.equal(f.buyerNit, "1017");
  assert.equal(f.lines.length, 2);
  // Costo antes de IVA con descuento: 60.000 ÷ 3 (no el precio de lista 22.000).
  assert.deepEqual([f.lines[0].unitCost, f.lines[0].taxRate, f.lines[0].sellerCode, f.lines[0].standardCode], [20000, 19, "P-77", "7701234567890"]);
  assert.equal(f.lines[0].description, "ALCOHOL & GEL 700ML");
  assert.deepEqual([f.lines[1].unitCost, f.lines[1].taxRate, f.lines[1].sellerCode], [10000, 0, null]);
  assert.deepEqual([f.subtotal, f.tax, f.total], [100000, 19000, 119000]);
});

test("lee el AttachedDocument del correo (factura en CDATA)", () => {
  const f = parseDianInvoice(ATTACHED);
  assert.equal(f.number, "FE1001");
  assert.equal(f.lines.length, 2);
});

test("rechaza lo que no es factura", () => {
  assert.throws(() => parseDianInvoice("<CreditNote><cbc:ID xmlns:cbc='x'>1</cbc:ID></CreditNote>"), /nota crédito/);
  assert.throws(() => parseDianInvoice("<html></html>"), /no es una factura/);
});

test("atributos con > entre comillas y autocierre", () => {
  const r = parseXml(`<a x="1>2"><b/><c y='z'>t</c></a>`);
  assert.equal(r.children[0].attrs.x, "1>2");
  assert.equal(r.children[0].children.length, 2);
  assert.equal(r.children[0].children[1].text, "t");
});

test("saca el XML de un ZIP", async () => {
  const name = Buffer.from("ad0901234.xml");
  const data = deflateRawSync(Buffer.from(INVOICE));
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(data.length, 18); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10); central.writeUInt32LE(data.length, 20); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(0, 42);
  const cdOffset = 30 + name.length + data.length;
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 10); eocd.writeUInt32LE(46 + name.length, 12); eocd.writeUInt32LE(cdOffset, 16);
  const zip = Buffer.concat([local, name, data, central, name, eocd]);
  const xml = await xmlFromZip(zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.length) as ArrayBuffer);
  assert.equal(parseDianInvoice(xml).number, "FE1001");
});

test("normaliza nombres", () => {
  assert.equal(normName("Jabón  líquido-500ml"), "JABON LIQUIDO 500ML");
});
