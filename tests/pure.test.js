"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const PURE = require("../js/pure.js");

test("TOTAL_CASAS es 146", () => {
  assert.equal(PURE.TOTAL_CASAS, 146);
});

test("rangoCasas genera el array 1..146", () => {
  const arr = PURE.rangoCasas();
  assert.equal(arr.length, 146);
  assert.equal(arr[0], 1);
  assert.equal(arr[145], 146);
  assert.ok(arr.includes(3));
});

test("catLabel devuelve etiquetas conocidas o la clave tal cual", () => {
  assert.equal(PURE.catLabel("instalaciones"), "Estado de instalaciones");
  assert.equal(PURE.catLabel("seguridad"), "Seguridad");
  assert.equal(PURE.catLabel("otro"), "Otros");
  assert.equal(PURE.catLabel("inventado"), "inventado");
  assert.equal(PURE.catLabel(null), null);
});

test("catLabel mapea las categorías legadas a 'Seguridad'", () => {
  assert.equal(PURE.catLabel("acceso"), "Seguridad");
  assert.equal(PURE.catLabel("turnos"), "Seguridad");
});

test("fmtFecha formatea ISO local a '05 ene 2024, 09:00'", () => {
  assert.equal(PURE.fmtFecha("2024-01-05T09:00:00"), "05 ene 2024, 09:00");
  assert.equal(PURE.fmtFecha(null), "");
});

test("fmtMes formatea YYYY-MM a 'ene 24'", () => {
  assert.equal(PURE.fmtMes("2024-01"), "ene 24");
});

test("fmtErr traduce errores conocidos y devuelve otros tal cual", () => {
  assert.match(PURE.fmtErr("Could not find the function..."), /base de datos/i);
  assert.equal(PURE.fmtErr("texto sin patrón"), "texto sin patrón");
  assert.equal(PURE.fmtErr(null), "");
});

test("construirCSV escapa comas, comillas y produce cabecera", () => {
  const csv = PURE.construirCSV(
    [{ fecha: "01/01/24", nota: 'sillas, "de playa"' }],
    [
      { label: "Fecha", val: (r) => r.fecha },
      { label: "Nota", val: (r) => r.nota }
    ]
  );
  const lines = csv.split("\n");
  assert.equal(lines[0], '"Fecha","Nota"');
  assert.equal(lines[1], '"01/01/24","sillas, ""de playa"""');
});

test("construirCSV con datos vacíos devuelve cadena vacía", () => {
  assert.equal(PURE.construirCSV([], []), "");
});