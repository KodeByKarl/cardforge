// Generates tests/fixtures/sample-employees.xlsx: a realistic sheet with deliberate data problems.
// Usage: node scripts/make-sample-workbook.mjs
import ExcelJS from 'exceljs'
import { fileURLToPath } from 'node:url'

const out = fileURLToPath(new URL('../tests/fixtures/sample-employees.xlsx', import.meta.url))
const wb = new ExcelJS.Workbook()
const ws = wb.addWorksheet('Employees')
ws.addRow(['ACME Holdings — Calling Card Request, October 2026'])
ws.addRow([])
ws.addRow(['Full Name', 'Job Title', 'Company', 'Mobile Number', 'Telephone Number', 'Email', 'Address'])
const rows = [
  ['Ana Cruz', 'Operations Manager', 'ACME Holdings', '0917 123 4567', '(02) 8123 4567 loc. 204', 'ana.cruz@acme.example', 'Unit 5, Ayala Tower\nMakati City'],
  ['Benjamin Santos', 'Senior Engineer', 'ACME Holdings', '0918 555 0101', '', 'ben.santos@acme.example', 'Taguig City'],
  ['José Peña-Ñuñez', 'Finance Director', 'ACME Holdings', '+63 917 222 3333', '(02) 8123 4500', 'jose.pena@acme.example', 'Makati City'],
  ['', 'Intern', 'ACME Holdings', '0919 000 1111', '', 'intern@acme.example', 'Pasig City'],
  ['Maria Concepcion Josefina Dela Cruz-Villanueva', 'Chief Executive Officer and Chairperson of the Board', 'ACME Holdings', '0917 888 9999', '', 'maria.villanueva@acme.example', 'Makati City'],
  [],
  ['Carlo Reyes', 'Sales Associate', 'ACME Holdings', 'to follow', '', 'carlo.reyes@acme', 'Quezon City'],
  ['ANA CRUZ', 'Operations Manager', 'ACME Holdings', '0917 123 4567', '', 'Ana.Cruz@ACME.example', 'Makati City'],
  ["Liam O'Brien", 'Designer', 'ACME Holdings', '0920 444 5555', '', 'liam.obrien@acme.example', 'Cebu City']
]
for (const r of rows) ws.addRow(r)
ws.getColumn(1).width = 40
ws.getColumn(7).alignment = { wrapText: true }
wb.addWorksheet('Notes').addRow(['Prepared by HR'])
await wb.xlsx.writeFile(out)
console.log('Wrote', out)
