import { describe, expect, it } from 'vitest';
import { parseMasterRows, type SheetRow } from '../../src/modules/master-data/master-import.js';

const sheet = (...rows: (string | undefined)[][]): SheetRow[] => rows.map((cells, i) => ({ row: i + 1, cells }));

describe('master-data import parsing', () => {
  it('matches template headers and common aliases, ignoring case and punctuation', () => {
    const r = parseMasterRows('parties', sheet(['CV Code', 'Farmer / Customer Name', 'Status'], ['cv-00123', ' Rahim Poultry ', 'inactive']));
    expect(r.errors).toEqual([]);
    expect(r.records).toEqual([{ row: 2, code: 'CV-00123', name: 'Rahim Poultry', status: 'INACTIVE' }]);
    const alias = parseMasterRows('parties', sheet(['cv no.', 'FARMER NAME'], ['00123', 'Karim Farm']));
    expect(alias.records[0]).toMatchObject({ code: '00123', name: 'Karim Farm' });
    expect(alias.records[0]!.status).toBeUndefined(); // keeps an existing record's status
  });

  it('skips blank rows and the header can start below empty rows', () => {
    const r = parseMasterRows('lines', sheet([], ['Line Code', 'Line Name'], ['', ''], ['L09', 'Line 9']));
    expect(r.totalRows).toBe(1); // blank rows are not counted
    expect(r.records).toEqual([{ row: 4, code: 'L09', name: 'Line 9' }]);
  });

  it('reports missing required columns', () => {
    const r = parseMasterRows('accounts', sheet(['Account Code', 'Account Name'], ['A1', 'Acc']));
    expect(r.records).toEqual([]);
    expect(r.errors[0]!.message).toContain('Bank Code');
  });

  it('validates every row and reports row + column', () => {
    const r = parseMasterRows(
      'sales-types',
      sheet(['Code', 'Name', 'Special', 'Status'], ['C1', 'Cash', 'yes', ''], ['bad code!', '', 'maybe', 'gone'], ['C1', 'Again', '', '']),
    );
    expect(r.records).toEqual([{ row: 2, code: 'C1', name: 'Cash', isSpecial: true }]);
    expect(r.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ row: 3, column: 'Sales Type Code' }),
        expect.objectContaining({ row: 3, column: 'Sales Type Name' }),
        expect.objectContaining({ row: 3, column: 'Special', message: 'Use Yes or No' }),
        expect.objectContaining({ row: 3, column: 'Status', message: 'Use Active or Inactive' }),
        expect.objectContaining({ row: 4, column: 'Sales Type Code', message: 'C1 appears more than once (first on row 2)' }),
      ]),
    );
  });

  it('empty files and header-only files are errors', () => {
    expect(parseMasterRows('banks', []).errors[0]!.message).toBe('The file is empty');
    expect(parseMasterRows('banks', sheet(['Bank Code', 'Bank Name'])).errors[0]!.message).toBe('No data rows below the header row');
  });
});
