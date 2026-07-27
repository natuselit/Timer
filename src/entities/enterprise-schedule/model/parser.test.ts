import { describe, expect, it } from 'vitest';
import { parseEnterpriseScheduleText } from './parser';

describe('parseEnterpriseScheduleText', () => {
  it('parses valid enterprise schedule blocks', () => {
    const result = parseEnterpriseScheduleText(`--01.06.2026--
In time: 05:57

Out time: 16:52

Total: 10:55

--02.06.2026--
In time: 06:30

Out time: 15:50

Total: 09:20`);

    expect(result.errors).toEqual([]);
    expect(result.items).toEqual([
      {
        date: '2026-06-01',
        shiftType: 'first',
        templateNameSnapshot: '1 зміна',
        plannedStartTime: '06:30',
        plannedEndTime: '14:30',
        inTime: '05:57',
        outTime: '16:52',
        total: '10:55',
        sourceText: '--01.06.2026--\nIn time: 05:57\nOut time: 16:52\nTotal: 10:55'
      },
      {
        date: '2026-06-02',
        shiftType: 'first',
        templateNameSnapshot: '1 зміна',
        plannedStartTime: '06:30',
        plannedEndTime: '14:30',
        inTime: '06:30',
        outTime: '15:50',
        total: '09:20',
        sourceText: '--02.06.2026--\nIn time: 06:30\nOut time: 15:50\nTotal: 09:20'
      }
    ]);
  });

  it('detects second shift by the closest planned start time', () => {
    const result = parseEnterpriseScheduleText(`--03.06.2026--
In time: 14:10
Out time: 22:45
Total: 08:35`);

    expect(result.errors).toEqual([]);
    expect(result.items[0]).toMatchObject({
      date: '2026-06-03',
      shiftType: 'second',
      plannedStartTime: '14:30',
      plannedEndTime: '22:30'
    });
  });

  it('parses the enterprise column format and skips empty days', () => {
    const result = parseEnterpriseScheduleText(`--01.06.2026--
In time: 05:57

Out time: 16:52

Total: 10:55

Колонка 4:

--02.06.2026--
In time: 06:30

Out time: 15:50

Total: 09:20

--07.06.2026--
In time:

Out time:

Total: :`);

    expect(result.errors).toEqual([]);
    expect(result.items).toHaveLength(2);
    expect(result.items.map((item) => item.date)).toEqual(['2026-06-01', '2026-06-02']);
  });

  it('parses inline dated rows and skips rows with dash placeholders', () => {
    const result = parseEnterpriseScheduleText(`01.07.2026 In time 06:01
01.07.2026 Out time 14:30
01.07.2026 Total 08:29
02.07.2026 In time -
02.07.2026 Out time -
02.07.2026 Total :
03.07.2026 In time 14:30
03.07.2026 Out time 22:32
03.07.2026 Total 08:02`);

    expect(result.errors).toEqual([]);
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toEqual({
      date: '2026-07-01',
      shiftType: 'first',
      templateNameSnapshot: '1 зміна',
      plannedStartTime: '06:30',
      plannedEndTime: '14:30',
      inTime: '06:01',
      outTime: '14:30',
      total: '08:29',
      sourceText:
        '01.07.2026 In time 06:01\n01.07.2026 Out time 14:30\n01.07.2026 Total 08:29'
    });
    expect(result.items[1]).toMatchObject({
      date: '2026-07-03',
      shiftType: 'second',
      inTime: '14:30',
      outTime: '22:32',
      total: '08:02'
    });
  });

  it('validates Total in the inline dated format', () => {
    const result = parseEnterpriseScheduleText(`01.07.2026 In time 06:01
01.07.2026 Out time 14:30
01.07.2026 Total 08:28`);

    expect(result.items).toEqual([]);
    expect(result.errors).toEqual([
      {
        line: 1,
        message: 'У блоці 2026-07-01 Total не збігається з In time та Out time.',
        sourceText:
          '01.07.2026 In time 06:01\n01.07.2026 Out time 14:30\n01.07.2026 Total 08:28'
      }
    ]);
  });

  it('skips days off with empty times and 00:00 total', () => {
    const result = parseEnterpriseScheduleText(`--01.05.2026--
In time:
Out time:
Total: :

--02.05.2026--
In time:
Out time:
Total: 00:00

--21.05.2026--
In time: 14:26
Out time: 19:26
Total: 05:00`);

    expect(result.errors).toEqual([]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      date: '2026-05-21',
      inTime: '14:26',
      outTime: '19:26',
      total: '05:00'
    });
  });

  it('rejects partially empty enterprise blocks', () => {
    const result = parseEnterpriseScheduleText(`--07.06.2026--
In time: 06:30
Out time:
Total: :`);

    expect(result.items).toEqual([]);
    expect(result.errors).toEqual([
      {
        line: 1,
        message: 'У блоці 2026-06-07 мають бути In time, Out time і Total.',
        sourceText: '--07.06.2026--\nIn time: 06:30\nOut time:\nTotal: :'
      }
    ]);
  });

  it('returns errors for lines outside a date block and malformed fields', () => {
    const result = parseEnterpriseScheduleText(`In time: 06:30
--04.06.2026--
In: 06:30
Out time: 14:30
Total: 08:00`);

    expect(result.items).toEqual([]);
    expect(result.errors).toEqual([
      {
        line: 1,
        message: 'Рядок має бути всередині блоку з датою --дд.мм.рррр--.',
        sourceText: 'In time: 06:30'
      },
      {
        line: 2,
        message: 'Некоректний рядок у блоці 2026-06-04: "In: 06:30".',
        sourceText: '--04.06.2026--\nIn: 06:30\nOut time: 14:30\nTotal: 08:00'
      }
    ]);
  });

  it('rejects blocks where total does not match in and out time', () => {
    const result = parseEnterpriseScheduleText(`--05.06.2026--
In time: 06:30
Out time: 14:30
Total: 07:59`);

    expect(result.items).toEqual([]);
    expect(result.errors).toEqual([
      {
        line: 1,
        message: 'У блоці 2026-06-05 Total не збігається з In time та Out time.',
        sourceText: '--05.06.2026--\nIn time: 06:30\nOut time: 14:30\nTotal: 07:59'
      }
    ]);
  });

  it('keeps the first valid date and reports duplicated dates', () => {
    const result = parseEnterpriseScheduleText(`--06.06.2026--
In time: 06:30
Out time: 14:30
Total: 08:00
--06.06.2026--
In time: 14:30
Out time: 22:30
Total: 08:00`);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      date: '2026-06-06',
      shiftType: 'first'
    });
    expect(result.errors).toEqual([
      {
        line: 5,
        message: 'Дата 2026-06-06 повторюється. Один день може мати лише один запис графіка.',
        sourceText: '--06.06.2026--\nIn time: 14:30\nOut time: 22:30\nTotal: 08:00'
      }
    ]);
  });
});
