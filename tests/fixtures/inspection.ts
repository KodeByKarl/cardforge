import type { TemplateInspection, TemplateObject } from '../../src/shared/template/types'

function obj(name: string, pageIndex: number, text: string, extra: Partial<TemplateObject> = {}): TemplateObject {
  return {
    name,
    pageIndex,
    path: [],
    text,
    font: 'Arial',
    sizePt: 10,
    bold: false,
    italic: false,
    alignment: 1,
    isParagraph: false,
    mixedFormatting: false,
    bounds: { left: 10, bottom: 30, right: 40, top: 35 },
    ...extra
  }
}

/** Mirrors what the real bridge reports for tests/fixtures/test-card-front-back.cdr. */
export const FRONT_BACK: TemplateInspection = {
  pages: [
    { index: 1, name: '', widthMm: 90, heightMm: 50 },
    { index: 2, name: '', widthMm: 90, heightMm: 50 }
  ],
  objects: [
    obj('FullName', 1, 'Employee Name', { sizePt: 14 }),
    obj('JobTitle', 1, 'Job Title'),
    obj('Email', 1, 'name@example.com', { path: ['ContactGroup'] }),
    obj('Mobile', 1, '0900 000 0000', { path: ['ContactGroup'] }),
    obj('Telephone', 1, '(00) 0000 0000', { path: ['ContactGroup', 'PhoneGroup'] }),
    obj('Address', 1, 'Street address, City', { isParagraph: true }),
    obj('Tagline', 1, 'Bold Regular', { mixedFormatting: true }),
    obj('Company', 2, 'Company Name', { alignment: 3 })
  ],
  unnamedTextCount: 1,
  corelVersion: 'Mock 0.0'
}
