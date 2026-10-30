/**
 * Static release schedule, Nov 2026 – Dec 2027, New York local time.
 *
 * Sources, read 2026-10-30:
 *   NFP (Employment Situation): https://www.bls.gov/schedule/news_release/empsit.htm
 *   CPI:                        https://www.bls.gov/schedule/news_release/cpi.htm
 *   PPI:                        https://www.bls.gov/schedule/news_release/ppi.htm
 *   FOMC:                       https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm
 *
 * FOMC entries are the final day of each meeting, with the statement at 14:00 ET.
 * The Fed marks every 2027 date tentative until the meeting before it confirms it.
 */
export type EventName = 'NFP' | 'CPI' | 'FOMC' | 'PPI';

export const STATIC_RELEASES: Record<EventName, { time: string; dates: string[] }> = {
  NFP: {
    time: '08:30',
    dates: [
      '2026-11-06', '2026-12-04', '2027-01-08', '2027-02-05', '2027-03-05', '2027-04-02', '2027-05-07',
      '2027-06-04', '2027-07-02', '2027-08-06', '2027-09-03', '2027-10-08', '2027-11-05', '2027-12-03',
    ],
  },
  CPI: {
    time: '08:30',
    dates: [
      '2026-11-10', '2026-12-10', '2027-01-13', '2027-02-11', '2027-03-10', '2027-04-13', '2027-05-12',
      '2027-06-10', '2027-07-14', '2027-08-11', '2027-09-14', '2027-10-14', '2027-11-10', '2027-12-10',
    ],
  },
  PPI: {
    time: '08:30',
    dates: [
      '2026-11-13', '2026-12-15', '2027-01-14', '2027-02-12', '2027-03-12', '2027-04-14', '2027-05-13',
      '2027-06-11', '2027-07-15', '2027-08-10', '2027-09-10', '2027-10-15', '2027-11-12', '2027-12-15',
    ],
  },
  FOMC: {
    time: '14:00',
    dates: [
      '2026-12-09', '2027-01-27', '2027-03-17', '2027-04-28', '2027-06-09', '2027-07-28', '2027-09-15',
      '2027-10-27', '2027-12-08',
    ],
  },
};

/** Last instant the static schedule covers. */
export const CALENDAR_COVERAGE_END = '2027-12-31T23:59:59Z';
