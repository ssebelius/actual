import { html2Plain, ofx2json } from './ofx2json';

describe('html2Plain', () => {
  test('regular text works', async () => {
    expect(html2Plain('Hello, world!')).toBe('Hello, world!');
    expect(html2Plain('Hello, <b>world</b>!')).toBe('Hello, <b>world</b>!');
  });

  test('brackets are unescaped', async () => {
    expect(html2Plain('Hello, &lt;world&gt;!')).toBe('Hello, <world>!');
  });
  test('apostrophes are unescaped', async () => {
    expect(html2Plain('Hello, &#39;world&#39;!')).toBe("Hello, 'world'!");
  });
  test('quotes are unescaped', async () => {
    expect(html2Plain('Hello, &quot;world&quot;!')).toBe('Hello, "world"!');
  });
  test('ampersands are unescaped', async () => {
    expect(html2Plain('Hello, &amp;world&amp;!')).toBe('Hello, &world&!');
    expect(html2Plain('Hello, &#038;world&#038;!')).toBe('Hello, &world&!');
  });
  test('no double unescaping with other entities', async () => {
    expect(html2Plain('Hello, &amp;#038;world&amp;#038;!')).toBe(
      'Hello, &#038;world&#038;!',
    );
    expect(html2Plain('Hello, &#038;amp;world&#038;amp;!')).toBe(
      'Hello, &amp;world&amp;!',
    );
    expect(html2Plain('Hello, &amp;quot;world&amp;quot;!')).toBe(
      'Hello, &quot;world&quot;!',
    );
  });
});

describe('ofx2json statements', () => {
  // Investment and bank message sets in one file. Two INVBANKTRAN entries,
  // because the merged path only handles a list of them.
  const investmentAndBank = `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX>
<SIGNONMSGSRSV1><SONRS><STATUS><CODE>0<SEVERITY>INFO</STATUS><FI><ORG>Brokerage<FID>777</FI></SONRS></SIGNONMSGSRSV1>
<BANKMSGSRSV1><STMTTRNRS><TRNUID>1<STMTRS><CURDEF>USD<BANKACCTFROM><BANKID>1<ACCTID>CHK1<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST><DTSTART>20260101<DTEND>20260131
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260105<TRNAMT>-10.00<FITID>B1<NAME>BANK ROW</STMTTRN>
</BANKTRANLIST><LEDGERBAL><BALAMT>100.00<DTASOF>20260131</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1>
<INVSTMTMSGSRSV1><INVSTMTTRNRS><TRNUID>2<INVSTMTRS><DTASOF>20260131<CURDEF>USD<INVACCTFROM><BROKERID>broker.example<ACCTID>INV9</INVACCTFROM>
<INVTRANLIST><DTSTART>20260101<DTEND>20260130
<INVBANKTRAN><STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260110<TRNAMT>25.00<FITID>I1<NAME>DIVIDEND</STMTTRN><SUBACCTFUND>CASH</INVBANKTRAN>
<INVBANKTRAN><STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260120<TRNAMT>-5.00<FITID>I2<NAME>FEE</STMTTRN><SUBACCTFUND>CASH</INVBANKTRAN>
</INVTRANLIST></INVSTMTRS></INVSTMTTRNRS></INVSTMTMSGSRSV1>
</OFX>
`;

  test('reads every message set; the merged list keeps investment over bank', async () => {
    const { transactions, statements } = await ofx2json(investmentAndBank);

    expect(transactions.map(t => t.fitId)).toEqual(['I1', 'I2']);
    expect(
      statements.map(({ transactions, ...rest }) => ({
        ...rest,
        fitIds: transactions.map(t => t.fitId),
      })),
    ).toEqual([
      {
        kind: 'bank',
        org: 'Brokerage',
        fid: '777',
        bankId: '1',
        accountId: 'CHK1',
        accountType: 'CHECKING',
        start: '2026-01-01',
        end: '2026-01-31',
        ledgerBalance: 100,
        ledgerDate: '2026-01-31',
        fitIds: ['B1'],
      },
      {
        kind: 'investment',
        org: 'Brokerage',
        fid: '777',
        bankId: null,
        accountId: 'INV9',
        accountType: null,
        start: '2026-01-01',
        end: '2026-01-30',
        ledgerBalance: null,
        ledgerDate: null,
        fitIds: ['I1', 'I2'],
      },
    ]);
  });
});
