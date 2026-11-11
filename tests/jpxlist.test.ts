import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
// @ts-expect-error JSモジュール
import { convert } from '../scripts/fetch-jpx-list.mjs';

describe('JPX上場銘柄一覧の変換', () => {
  it('xls（BIFF8）から コード・銘柄名・市場・業種 を取り出す', () => {
    const rows: (string | number)[][] = [['日付', 'コード', '銘柄名', '市場・商品区分', '33業種コード', '33業種区分', '17業種コード', '17業種区分', '規模コード', '規模区分']];
    for (let i = 0; i < 1200; i++) rows.push([20261031, 3000 + i, `テスト${i}`, 'スタンダード（内国株式）', 50, '水産・農林業', 1, '食品', 7, 'TOPIX Small 2']);
    rows.push([20261031, 8058, '三菱商事', 'プライム（内国株式）', 6050, '卸売業', 13, '商社・卸売', 1, 'TOPIX Core30']);
    rows.push([20261031, '130A', 'Veritas In Silico', 'グロース（内国株式）', 5250, '情報・通信業', 10, '情報通信', '-', '-']);
    rows.push([20261031, 1305, 'ｉＦｒｅｅＥＴＦ　ＴＯＰＩＸ', 'ETF・ETN', '-', '-', '-', '-', '-', '-']);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Sheet1');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'biff8' });
    const out = convert(buf);
    expect(out.asOf).toBe('2026-10-31');
    const find = (c: string) => out.data.find((r: string[]) => r[0] === c);
    expect(find('8058')).toEqual(['8058', '三菱商事', 'TSE_PRIME', 'プライム（内国株式）', '卸売業']);
    expect(find('130A')).toEqual(['130A', 'Veritas In Silico', 'TSE_GROWTH', 'グロース（内国株式）', '情報・通信業']);
    expect(find('1305')?.[2]).toBe('OTHER');
    expect(find('1305')?.[4]).toBe('');
  });
});
