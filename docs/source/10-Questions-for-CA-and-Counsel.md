RADCORE TECHNICAL REVIEW
Open questions for the chartered accountant, counsel, the payroll adviser and the owner
Radboards Pvt Ltd
29 October 2026
Reviewed commit  194e288
Contents
RadCore (the Radboards ERP) is about to hold Radboards' real accounts, GST returns and salaries. The code reviewers could not settle the questions below from the code or from the public sources they could reach. Each one is written so a non-specialist can see what is being asked, why, and what changes in the software depending on the answer.
Built on 29 October 2026. Code reviewed: commit 194e2881dc1063ffc99b41b3c6d2e71a4ef392e2. Master register: master-register.md (RC ids). Companion: 08-Handover-Call-Pack.md (decision ids D-01 to D-22).
## How to read this file
Four groups, by who must answer.
| Group | Who | Questions | Numbers |
| A | Chartered accountant: GST, TDS, input credit, e-invoice, accounting, year-end, cut-over | 45 | CA-01 to CA-45 |
| B | Data-protection counsel: the Digital Personal Data Protection Act 2023 and Rules | 17 | DP-01 to DP-17 |
| C | Labour-law and payroll adviser: PF, ESIC, professional tax, labour welfare fund, salary tax (Form 16, 24Q), leave, gratuity, bonus | 15 | LB-01 to LB-15 |
| D | The owner's own policy decisions | 17 | OW-01 to OW-17 |

Total 94. Questions CA-01 to CA-37 are the thirty-seven questions the finance reviewer wrote at the end of the money and compliance report (section 11), kept in the same order and with the same content. CA-38 to CA-45 come from the other reports. DP and LB questions come from the security, people, AI, data-model, hosting and operations reports.
Each question has: its number; the question in plain words (every sub-question of the reviewer is kept); why it matters; what the code does today (file and line from the report); the register item (RC id); what the answer changes in the fix; and when the answer is needed.
"When needed": Week 1 means it gates a decision on the handover call or a Wave 1 fix (Wave 1 is the work before any real data goes in). Before Wave 2 means the fix is built before go-live and waits for it. Before Wave 3 means it can wait until the first three months after go-live.
Important flag for the answerer. Every statement of a rate, threshold, due date, section number or eligibility rule in this file is the reviewers' reading of public sources on 28 October 2026, mostly secondary sources such as commercial compliance sites and law-firm summaries. Many official texts were not retrievable. None of these readings is advice, and none should be relied on until you have answered. Where you disagree with a reading, please say so: the fix follows your answer.
Where a figure is quoted (for example "Rs 5 crore") it is the reviewers' reading, given so you can correct it.
# Part 0. Cover note for the CA, counsel and payroll adviser (one page, for the owner to send)
To: [name of chartered accountant / data-protection counsel / payroll adviser]From: [owner name], Radboards Pvt LtdDate: [date]
Subject: Questions we need answered before our new accounting system holds real data
Radboards is replacing Vyapar with a new system called RadCore, which will keep our books, GST records, TDS and salaries. Before it holds real data, an independent technical team read all of its code (about 43,000 lines) and found 222 things to fix. Some of them depend on rules of law and accounting that the technical team cannot settle. We recommended a professional sign-off from the start, and this is that request.
What we ask. Please read the attached list for your area and answer each numbered question in one of three ways: (1) the rule, with the section or notification it comes from; (2) "it depends on X" with how to decide; or (3) "I cannot say without Y". If a reading in the list is wrong, please say so; the software will follow your answer, not the reviewers' reading.
Your list.
- Chartered accountant: Group A, 45 questions (CA-01 to CA-45).
- Data-protection counsel: Group B, 17 questions (DP-01 to DP-17).
- Payroll or labour adviser: Group C, 15 questions (LB-01 to LB-15). Salary tax (LB-07) can be answered by whichever of the CA or the payroll adviser files the salary tax return; please tell us which.
What we need first. Every question marked "Week 1" in the list, within one week. The most important are: CA-01 (does e-invoicing apply, which depends on turnover), CA-03 (monthly or quarterly GST filing), CA-04 (credit on bills from unregistered suppliers), CA-11 (correcting an invoice after filing) and CA-37 (more than one GST registration). For counsel: DP-01 (when the duties start). For the payroll adviser: LB-01 to LB-05. The rest within [two to three weeks]; the list says for each question when the software work needs it.
Facts from us. We will send: aggregate turnover for each year since 2017-18; our GSTIN(s) and states; whether we file monthly or quarterly; the number of staff and the state they work in; our chart of accounts and the list of items with HSN and rate; a sample printed invoice and a sample GSTR-1 file from a test month (our developer will produce these).
What we do not ask. We are not asking you to file anything or to review the software's code. We ask for the rule, so the developer can build to it, and for a sign-off on a few specific outputs (the return mapping, the printed invoice, the opening-balance method).
Attachments.
- This list (the group for you).
- Owner's summary of the technical review (two pages).
- For the CA: the money and compliance report extracts: Appendix A (what each document writes to the books, the return mapping box by box, credit rules), Appendix B (what must come from Vyapar), Appendix C (the parallel-month report), Appendix D (e-invoice and e-way bill thresholds as the reviewer read them), Appendix E (invoice particulars against the printed invoice), Appendix F (checking the GSTR-1 file); the chart of accounts and TDS rate list from the setup data; a sample printed invoice and sample GSTR-1 file.
- For counsel: the data-protection gap table and build list (section 18 of the security report), the AI privacy section (section 6.5 of the AI report), and the consent, opt-out and retention findings. Send these as extracts only: the full security report contains technical weaknesses and must not leave the company.
- For the payroll adviser: the payroll findings on PF, ESIC, professional tax, salary tax, leave and exit, and the worked payroll example for October 2026 (Appendix A of the people report).
Contact. [owner], [phone], [email]. The developer, [name], can explain what the software does today.
Thank you.
For the owner before sending (not part of the note). Add the facts listed above. Do not attach the full area reports. If the CA also acts as payroll adviser, send one note with Groups A and C.
# Group A. Questions for the chartered accountant
Order: CA-01 to CA-37 are the finance reviewer's, in the reviewer's order. CA-38 to CA-45 are added from the other reports. File references are to the code root radcore-repo.
## A1. E-invoice, e-way bill, filing and supply (CA-01 to CA-11)
CA-01. Does e-invoicing apply to Radboards?
- Ask: What was Radboards' total yearly turnover (aggregate turnover) in each year since 2017-18? Is it above Rs 5 crore (e-invoicing, Notification 10/2023-Central Tax, effective 1 August 2023) or Rs 10 crore (the 30-day limit for reporting an invoice, GSTN advisory effective 1 April 2025)? One secondary source says a change comes on 1 April 2026: please confirm none applies.
- Why it matters: If it applies, an invoice without an IRN and QR may not be a valid tax invoice. The finance reviewer says the gap becomes Critical above Rs 5 crore.
- Code today: IRN, acknowledgement and e-way bill fields exist and can be set by an API call only (apps/api/src/modules/sales.ts:1393-1424). No screen, no QR or IRN on the printed invoice (apps/web/components/invoice.tsx), no portal link, and cancelling an invoice does not check for an IRN (sales.ts:872-883).
- RC: RC-170 (Wave 3, 12 days), RC-116 (Wave 2, 1.5 days). Reviewer's source ids FIN-01, Appendix D.
- Effect on the fix: Below the threshold: keep the 0.5-day cancel guard, park the 12-day portal build. Above: build the portal link through a GST Suvidha Provider, store IRN and signed QR, print them, block cancellation while an IRN is live (or call the cancel API within the allowed time), and add e-way bill generation. Pulls RC-170 from Wave 3 to before go-live (decision D-03).
- When needed: Week 1.
CA-02. Is an e-way bill needed in Radboards' cases?
- Ask: Is an e-way bill needed for a vehicle the customer rides away from the showroom, and for deliveries inside Radboards' own state? What is the value limit for intra-state movement in that state (Rs 50,000 or Rs 1 lakh, by state notification)? What validity rule applies now (Rule 138(10))?
- Why it matters: Decides whether delivery of goods must generate an e-way bill.
- Code today: E-way bill number and validity are fields on the invoice, set by hand (sales.ts:1405); delivery does not generate one (deliverOrder).
- RC: RC-170.
- Effect on the fix: Sets whether e-way bill generation is part of the RC-170 build, and adds a per-state value limit and validity as company settings.
- When needed: Before Wave 2 (design); depends on CA-01.
CA-03. Monthly filing or quarterly (QRMP)?
- Ask: Is Radboards on monthly return filing, or the quarterly scheme (QRMP) with the invoice furnishing facility?
- Why it matters: The filed-month lock, the "mark filed" screen and the GST pages assume monthly filing.
- Code today: apps/api/src/core/gst-lock.ts:15, apps/api/src/modules/gst.ts:289, apps/api/drizzle/0038_gst_filings.sql.
- RC: RC-012 (Wave 1, 2.75 days); reviewer source FIN-07.
- Effect on the fix: If quarterly, the lock and the snapshot taken at "mark filed" must work by quarter for GSTR-1 while GSTR-3B payments stay monthly. This changes the design of the new gst_filings snapshot.
- When needed: Week 1.
CA-04. Credit on bills from unregistered or composition suppliers.
- Ask: Confirm that no input credit may be taken on bills from unregistered suppliers or composition-scheme suppliers. Which purchases from unregistered suppliers still attract reverse charge now (Section 9(4))? Does Radboards buy from unregistered suppliers at all? (The trade reviewer asks this separately: if never, only the foreign-supplier half of the problem applies.)
- Why it matters: Today the software gives 18% credit on any bill: Rs 18,000 on a Rs 1 lakh bill from a supplier with no GSTIN (reproduced by test). That makes the return wrong.
- Code today: The supplier's GSTIN is never read: apps/api/src/modules/purchasing.ts:279-316, posting at purchasing.ts:392-408. Expenses do demand a GSTIN (apps/api/src/modules/accounting.ts:354).
- RC: RC-014 (Wave 1, 5 days), RC-057; sources FIN-02, FIN-03, TRD-04.
- Effect on the fix: Adds a registration type to every supplier (regular, composition, unregistered, overseas, SEZ, UIN) and forces credit to zero unless regular or SEZ. The reverse-charge cases you name become rows in the reverse-charge rule table (RC-057).
- When needed: Week 1.
CA-05. Blocked credit (Section 17(5)).
- Ask: Give the current Section 17(5) list and say how each Radboards cost falls: demo and test-ride vehicles, giveaways and free samples, parts supplied free under warranty, staff vehicles, food and travel, club or gym. Which expense categories should start as "credit allowed"?
- Why it matters: Today every expense with GST claims credit, with no blocked-credit check.
- Code today: apps/api/src/modules/accounting.ts:52-60 and 336-363; expense_categories has no eligibility column (apps/api/src/db/schema.ts:230-236); categories seeded at apps/api/src/db/seed.ts:108-112 (Travel and Conveyance, Office Expenses, Miscellaneous); all posted expenses with GST go to credit (apps/api/src/modules/gst.ts:57-60).
- RC: RC-058 (Wave 2, 3 days); sources FIN-04, FIN-25.
- Effect on the fix: Sets the default eligibility flag and the blocked reasons per category; a blocked category forces the GST into the expense, and a claim against it needs a typed reason.
- When needed: Before Wave 2.
CA-06. Reverse charge on services.
- Ask: For ad services from Meta or Google, other overseas services, goods transport agency services, legal services and sponsorship: what rate, is it paid in cash first, which GSTR-3B boxes, and when may the credit be claimed?
- Why it matters: There is no reverse charge anywhere, so Radboards would under-pay GST on these costs.
- Code today: apps/api/src/modules/purchasing.ts:56-62 (a comment says reverse charge "is not handled yet"); no 3B boxes 3.1(d), 4(A)(2), 4(A)(3) in gst.ts:40-92; bank-line expenses are created with no GST (apps/api/src/modules/bank.ts:284-292); ad spend is a CRM record with no journal (apps/api/src/modules/crm.ts:688).
- RC: RC-057 (Wave 2, 5 days); source FIN-05.
- Effect on the fix: Fills the reverse-charge rule table (which supplier types and service codes), the payable and credit accounts, and the 3B boxes; routes ad spend through it.
- When needed: Before Wave 2.
CA-07. Which kinds of supply does Radboards make?
- Ask: Does Radboards make nil-rated, exempt, export or SEZ supplies, or sell through an e-commerce operator (Amazon, Flipkart, Shopify marketplaces) where tax is collected at source?
- Why it matters: Decides whether GSTR-1 Tables 8, 6 and 14 are needed. Today they are missing, and 0% sales are filed in the wrong place.
- Code today: apps/api/src/modules/gst.ts:98-170; exports refused at apps/api/src/modules/sales.ts:119; sales channels include Amazon and Flipkart (packages/shared/src/constants.ts:98).
- RC: RC-107 (Wave 2, 4 days); source FIN-16.
- Effect on the fix: Builds only the tables that apply. Until built, a warning on the GST page names the missing tables.
- When needed: Before Wave 2.
CA-08. Place of supply.
- Ask: For a counter sale to a GST-registered buyer from another state who carries the goods away, is the supply intra-state or inter-state? For bill-to/ship-to sales, which state governs? For services (repair, labour), which?
- Why it matters: It decides CGST plus SGST against IGST on every invoice.
- Code today: apps/api/src/modules/sales.ts:118-120 and computeLine.
- RC: RC-111 (context; source FIN-14).
- Effect on the fix: Sets the place-of-supply rule used to pick the tax head at invoicing. A different rule changes the tax split on the affected invoices.
- When needed: Before Wave 2.
CA-09. Time of supply and advances.
- Ask: When is tax due on a vehicle booking advance (goods) and on a service advance? Is a receipt voucher required for either? Does delivering on one day and invoicing later create a late-invoice issue under Section 31?
- Why it matters: Today goods can be delivered before they are invoiced and advances carry no GST rule.
- Code today: apps/api/src/modules/sales.ts:542 (invoice date defaults to today, unbounded); delivery posts cost on its own date (sales.ts:410, 468); advances at apps/api/src/modules/payments.ts:48, 161, 186.
- RC: RC-111 (Wave 2, 5.5 days); source FIN-14.
- Effect on the fix: Sets the "invoice at delivery" rule and its warning, the receipt voucher with GST for advances (Table 11), and the date limits on invoices.
- When needed: Before Wave 2.
CA-10. Credit notes.
- Ask: Confirm the Section 34(2) deadline (30 November following the financial year, or the annual return if earlier), the condition about the tax not having been passed on, and how a time-barred credit note should be booked. Are discount-only credit and debit notes needed?
- Why it matters: Today a credit note can reduce output tax at any age, and a price discount cannot be a credit note at all.
- Code today: apps/api/src/modules/sales.ts:729-865 (createCreditNote; the only age check is date < inv.invoiceDate at line 741); lines must be returned quantities (sales.ts:765-796).
- RC: RC-110 (Wave 2, 3 days); source FIN-13.
- Effect on the fix: Adds the deadline date per invoice, owner approval after it, a separate account for the tax of a time-barred note, and a value-only credit or debit note with no stock movement.
- When needed: Before Wave 2.
CA-11. Correcting an invoice after the return is filed.
- Ask: For a wrong GSTIN or value found after GSTR-1 is filed: should it be amended (Table 9) or cancelled with a credit note? Is cancellation after filing ever allowed?
- Why it matters: The lock on filed months is the control the proposal promises; its rule depends on this answer.
- Code today: apps/api/src/core/gst-lock.ts; cancel at apps/api/src/modules/sales.ts:872-883. The lock checks only GSTR-1, so with GSTR-3B filed an old invoice can still be cancelled (reproduced).
- RC: RC-012 (Wave 1, 2.75 days); RC-107 (amendments); source FIN-07.
- Effect on the fix: Either the cancel route refuses any invoice in a filed month and points to the amendment or credit-note path, or an amendment flow is built (RC-107).
- When needed: Week 1.
## A2. Credit, returns and set-off (CA-12 to CA-17)
CA-12. Credit timing and conditions.
- Ask: Section 16(4) cut-off, the GSTR-2B matching condition (Section 16(2)(aa)), the 180-day payment rule (Rule 37), and apportionment for exempt supplies (Rules 42 and 43). Which of these must RadCore enforce, and which will the CA review monthly?
- Why it matters: Decides how much of the credit control is software and how much is a monthly checklist.
- Code today: None yet.
- RC: RC-058; source FIN-04.
- Effect on the fix: Either build 2B matching, the 180-day reversal and Rule 42/43 reports, or write a monthly CA checklist and leave them out.
- When needed: Before Wave 2.
CA-13. GSTR-3B boxes.
- Ask: Where do credit notes, purchase debit notes ("returns to suppliers") and credit reversals go? Please sign off Appendix A2 of the money report box by box.
- Why it matters: The screen shows two lines today; the filing needs every box.
- Code today: apps/api/src/modules/gst.ts:40-92; screen apps/web/app/(app)/gst/page.tsx:25-65.
- RC: RC-108 (Wave 2, 4 days); source FIN-15.
- Effect on the fix: Appendix A2 becomes the mapping used by the screen and by the saved snapshot of each filed month.
- When needed: Before Wave 2.
CA-14. Set-off and the credit ledger.
- Ask: Confirm the order of set-off between heads and cash, and the accounts to use for cash paid, interest, late fee and the opening credit.
- Why it matters: GST is never settled in the books today and nothing ties a return to the ledger.
- Code today: apps/api/src/modules/gst.ts:87-90; no GST payable or cash-ledger account in the chart (apps/api/src/db/seed.ts:27-90); the books-health check has no GST line (accounting.ts:254-272).
- RC: RC-109, RC-108 (Wave 2, 3 and 4 days); source FIN-17.
- Effect on the fix: Adds the accounts and a monthly "settle GST" posting from the filed snapshot, and a per-month check that the ledger matches the return.
- When needed: Before Wave 2.
CA-15. Imports of goods.
- Ask: Is credit taken on the bill of entry date and amount shown in GSTR-2B? How is the assessable value for IGST worked out (CIF plus landing charge, plus duty)? Is ocean freight under reverse charge for CIF imports? Is compensation cess possible on the goods Radboards imports?
- Why it matters: Radboards imports some goods; wrong IGST means wrong credit and wrong stock cost.
- Code today: apps/api/src/modules/imports.ts:100-119.
- RC: RC-106 (Wave 2, 3 days); source FIN-19.
- Effect on the fix: Sets the customs value formula, the bill-of-entry date rule and whether cess is handled.
- When needed: Before Wave 2.
CA-16. GST on customs agent, port and haulier charges.
- Ask: Confirm credit is allowed on GST charged by customs agents, ports and hauliers on imports, and that only the base amount is added to the cost of the goods.
- Why it matters: Today that GST is added to the cost of the goods instead of being claimed.
- Code today: apps/api/src/modules/imports.ts:112-116; test apps/api/test/imports.test.ts:84-95.
- RC: RC-106; source FIN-19.
- Effect on the fix: If allowed, the GST goes to the input accounts and only the base to cost; the screen shows the expected IGST beside the typed value.
- When needed: Before Wave 2.
CA-17. HSN digits and descriptions.
- Ask: Four or six digits of HSN for Radboards' turnover? Does the portal now fill the HSN description itself, so it may be left blank?
- Why it matters: The GSTR-1 file leaves the description blank and one of the likely portal rejections is here.
- Code today: HSN 4 to 8 digits (apps/api/src/modules/items.ts:60); blank description in the file (gst.ts:246).
- RC: RC-059, RC-113; sources FIN-06, FIN-24.
- Effect on the fix: Makes HSN digits a company setting and decides whether a small HSN description list is needed.
- When needed: Before Wave 2.
## A3. TDS (CA-18 to CA-23)
CA-18. TDS rate table for FY 2026-27.
- Ask: Under the Income-tax Act 2025 (reviewers' reading: in force from 1 April 2026), give the table item, rate, single-payment and yearly threshold, and return code for each payment type Radboards makes: contractors, professional and technical fees, rent of land or building and of machinery, commission, interest, purchase of goods if applicable, and partners.
- Why it matters: TDS is typed by hand with no thresholds today. The seeded rates carry only "Section 393(1); earlier 194C".
- Code today: apps/api/src/db/seed.ts:125-134; table tds_rates has only a name, a rate and a code (apps/api/drizzle/0019_tds.sql:19-31).
- RC: RC-060 (Wave 2, 8 days), RC-181 (Wave 3); sources FIN-08, FIN-20.
- Effect on the fix: Fills the new rate table (new and old section, single and yearly limits, rate with no PAN, effective-from date). The system then works out TDS itself.
- When needed: Before Wave 2.
CA-19. When is TDS deducted?
- Ask: Confirm deduction is due at the earlier of credit and payment, how it applies to GST shown separately on the bill, and what to do for advances paid to suppliers.
- Why it matters: The software deducts at payment time, typed by hand; the timing may be wrong.
- Code today: apps/api/src/modules/payments.ts:185-195; bill posting apps/api/src/modules/purchasing.ts:392-408.
- RC: RC-060; source FIN-08.
- Effect on the fix: Moves the deduction to bill booking, sets whether the GST is in the base, and handles advances.
- When needed: Before Wave 2.
CA-20. Rate when the payee has no PAN.
- Ask: The section and rate for a payee without a valid PAN, and for one with an inoperative PAN.
- Why it matters: There is no higher no-PAN rate in the software.
- Code today: apps/api/src/modules/payments.ts:140-155.
- RC: RC-060; source FIN-08.
- Effect on the fix: Adds the no-PAN rate column and its use.
- When needed: Before Wave 2.
CA-21. TDS rounding.
- Ask: Is TDS rounded to the nearest rupee (as the code does) under the new Act?
- Why it matters: A rounding difference on every deduction shows up on the certificate.
- Code today: packages/shared/src/tds.ts:20-22 (tdsOn).
- RC: RC-060; source FIN-08.
- Effect on the fix: Changes the rounding rule in one function if the answer is no.
- When needed: Before Wave 2.
CA-22. TDS returns and certificates.
- Ask: Deposit, return and certificate deadlines, interest rates and late fee under the new Act; the form names that replaced 26Q, 24Q, 16 and 16A; and which tool the CA files with.
- Why it matters: The software stops at the deposit: no quarterly return file, no certificates, no interest or late fee.
- Code today: apps/api/src/modules/tds.ts:26 and 70-98; apps/web/components/reports.tsx:281-298.
- RC: RC-181 (Wave 3, 3 days); source FIN-20.
- Effect on the fix: Sets the layout of the return export for your filing tool and the certificate data sheet. (Salary TDS is LB-07.)
- When needed: Before Wave 3.
CA-23. Tax collected at source.
- Ask: Does Section 206C(1F) (motor vehicles above Rs 10 lakh) apply to any Radboards product? How is tax collected by marketplaces (GST Section 52, income tax 194O) booked and claimed?
- Why it matters: There is no tax-collected-at-source handling in the software.
- Code today: None.
- RC: RC-107, RC-181; sources FIN-16, FIN-20.
- Effect on the fix: Decides whether a collected-tax field and ledger exist and how marketplace settlements are booked.
- When needed: Before Wave 2.
## A4. Cash, year-end and opening (CA-24 to CA-28)
CA-24. Cash limits.
- Ask: Confirm Sections 269ST and 40A(3) and their counterparts in the 2025 Act, and the amounts, so the warnings use the right limits.
- Why it matters: Receipts of Rs 2 lakh or more in a day and payments above Rs 10,000 in cash go through unmarked today.
- Code today: Cash is a payment mode (packages/shared/src/constants.ts:107); apps/api/src/modules/payments.ts:124-198; quick bill takes up to five payments of any mode (sales.ts:710-717).
- RC: RC-114 (Wave 2, 1.5 days); source FIN-22.
- Effect on the fix: The reviewer proposes a warning at Rs 1,90,000 and a refusal at Rs 2,00,000 without owner approval for receipts, and a warning above Rs 10,000 for payments. Your answer sets the numbers.
- When needed: Before Wave 2.
CA-25. Year-end.
- Ask: What must be posted before the system's year-end close (depreciation, provisions, income tax, interest, forex revaluation)? Is moving-average stock valuation acceptable for the audit? (The code's setting at settings.ts:34 leaves a FIFO choice to the CA.) Should the CA close each year?
- Why it matters: A closed year is locked; the software's close does not post any of these.
- Code today: apps/api/src/modules/accounting.ts:163-196; apps/api/src/core/settings.ts:34; the average counts rejected, job-work and demo stock (apps/api/src/core/stock.ts:47-52).
- RC: RC-039 (Wave 1), RC-205 (Wave 3); source FIN-12, ENG-18.
- Effect on the fix: Builds a year-end checklist into the close; decides whether a FIFO option is needed; sets who may reopen.
- When needed: Before Wave 2.
CA-26. Cut-over date.
- Ask: Switch mid-year or on 1 April? How should the year's profit and loss before the cut-over, the TDS and payroll totals so far, and the annual return (GSTR-9) be handled if RadCore holds only part of the year?
- Why it matters: Sets the date of every opening balance and what the first year's reports can show.
- Code today: apps/api/src/modules/opening.ts.
- RC: RC-038 (Wave 1, 2.5 days), RC-120 (Wave 2, 6 days); sources FIN-09, FIN-10.
- Effect on the fix: Sets the as-of date of the opening import and what is carried as an opening balance.
- When needed: Week 1 (the opening stock import, RC-038, is Wave 1).
CA-27. How does Vyapar value stock?
- Ask: On what basis does Vyapar value stock, and may RadCore's moving average replace it at cut-over without a valuation adjustment?
- Why it matters: The parallel month compares stock value; a different basis shows a false difference.
- Code today: apps/api/src/modules/opening.ts:281 and the compare screen (opening.ts:391-458).
- RC: RC-121, RC-119; sources FIN-11, FIN-23.
- Effect on the fix: Sets the opening stock value and the stock tie-out in the parallel-month report.
- When needed: Before Wave 2.
CA-28. Old invoices.
- Ask: Is it enough to carry customer balances, or must pre-cut-over invoices exist in RadCore so that credit notes under Section 34 can refer to them?
- Why it matters: Today unpaid invoices come in as one balance per customer, so an old invoice cannot be returned, credited or chased.
- Code today: apps/api/src/modules/sales.ts:735 (a credit note needs an issued RadCore invoice); apps/api/src/modules/opening.ts:208-229.
- RC: RC-120 (Wave 2, 6 days); source FIN-10.
- Effect on the fix: If invoices must exist, a fourth import for open invoices and bills is built (6 days), marked so they stay out of the current GSTR-1.
- When needed: Week 1 (decides the Vyapar import scope, D-16).
## A5. Warranty, job work, franchisee, currency, rounding, rates and print (CA-29 to CA-37)
CA-29. Warranty parts and demo units.
- Ask: Is a replacement part fitted free under warranty a supply, and does credit on it stay? Is a demo or test-ride vehicle stock, an asset, or a gift for credit purposes?
- Why it matters: The software has no rule for these today.
- Code today: apps/api/src/modules/service.ts:277.
- RC: RC-058; source FIN-04.
- Effect on the fix: Sets the expense category and credit flag for warranty parts and the accounting of demo units.
- When needed: Before Wave 2.
CA-30. Job work.
- Ask: The rules for challans, the one-year and three-year return periods for goods sent to a job worker, ITC-04, and whether Table 13 must list the challans.
- Why it matters: GSTR-1 Table 13 counts purchase debit notes and leaves out delivery challans.
- Code today: apps/api/src/modules/jobwork.ts; apps/api/src/modules/gst.ts:154-168, 254-259.
- RC: RC-059 (Wave 2, 3.5 days); source FIN-28.
- Effect on the fix: Adds challans to Table 13 and decides whether an ITC-04 report is built.
- When needed: Before Wave 2.
CA-31. Franchisee stock.
- Ask: Stock kept at a franchisee's store is "still ours" in RadCore. Is moving it a supply, a transfer on a delivery challan, or an invoice?
- Why it matters: Decides what document moves stock to a franchisee and whether tax is due.
- Code today: packages/shared/src/constants.ts:32-37.
- RC: None yet in the register. The answer may create an item.
- Effect on the fix: Sets the document used for franchisee stock moves.
- When needed: Before Wave 2.
CA-32. Foreign currency.
- Ask: Year-end revaluation of dollar payables and advances, and the treatment of exchange difference on advances.
- Why it matters: The software keeps only the rupee figure and has no revaluation.
- Code today: apps/api/src/modules/payments.ts:88-113.
- RC: RC-009 (Wave 1, 5.5 days; month-end revaluation is a follow-up); source DAT-02.
- Effect on the fix: Decides the revaluation posting and the accounts, if foreign currency stays in scope (D-10).
- When needed: Week 1 (scope), Before Wave 2 (revaluation).
CA-33. Invoice rounding.
- Ask: Is rounding the invoice total to the rupee with a round-off line acceptable, and how should the tax itself be rounded in the return?
- Why it matters: Nearly every real invoice has paise; the round-off ends up in a ledger account the CA reads. No current test produces a non-zero round-off invoice.
- Code today: packages/shared/src/gst.ts:135-145.
- RC: RC-069 (tests; Wave 2), related RC-008.
- Effect on the fix: Confirms or changes the rounding function and adds the tests with the CA's worked examples.
- When needed: Before Wave 2.
CA-34. Tax rates after 22 September 2025.
- Ask: Please verify the rate for every item and HSN in the master against the schedules in force on each date since 22 September 2025, including electric vehicles, batteries, chargers, boards and spares.
- Why it matters: No rate rows are loaded for that change, and a newer short-code rate can lose to an older long-code one.
- Code today: apps/api/src/core/taxrates.ts:17-20; apps/api/drizzle/0030_tax_rates.sql; no rate seed in seed.ts; packages/shared/src/gst.ts:31.
- RC: RC-115 (Wave 2, 0.5 day); source FIN-26.
- Effect on the fix: Loads the rate rows you confirm with their effective dates.
- When needed: Before Wave 2.
CA-35. Invoice particulars (Rule 46).
- Ask: Confirm the printed invoice (Appendix E) has all that is needed, including the state name and code for unregistered buyers of Rs 50,000 or more.
- Why it matters: The print omits the reverse-charge line and ship-to, and a dealer saved without a GSTIN is reported as a consumer.
- Code today: apps/web/components/invoice.tsx (126 lines); apps/api/src/modules/sales.ts:599; gst.ts:105.
- RC: RC-113 (Wave 2, 2 days); source FIN-24.
- Effect on the fix: Changes the print template and adds the buyer-detail rule. The developer will produce a printed sample for your sign-off.
- When needed: Before Wave 2.
CA-36. What if an invoice that needed an IRN has none?
- Ask: If an invoice that needed an IRN is issued without one, what are the consequences for Radboards and for the buyer, and how long may it be corrected?
- Why it matters: Decides how urgent the e-invoice build is and what the cancel guard must do.
- Code today: apps/api/src/modules/sales.ts:1397.
- RC: RC-170; source FIN-01.
- Effect on the fix: Sets how hard the software must block an invoice that needs an IRN.
- When needed: Week 1 (with CA-01).
CA-37. Several GST registrations.
- Ask: If Radboards ever has more than one registration (another state, a branch, a franchise), who files what, and how are transfers between them taxed?
- Why it matters: Decides the legal-entity approach (D-02).
- Code today: entities and gst_filings tables; filings, closes and numbers are single-entity in practice (earlier audit F-04).
- RC: RC-010 (Wave 1).
- Effect on the fix: If a second GSTIN is likely within a year, the multi-company work (8 to 25 days) is needed; if not, the form is switched off (0.75 day).
- When needed: Week 1.
## A6. Questions added from the other reports (CA-38 to CA-45)
CA-38. Shipping, bank charges and marketplace settlements.
- Ask: The GST treatment of shipping charges, GST on bank charges, and tax collected at source or tax deducted on marketplace (Amazon, Flipkart, Shopify) settlements.
- Why it matters: The integrations reviewer did not look at these and left them to the CA; they affect how marketplace orders and settlements are booked.
- Code today: Not reviewed (area-07-integrations.md, "Not reviewed" list). Related findings: Shopify order paid online becomes an unpaid invoice (RC-138), marketplace import (RC-065).
- RC: RC-107, RC-138, RC-065.
- Effect on the fix: Sets how settlements are booked and what tax fields the marketplace import needs.
- When needed: Before Wave 2.
CA-39. GST on cloud and software bills.
- Ask: How is GST treated on invoices from foreign and Indian cloud suppliers (AWS India charges 18% GST; other vendors may not; reverse charge may apply), and may it be claimed as credit? (Reviewers' working assumption: normally yes for a GST-registered business making taxable sales.)
- Why it matters: Part of the hosting decision (D-01) and how the bills are booked.
- Code today: None; this is a cost-booking question.
- RC: RC-015, RC-018 (hosting); source HST section 7.2 (A7, G1).
- Effect on the fix: No code change. Affects which accounts the owner books hosting to and the real net cost of each hosting option.
- When needed: Week 1.
CA-40. How long must records be kept?
- Ask: How long do GST law, company law, income tax and payroll law require records to be kept? (The proposal says about six years for GST; the operations reviewer notes that the Companies Act 2013 asks eight years for books of account.) Does it apply to backups and to the audit trail?
- Why it matters: Sets the backup retention and the data that erasure requests may not touch.
- Code today: Audit and event tables keep full copies forever (apps/api/src/core/audit.ts:11-25); backup retention is not set (deploy/backup.sh).
- RC: RC-011, RC-016; sources DAT-16, OPS appendix B.5.
- Effect on the fix: Sets the retention table (what must be kept, what may be erased) and the year-end dump retention.
- When needed: Week 1.
CA-41. Where must electronic books be kept?
- Ask: Is the PRD's promise that data stays in an Indian region also a legal duty for Radboards, for example under rules on keeping accounting books electronically? (The hosting reviewer believes company law has requirements about where electronic books and their backups are kept, but did not check.) Counsel's view on the data-protection side is DP-11.
- Why it matters: If it is a duty, the Singapore review copy can never hold real data and every backup must stay in India.
- Code today: The review copy is pinned to Singapore (apps/web/vercel.json:6); the backup bucket default is Mumbai (compose.prod.yml:120).
- RC: RC-018.
- Effect on the fix: Makes the residency guard a hard rule rather than a preference.
- When needed: Week 1.
CA-42. Is a provisional bill acceptable when the counter is offline?
- Ask: If the counter loses its connection, may it print a provisional bill ("tax invoice will follow") for B2C counter sales and issue the real invoice on reconnect, or must paper invoices from a numbered book be used? Or may reserved blocks of invoice numbers be handed to each counter (which breaks strict issue order)?
- Why it matters: Decides the offline design; GST expects the invoice at or before delivery of goods.
- Code today: No offline behaviour at all (apps/web/public/sw.js:1-5, apps/web/lib/api.ts:92); the invoice number is gap-free and issued by the server (apps/api/src/core/numbering.ts).
- RC: RC-149 (Wave 2), RC-190 (Wave 3); source WEB-12 and the offline design in the front-end report.
- Effect on the fix: Chooses design A (provisional bill) or B (reserved blocks), or no offline sales.
- When needed: Before Wave 3 (decision D-22).
CA-43. The Rs 50,000 buyer-details rule: taxable value or invoice value?
- Ask: Is the trigger for requiring buyer name and address on an unregistered buyer's invoice taxable value or invoice value? (A variant of CA-35 that the front-end reviewer flagged.)
- Why it matters: Sets the number the software checks.
- Code today: No check; nothing stops a large anonymous cash bill (apps/web/components/invoice.tsx, quick bill).
- RC: RC-113.
- Effect on the fix: Sets whether the check uses taxable or total value.
- When needed: Before Wave 2.
CA-44. Invoice number format.
- Ask: Which characters and what length are allowed in an invoice number? (The data-model reviewer used letters, digits, "/" and "-", from Rule 46 as understood.)
- Why it matters: Decides the numbering series format before real numbers are issued; changing it later is harder.
- Code today: apps/api/src/core/numbering.ts (gap-free, per type; line numbers not recorded by the reviewer).
- RC: RC-111 (numbering unique index).
- Effect on the fix: Confirms the format or changes the prefix rules before the first real invoice.
- When needed: Week 1.
CA-45. E-invoice unit-price decimals.
- Ask: How many decimal places does the e-invoice schema allow for a unit price?
- Why it matters: The software currently allows only 2 decimals for rates and costs, so a rate such as 0.375 cannot be stored; the right number of places must be fixed before real data goes in.
- Code today: Rates and unit costs limited to 2 decimals (apps/api/src/db/schema.ts:17; apps/api/src/lib/http.ts:41-53).
- RC: RC-008 (Wave 1, 3 days); source DAT-01.
- Effect on the fix: Sets how many decimals the price and cost columns are widened to.
- When needed: Week 1.
# Group B. Questions for data-protection counsel (Digital Personal Data Protection Act 2023 and Rules)
Legal caution from the reviewers. The security reviewer is not a lawyer and did not fetch the Act's text. Section numbers below are the reviewer's reading. The Rules were reported as notified in November 2025 (the AI reviewer cites 13 November 2025 and the notification G.S.R. 846(E) as the item to check), with notice and consent duties reported to begin about 13 May 2027 and the consent-manager rule about 13 November 2026, from law-firm summaries (SCC Online, Mondaq) that are commentary, not the Gazette. All of this needs counsel's confirmation. The point for go-live is that building the safeguards now is cheaper than retrofitting once real records exist.
Roles assumed by the reviewers. Radboards is the Data Fiduciary for its customers, leads, applicants and employees. Hosting, Meta (WhatsApp and lead forms), Cloudflare (captcha), Shopify, the alert channel and the file store are Data Processors or independent fiduciaries. See DP-02.
DP-01. When do the duties start for Radboards, and which Rules apply?
- Ask: From which date does each duty in the Act and the Rules bind a business of Radboards' size (notice, consent, security safeguards, breach intimation, erasure, rights of the person, children, cross-border transfer, consent managers)? Are the reported dates (about 13 May 2027 for most duties, 13 November 2026 for consent managers) right?
- Why it matters: Sets how urgent each build is, and what must exist before real personal data is collected.
- Code today: Not applicable (a date question). The consent fields are consent_at and consent_source on leads and parties (apps/api/src/db/schema.ts:267-269, 328-330).
- RC: RC-011, RC-032, RC-068 (Wave 1 and 2).
- Effect on the fix: Fixes the order of the privacy builds (notice, opt-out, erasure, breach register, rights screen) against the go-live date.
- When needed: Week 1.
DP-02. Roles: who is the fiduciary and who is a processor?
- Ask: Confirm Radboards is the Data Fiduciary for customers, leads and employees. For each of the hosting provider, Meta (WhatsApp and lead forms), Cloudflare, Shopify, the alert channel, the error tracker, the mailbox for bank statements, the file store and any AI provider: is it a processor, an independent fiduciary, or something else?
- Why it matters: Decides which suppliers need a contract and which duties Radboards keeps.
- Code today: No list or contracts anywhere; the reviewer proposes a data map and processor register (build item B7, a document, no code).
- RC: None as a code item; RC-018 (register of data flows), RC-195.
- Effect on the fix: Produces the processor register and the data map document in the repo.
- When needed: Before Wave 2.
DP-03. Notice wording and placement.
- Ask: What must the privacy notice say, where must it appear (public enquiry form, walk-in form, staff forms, invoices), and in what languages, to meet Section 5 as read by the reviewer?
- Why it matters: The public form has no notice at all today.
- Code today: apps/web/app/enquiry/[token]/page.tsx:55-71 (no notice); staff tick-box "they agreed" at apps/web/app/(app)/leads/page.tsx:56.
- RC: RC-032 (Wave 1, 4 days); sources SCB-10, PPL-24, WEB-27.
- Effect on the fix: Adds a versioned notice block and stores the version shown with each consent.
- When needed: Week 1.
DP-04. What counts as valid consent for follow-up?
- Ask: Is a person's own enquiry through the form consent for follow-up calls and WhatsApp messages? Is a staff member's tick-box "told our staff" acceptable? Must the phone number be verified (one-time code) before marketing use? What of leads imported from a list with no consent?
- Why it matters: Today a stranger can post any number to a public form and the system records that number as consenting; an inbound message counts as consent for the whole relationship; imported leads with no consent still go on the follow-up plan.
- Code today: apps/api/src/modules/leads.ts:111-133, 120, 160-161, 169, 678-700; apps/api/src/modules/crm.ts:85-100, 493-510; import apps/api/src/modules/lead-tools.ts:59-99.
- RC: RC-032 (Wave 1), RC-068; sources PPL-24, SCB-10, INT-13.
- Effect on the fix: Sets whether web-form consent stays "unverified" until a reply or one-time code, and whether imports are excluded from plans and bulk messages (the reviewer's default).
- When needed: Week 1.
DP-05. Withdrawal of consent and "STOP".
- Ask: What counts as withdrawal (a WhatsApp "STOP", "unsubscribe", Hinglish variants, a phone call), how fast must it be acted on, and must every outbound path check it?
- Why it matters: Today a WhatsApp "STOP" from an unknown number creates a lead recorded as consenting; from a known lead it makes the lead due now for staff to contact; there is no opt-out field.
- Code today: apps/api/src/modules/crm.ts:159-184 (inbound handler), 563-601 (manual send checks nothing), 742-769 (one-tap contact); leads.ts:116-127.
- RC: RC-068 (Wave 2, 2 days); sources PPL-09, INT-13.
- Effect on the fix: Adds an opted-out date and source on leads and parties, one "may we contact this person" check on every send, and the keyword list.
- When needed: Before Wave 2.
DP-06. Proof of consent.
- Ask: What evidence must be kept to prove consent (notice version, purpose, language, time, channel, the message or form id)? The reviewer reads Section 6(10) as putting the burden of proof on the fiduciary.
- Why it matters: The current record is a free-text field anyone can write.
- Code today: Same fields as DP-04; the evidence is forgeable (leads.ts:694-699, crm.ts:502-508).
- RC: RC-032.
- Effect on the fix: Designs a consents table (subject, purpose, notice version, given at, channel, evidence, withdrawn at).
- When needed: Week 1.
DP-07. Legitimate uses and purposes per data set.
- Ask: For employee payroll data, tax invoices and bank details: which are covered as legitimate uses (employment, legal obligation, Section 7 as read) and which need consent? What purpose should be recorded for each data set (the reviewer proposes a data map in the repo)?
- Why it matters: The system processes employee and customer data with no documented purposes.
- Code today: No purpose fields; lead data feeds scoring, plans and reminders. Salaries and bank accounts in plain text (apps/api/src/db/schema.ts:1415).
- RC: RC-011, RC-043 (Wave 1).
- Effect on the fix: Sets the purpose list and which fields are encrypted, masked or logged on access.
- When needed: Before Wave 2.
DP-08. Employee location and pay data.
- Ask: Self clock-in stores the phone's latitude and longitude with every attendance record. What notice, purpose and retention apply to employee location? Who may see salaries and bank account numbers?
- Why it matters: Location is stored in the attendance table with no notice; salary and bank numbers are visible to every holder of the payroll and HR read permissions.
- Code today: apps/api/src/modules/hr-self.ts:23-25, 34-37, 40-61; table attendance (schema.ts:1505-1510); salary lists apps/api/src/modules/payroll.ts:258-265, hr.ts:790-818.
- RC: RC-178 (Wave 3), RC-043 (Wave 1), RC-011.
- Effect on the fix: Sets whether location is kept at all, for how long, and the wording of the staff notice.
- When needed: Before Wave 2.
DP-09. Erasure and retention, and the logs that keep copies.
- Ask: When a person asks for erasure, or the purpose is served, what must be erased and what must be kept by law (GST and company records: CA-40)? The audit log and event tables keep full copies of personal data and cannot be edited. How should those copies be handled (anonymise, scrub, or keep for a stated legal reason)? What retention periods for lost leads, rejected applicants, stored webhook payloads and held mail attachments?
- Why it matters: There is no erase route anywhere, so a deletion request cannot be honoured, and old leads and applicants are kept for ever.
- Code today: The audit call stores whole rows including phone and email (apps/api/src/core/audit.ts:11-25, apps/api/src/modules/leads.ts:168, parties.ts:81, 181); the audit table refuses UPDATE and DELETE (apps/api/drizzle/0001_rules_and_views.sql:20); raw webhook payloads kept (schema.ts:1227-1247, crm.ts:415-418, 455, 483); housekeeping clears only save keys and the error log (apps/api/src/core/jobs.ts:46-49).
- RC: RC-011 (Wave 1, 6 days); sources SCB-05, DAT-16, PPL-26, INT-19.
- Effect on the fix: Sets the audit allow-list (ids and field names only), the scrub for old rows, the anonymise functions, and the retention jobs with your periods.
- When needed: Week 1.
DP-10. Rights requests.
- Ask: What must Radboards provide for access (a summary of data and sharing), correction, erasure, grievance and nomination (Sections 11 to 14 as read), within what time, and what contact must be published (Section 8(9) and 8(10) as read)?
- Why it matters: Today staff can edit records; there is no access export, request register or published contact.
- Code today: None.
- RC: RC-011 (build item B5 in the security report: a privacy-requests screen, a per-person export, a published contact).
- Effect on the fix: Builds the register, the export and the contact block with your deadlines.
- When needed: Before Wave 2.
DP-11. Cross-border transfer and the India-region promise.
- Ask: Which transfers out of India are lawful (reviewer's understanding: allowed except to countries the Government restricts, none notified to date per commentary; Section 16 and Rule 15 reported to start about 13 May 2027)? Specifically: the captcha (Cloudflare Turnstile), a Gmail mailbox for bank statements, the alert channel (Slack, Google Chat, Discord, ntfy.sh), an error tracker, WhatsApp and Meta, Shopify, and any AI provider. Is the PRD's "data stays in an Indian region" also a legal duty? (CA-41 asks the accounting-law side.)
- Why it matters: The only running copy is in Singapore and even a Mumbai deployment sends some data out.
- Code today: apps/web/vercel.json:6 (Singapore); captcha apps/api/src/config.ts:116-117; example mailbox host .env.production.example:60; alert webhook apps/api/src/core/alerts.ts:30.
- RC: RC-018 (Wave 1, 1.25 days), RC-007, RC-083; sources OPS-10, HST-01.
- Effect on the fix: Sets which flows are replaced (Indian mailbox, self-hosted error tracker) and which are kept and recorded as exceptions (decision D-17).
- When needed: Week 1.
DP-12. Processors: contracts and their content.
- Ask: What must a processor contract contain (Section 8(2) as read), and which suppliers need one (hosting, Meta, Cloudflare, Shopify, the file store, the alert channel, the AI provider)? For AI: region, no training on inputs, retention (zero or 30 days, in writing), sub-processors, breach notice time, deletion on exit.
- Why it matters: None is on file.
- Code today: None; the AI report notes the provider contract is "Not started (organisational)".
- RC: RC-195 (Wave 3), RC-018.
- Effect on the fix: Provides the checklist for supplier agreements; the AI provider contract gates Phase 2 of the AI plan (D-04).
- When needed: Before Wave 2 (hosting and mail); before the AI phase (provider).
DP-13. Breach notification.
- Ask: What triggers the duty to tell the Board and each affected person (Section 8(6) as read), by when, with what content, and who decides? Is a copy of customer details in an alert channel or error log a reportable event if real data were in it? (No real data is believed to be in it yet: the owner will confirm.)
- Why it matters: There is no runbook, register or contact list, so a "without delay" duty cannot be met.
- Code today: None; failed-query errors copy names, phone, PAN, bank details and link tokens into the error log and the alert channel (apps/api/src/app.ts:123-128, core/alerts.ts:44-57). The "who looked" log covers two screens (apps/api/src/core/access.ts:8-10).
- RC: RC-007, RC-040, RC-050 (runbook); sources SCB-04, SCB-14, OPS-11.
- Effect on the fix: Builds an incidents register, a one-page breach runbook with templates, and an alert when one user opens many records.
- When needed: Before Wave 2.
DP-14. What "reasonable security safeguards" must include.
- Ask: What standard does Section 8(5) as read expect for a business of this size? Does the list in the security report (no personal data in logs, security headers, upload limits, access logging, tokens hashed, encrypted backups, second factor) meet it? Please also confirm the reviewer's reading of the penalty schedule (up to Rs 250 crore for failing to keep safeguards; up to Rs 200 crore for failing to notify a breach or meet the children's duties), which was not checked against the text.
- Why it matters: Sets the standard against which the security fixes are judged.
- Code today: Strengths: bcrypt, TLS, least-privilege database login, masking, access log on two screens. Gaps: personal data in logs and alerts (app.ts:123-128), no browser security headers (apps/web/next.config.mjs:13-28), uploads unscanned and unlimited (apps/api/src/modules/files.ts:27-37), plain-text link tokens (schema.ts:1523, 1273, 1598).
- RC: RC-007, RC-146, RC-096, RC-040, RC-047.
- Effect on the fix: Confirms the scope and order of the privacy hardening items.
- When needed: Before Wave 2.
DP-15. Children.
- Ask: What does Section 9 as read require of a business that takes enquiries from the public: an age question, a parent's consent, no tracking or targeted marketing of minors? Can employees under 18 be hired?
- Why it matters: There is no age question anywhere; a minor's enquiry is handled like any other.
- Code today: None.
- RC: None as an item (build item B6 in the security report, about 0.5 day).
- Effect on the fix: Adds an "I am 18 or older" answer, a minor flag that blocks plans and scoring, and a hiring check.
- When needed: Before Wave 2.
DP-16. AI processing: legal basis, notice and images.
- Ask: What notice wording and legal basis apply when staff-facing AI features process (a) supplier bills (business data, with some sole-proprietors and bank details) and (b) consumer enquiries? Is it enough to update the privacy notice? What of images that cannot be redacted (scanned or photographed bills, technician photos)? Is GSTIN to be treated as public data?
- Why it matters: The consent log that an AI feature would rely on can be forged today, and no basis or notice for AI processing is recorded.
- Code today: Consent fields on leads and parties only (schema.ts:312-340); every inbound enquiry stamped as consented (crm.ts:97). No AI code exists.
- RC: RC-195 (Wave 3, 1 day, "To confirm").
- Effect on the fix: Sets the privacy notice line, what the redactor must remove, and whether image features are allowed.
- When needed: Before the AI phase (D-04).
DP-17. Is Radboards a Significant Data Fiduciary?
- Ask: Confirm that the extra duties of Section 10 as read do not apply at this scale.
- Why it matters: The reviewer thinks it unlikely; a wrong assumption would add duties (audit, officer, impact assessment).
- Code today: Not applicable.
- RC: None.
- Effect on the fix: None if confirmed.
- When needed: Before Wave 3.
# Group C. Questions for the labour-law and payroll adviser
Caution from the people reviewer. All rates, ceilings and rules below were read from public web pages on 28 October 2026, mostly advisory blogs and news pages, not Gazette texts. The reviewer could not confirm: the ESIC ceiling and rates, the Maharashtra professional tax slabs as official, the rebate under Section 87A in the new Income-tax Act, the effect of the Labour Codes on the PF wage, minimum wages, labour welfare fund rates, and whether bonus and gratuity apply to a business of Radboards' headcount. Everything is "needs confirmation". The payroll module is also exact-arithmetic and balanced; the question is whether the rules it uses are right.
LB-01. Provident fund ceiling and rates.
- Ask: What is the PF wage ceiling in force today and on the go-live date? (The code has Rs 15,000. Reviewer's sources: EPS cap Rs 1,250 a month; employer 12% = 8.33% to the pension scheme plus 3.67% to the fund; administration charge 0.5% and EDLI 0.5%. Some pages report a ceiling rise to Rs 21,000 or Rs 25,000, one saying Rs 25,000 from 17 September 2026, unconfirmed.)
- Why it matters: PF is statutory for both employee and employer; under-payment brings interest and damages.
- Code today: PAYROLL_RULES_DEFAULT and the PF calculation in packages/shared/src/payroll.ts:21-23, 50-57; the rules screen apps/api/src/modules/payroll.ts:290-307 (any user with payroll manage can edit the rates, with retroactive effect).
- RC: RC-104 (Wave 2, 7 days); source PPL-08.
- Effect on the fix: Sets the default ceiling and rates in an effective-dated rules table, and the employer extras (administration charge, EDLI) booked as cost.
- When needed: Week 1.
LB-02. What is "wages" for PF, and is "basic = 50% of gross" safe?
- Ask: Under the Labour Codes (reported in force from 21 November 2025, with a wage definition that caps excluded allowances at 50% of total pay) and the EPF Act, on which pay components must PF be worked for a given salary structure (basic, DA, HRA, special allowance)? Who must be enrolled?
- Why it matters: The code invents "Basic = 50% of gross" for everyone. A person whose letter says basic Rs 12,000 of Rs 18,000 has PF worked on Rs 9,000, not on actual basic. PF and ESIC also default to off for every new employee.
- Code today: packages/shared/src/payroll.ts:21-23, 50-57; apps/api/src/db/schema.ts:1411-1412 (flags default off).
- RC: RC-104; source PPL-08.
- Effect on the fix: Adds a per-person salary structure by component, effective-dated, and makes PF and ESIC enrolment an explicit choice at hiring.
- When needed: Week 1.
LB-03. ESIC ceiling, rates and the contribution-period rule.
- Ask: Confirm the ESIC coverage ceiling (the code has Rs 21,000 gross) and rates (0.75% employee, 3.25% employer, as in the code; unverified). Confirm that a person who crosses the ceiling mid-period stays covered to the end of the contribution period (April to September, October to March).
- Why it matters: Today ESIC stops the month a raise crosses the ceiling (a raise from Rs 20,000 to Rs 22,000 in August stops it that month).
- Code today: const covered = input.esic && salary.lte(rules.esic_gross_limit) in packages/shared/src/payroll.ts (around line 50-57).
- RC: RC-104; source PPL-08.
- Effect on the fix: Adds the contribution-period logic and the verified rates.
- When needed: Week 1.
LB-04. PF and ESIC returns and identifiers.
- Ask: What must Radboards file (the PF electronic challan-cum-return, the ESIC contribution return), by when, with what per-person identifiers (UAN, ESIC IP number)?
- Why it matters: The software stores neither identifier, so no PF or ESIC file can be produced from the screen.
- Code today: No UAN or ESIC number columns (schema.ts:1411-1412 flags only).
- RC: RC-104.
- Effect on the fix: Adds the identifier fields and, if you want, the return file layouts.
- When needed: Week 1.
LB-05. Professional tax.
- Ask: In which state do Radboards' staff work? What are the slab, the February amount, the gender rule, the return frequency and the due date? (Reviewer's sources for Maharashtra: nil up to Rs 7,500; Rs 175 for Rs 7,501 to 10,000; Rs 200 above; Rs 300 in February; women exempt up to Rs 25,000 though one source disagrees; a notification of 28 February 2026 reported to advance the due date to the 15th. None is an official text.)
- Why it matters: Professional tax is a flat number someone types per person; it ignores the state, the month and what was actually earned. A joiner earning Rs 966.67 in a month is charged Rs 200.
- Code today: packages/shared/src/payroll.ts:58-59; apps/api/src/db/schema.ts:1413; apps/web/components/payroll.tsx:109.
- RC: RC-102 (Wave 2, 3.5 days); source PPL-11.
- Effect on the fix: Builds a slab table by state and month, computed on earned gross, with a due-date reminder.
- When needed: Week 1.
LB-06. Labour welfare fund.
- Ask: Does a labour welfare fund apply in Radboards' state? Rates for employee and employer, frequency, due date.
- Why it matters: There is no labour welfare fund handling and no reminder.
- Code today: None.
- RC: RC-102; source PPL-11.
- Effect on the fix: Adds a rules table for it (about one more day).
- When needed: Before Wave 2.
LB-07. Salary tax (TDS on salary), Form 16 and Form 24Q.
- Ask: Under the Income-tax Act 2025 (reported in force from 1 April 2026), which section governs salary TDS (sources differ: 392, 393 or 192 still), what are the slabs, the standard deduction and the rebate threshold for each regime, what is the return form name that replaced 24Q and the certificate that replaced Form 16, and how is the annual tax rounded (the reviewer says the annual tax is rounded to the nearest ten rupees under Section 288B)? Reviewer's reading of the new regime: nil to Rs 4 lakh, 5% to 8, 10% to 12, 15% to 16, 20% to 20; standard deduction Rs 75,000; the rebate threshold (Rs 12 lakh) not confirmed under the new Act. Who files it, the CA or the payroll adviser?
- Why it matters: Salary TDS is a flat monthly number typed once; no PAN, regime, declarations or return data are stored. An employer who under-deducts is liable for the tax, interest and penalty.
- Code today: packages/shared/src/payroll.ts:59-60; apps/api/src/db/schema.ts:1414; typed at apps/api/src/modules/payroll.ts:270; label apps/web/components/payroll.tsx:110.
- RC: RC-169 (Wave 3, 17.5 days, reviewer's estimate); source PPL-05. Decision D-13 (build or buy).
- Effect on the fix: If a payroll product is bought, RadCore keeps attendance-to-pay and posts the journal. If built: annual projection, regime, declarations, previous-employer income and the return data, with your slab table each year.
- When needed: Week 1 (to settle D-13).
LB-08. Leave: types, accrual, carry forward, encashment.
- Ask: What leave types and entitlements must Radboards give under the state shops-and-establishments rules (casual, sick, earned), how does leave accrue, what carries forward, what is encashed on exit, and can half-days be allowed?
- Why it matters: The module is a single flat allowance (12 days a year, given on 1 April). There is no check when leave is asked for, a leaver gets the full year's allowance, and HR cannot withdraw approved leave. Leave beyond the allowance is turned into unpaid leave in payroll (the proposal's complaint, now fixed).
- Code today: apps/api/src/modules/hr-self.ts:82-101, 104-131, 183-194; packages/shared/src/util.ts:132-137; apps/api/src/modules/hr.ts:976-994; payroll.ts:114-117.
- RC: RC-179 (Wave 3, 7 days); source PPL-20.
- Effect on the fix: Builds a leave-type table and a leave ledger with accrual, balance warning, carry-forward and encashment settings.
- When needed: Before Wave 3 (a policy view is wanted in Week 2).
LB-09. Weekly offs and public holidays.
- Ask: Is a weekly off paid when the person was absent on every working day of the week or month? Which public holidays apply in the state, and how do they interact with leave?
- Why it matters: Today a person marked absent on all 27 working days of a 31-day month is paid 4 days for the Sundays (Rs 3,870.97 on Rs 30,000), and holidays have no calendar.
- Code today: apps/api/src/modules/payroll.ts:106-110, 117.
- RC: RC-101 (Wave 2, 2.5 days); source PPL-19.
- Effect on the fix: Sets the company setting for weekly-off pay (always, if worked an adjacent day, if worked in the week) and the yearly holiday table.
- When needed: Before Wave 2.
LB-10. Overtime.
- Ask: Does overtime apply to Radboards' staff, at what rate (reported twice the ordinary rate under the Labour Codes), and on what hours?
- Why it matters: Attendance records hours but payroll never pays overtime.
- Code today: Hours computed for display only (apps/api/src/modules/hr.ts:958).
- RC: RC-103 (Wave 2, 0.5 day for the warning banner); source PPL-22.
- Effect on the fix: If it applies, adds an overtime earning type with a statutory flag; otherwise a banner stays.
- When needed: Before Wave 2.
LB-11. Statutory bonus.
- Ask: Does the bonus law apply to Radboards (reviewer's reading: 20 or more employees, with a wage ceiling for the calculation)? If so, the calculation and payment date.
- Why it matters: Not modelled; bonuses can only be typed as an addition on a payslip.
- Code today: Absent from apps/api/src/modules/payroll.ts and packages/shared/src/payroll.ts.
- RC: RC-103; source PPL-22.
- Effect on the fix: Adds a bonus earning type with its rule, if it applies.
- When needed: Before Wave 2.
LB-12. Gratuity.
- Ask: Does gratuity apply (reviewer's reading: 10 or more employees, five years' service, a tax-free cap; for fixed-term staff after one year under the Labour Codes)? How is it accrued and paid?
- Why it matters: Not modelled; leaving the company has no final settlement.
- Code today: Absent; exit records the date only (apps/api/src/modules/hr.ts:877-898).
- RC: RC-103, RC-180 (Wave 3, 3.5 days); sources PPL-22, PPL-21.
- Effect on the fix: Adds the gratuity accrual and the exit settlement statement, if it applies.
- When needed: Before Wave 3.
LB-13. Minimum wages.
- Ask: What minimum wage applies to each role in the state, and must payroll check against it?
- Why it matters: Nothing checks wages against a minimum.
- Code today: None.
- RC: RC-103; source PPL-22.
- Effect on the fix: Adds a minimum-wage table and a warning on the payslip run.
- When needed: Before Wave 2.
LB-14. Final settlement when someone leaves.
- Ask: What must the last pay include and what may be recovered: leave encashment, notice-period recovery, outstanding advances, bonus, gratuity? What limits apply to deducting advances from the last salary?
- Why it matters: An outstanding advance is stranded after the last month (Rs 20,000 outstanding, exit returns success without a word); the sign-in stays active.
- Code today: apps/api/src/modules/hr.ts:877-898; payroll.ts:40-49, 82-85; the test accepts the sign-in staying active (apps/api/test/hr.test.ts:331).
- RC: RC-180 (Wave 3); source PPL-21.
- Effect on the fix: Builds the exit screen (open advances, leave balance, pending month, switch off sign-in) with your recovery rules.
- When needed: Before Wave 3.
LB-15. How long must payroll and employee records be kept?
- Ask: The legal retention period for payroll, attendance, leave and employee records, and for rejected applicants' data.
- Why it matters: Sets the retention table that erasure respects (also asked of the CA: CA-40, and counsel: DP-09).
- Code today: No retention for leads, applicants or employees (apps/api/src/modules/leads.ts:168; hr.ts:107-110, 166).
- RC: RC-011; source PPL-26.
- Effect on the fix: Fills the retention table and the anonymise-after-N-months job for applicants.
- When needed: Week 1.
# Group D. The owner's own policy decisions
These are not legal questions; they are choices only the owner can make. Each links to the decision table in 08-Handover-Call-Pack.md, where the options, the recommended default and the consequence of not deciding are set out. Decisions that are engagements or already covered elsewhere are in the handover pack only: D-03 (answered through CA-01), D-05 (pace), D-07 (budget), D-08 and D-09 (engage the advisers), D-23 (accept the review branch).
OW-01. Where should RadCore run? (D-01)
- Ask: Which of the four hosting options? The reviewer recommends the Mumbai hybrid (one server, a managed database, file storage and backups in India).
- Why it matters: Decides cost, speed, recovery and whether data stays in India.
- Code today: The only running copy is pinned to Singapore (apps/web/vercel.json:6); the production design is a single server with Compose (compose.prod.yml).
- RC: RC-015, RC-016, RC-018.
- Effect on the fix: Fixes the backup and recovery route and the setup work.
- When needed: Week 1.
OW-02. One company or several? (D-02)
- Ask: Is a second legal entity or GST registration likely within a year?
- Why it matters: Multi-company is half built; an admin can create a second company from the Admin screen today.
- Code today: apps/api/src/modules/admin.ts:433-446; apps/web/app/(app)/admin/page.tsx:82-89.
- RC: RC-010.
- Effect on the fix: Switch the form off (0.75 day) or build it properly (8 to 25 days).
- When needed: Week 1.
OW-03. Which AI features, with which provider, in which region? (D-04)
- Ask: Whether to build bill reading, plain-English questions, a technician assistant and unusual-activity alerts, and with which provider.
- Why it matters: Each needs foundations first and a processor contract (DP-12).
- Code today: No AI code exists.
- RC: RC-195, RC-171, RC-172, RC-173, RC-042.
- Effect on the fix: Orders the AI phases; rules-based alerts first.
- When needed: Week 1.
OW-04. Who is the second approver? (D-06)
- Ask: Who approves payroll and who approves reopening a closed year?
- Why it matters: One person can prepare, adjust, approve and pay; an admin can create their own second approver.
- Code today: apps/api/src/modules/payroll.ts:67-72, 150, 202, 216, 417-450; apps/api/src/modules/accounting.ts:233-244; apps/api/src/modules/admin.ts:252-265.
- RC: RC-035, RC-034, RC-039.
- Effect on the fix: Names the approver role and configures the checks.
- When needed: Week 1.
OW-05. Foreign currency and imports: in or out of the first release? (D-10)
- Ask: How many foreign bills a month? Keep multi-currency in v1 or declare it out of scope?
- Why it matters: Foreign-currency documents keep only the rupee figure today.
- Code today: apps/api/src/db/schema.ts:138-139, 829-830, 863-864; apps/api/src/modules/payments.ts:76-78.
- RC: RC-009, RC-106.
- Effect on the fix: 8.5 days if kept, nothing but a switch-off if not.
- When needed: Before Wave 2 (before real rows exist).
OW-06. Who can see all leads? (D-11)
- Ask: Do salespeople see only their own and unowned leads?
- Why it matters: Any salesperson can read the full lead list in pages of 5,000.
- Code today: apps/api/src/modules/leads.ts:339-379; apps/api/src/lib/http.ts:168-173.
- RC: RC-041, RC-042.
- Effect on the fix: Row-level scoping by role.
- When needed: Before Wave 2.
OW-07. How long to keep personal data? (D-12)
- Ask: N months for lost leads and for rejected applicants; confirm 90 days for stored webhook payloads and 30 days for held attachments.
- Why it matters: Nothing is ever deleted today.
- Code today: apps/api/src/core/jobs.ts:46-49 (housekeeping clears only save keys and the error log).
- RC: RC-011, RC-032.
- Effect on the fix: Sets the periods in the retention jobs (with DP-09, CA-40, LB-15).
- When needed: Before Wave 2.
OW-08. Build or buy the payroll tax and statutory layer? (D-13)
- Ask: Build in RadCore or buy a payroll product for tax, PF, ESIC and professional tax.
- Why it matters: Building salary tax alone is 15 to 20 days plus yearly upkeep (reviewer's estimate).
- Code today: packages/shared/src/payroll.ts:21-23, 50-60.
- RC: RC-169, RC-104, RC-102.
- Effect on the fix: Decides how much of those items is built.
- When needed: Before Wave 2.
OW-09. Payroll and leave policy. (D-14)
- Ask: Weekly-off pay rule, holiday calendar, leave types, carry-forward, encashment, what happens to advances at exit.
- Why it matters: Sundays are paid even if absent all week; a leaver gets a full year.
- Code today: apps/api/src/modules/payroll.ts:106-110, 117; hr-self.ts:82-101; hr.ts:877-898.
- RC: RC-101, RC-179, RC-180, RC-103.
- Effect on the fix: Sets company settings after LB-08 to LB-14.
- When needed: Before Wave 2.
OW-10. Do you track batches (lot numbers)? (D-15)
- Ask: Not at all, traceability only, or full costing by batch?
- Why it matters: Today a batch is a label: stock going out names no batch, and different suppliers' batch numbers are merged.
- Code today: apps/api/src/modules/sales.ts:446-455; apps/api/src/modules/purchasing.ts:217-239; apps/api/src/core/units.ts:200-213.
- RC: RC-028.
- Effect on the fix: Traceability-only is about 3.5 days.
- When needed: Week 1 (a Wave 1 data-shape item).
OW-11. Cut-over date and the parallel month. (D-16)
- Ask: The switch date, how long the parallel month runs, who signs the daily reconciliation, and whether unpaid invoices come in one by one.
- Why it matters: The current compare screen is a three-list snapshot, not a reconciliation.
- Code today: apps/api/src/modules/opening.ts:391-458; apps/web/app/(app)/admin/opening/page.tsx:136-183.
- RC: RC-120, RC-121, RC-038, RC-119.
- Effect on the fix: Builds the daily and monthly reconciliation grid with sign-off; get the real Vyapar exports now (RC-119).
- When needed: Before Wave 2 (date with CA-26).
OW-12. Outside services that send data out of India. (D-17)
- Ask: Accept or replace each one: captcha, statements mailbox, alert channel, error tracker.
- Why it matters: "Data stays in India" must have one true answer.
- Code today: apps/api/src/config.ts:116-117; .env.production.example:60, 76-80; apps/api/src/core/alerts.ts:30.
- RC: RC-018, RC-083, RC-158, RC-007.
- Effect on the fix: Builds the residency register; swaps services as chosen.
- When needed: Before Wave 2 (counsel: DP-11).
OW-13. Who is called at night, and how much loss is acceptable? (D-18)
- Ask: Two named on-call people, the acceptable data loss and downtime, one database zone or two.
- Why it matters: The health check says "ok" without touching the database and no alert reaches anyone outside the server.
- Code today: apps/api/src/app.ts:148-150; apps/api/src/modules/health.ts:30; apps/api/src/core/alerts.ts:27-29; no runbook.
- RC: RC-083, RC-050, RC-016.
- Effect on the fix: Sets alert routing and recovery targets.
- When needed: Before Wave 2.
OW-14. Who must use a second sign-in factor? (D-19)
- Ask: Owner and admin only, plus accounts and HR, or everyone.
- Why it matters: The sign-in is a password and nothing else.
- Code today: apps/api/src/core/auth.ts:34-50; apps/api/src/db/schema.ts:58-67.
- RC: RC-055, RC-089.
- Effect on the fix: About 5 days of work for the roles chosen.
- When needed: Before Wave 2.
OW-15. Who sees salaries and bank account numbers, and above what amount does the owner approve? (D-20)
- Ask: Split totals from per-person salary and account number; masking; thresholds for payslip adjustments, salary advances and purchase orders.
- Why it matters: Everyone with payroll read sees every salary and full account number; no threshold exists.
- Code today: packages/shared/src/constants.ts:369-373; apps/api/src/modules/payroll.ts:258-265; apps/api/src/modules/hr.ts:790-818.
- RC: RC-043, RC-035, RC-037.
- Effect on the fix: Splits the permission, masks numbers, adds the approval step at your amounts.
- When needed: Before Wave 2.
OW-16. Small business rules. (D-21)
- Ask: The tolerance of a supplier bill over its order (the fix branch uses 2 percent); payslip link life (branch default 7 days); what to do with a Shopify edit after confirmation; cash warning limits (after CA-24).
- Why it matters: The software needs a number or a choice and will use a default silently.
- Code today: apps/api/src/modules/purchasing.ts:325-339 (mismatch only recorded); apps/api/src/modules/crm.ts:479-487 (later Shopify messages dropped).
- RC: RC-056, RC-049, RC-085, RC-032, RC-114.
- Effect on the fix: Sets the settings.
- When needed: Before Wave 2.
OW-17. Rules for the counter when offline. (D-22)
- Ask: Provisional bill or reserved number blocks; offline vehicle sales or accessories only; oversell buffer; which phones and tablets; connect the business WhatsApp number; till PIN rules.
- Why it matters: The app has no offline behaviour at all.
- Code today: apps/web/public/sw.js:1-5; apps/web/lib/api.ts:92.
- RC: RC-149, RC-185, RC-190.
- Effect on the fix: Starts the offline build in Wave 3 (with CA-42).
- When needed: Before Wave 3.
# How the answers come back into the work
- The owner collects the answers into this file (or a copy), one line per number: the answer, who gave it, the date, and the source (section or notification).
- The developer reads the "Effect on the fix" line against each answer and updates the RC item. Answers that contradict a reviewer's reading are recorded as "reviewer's reading corrected" in the register note.
- Anything the adviser cannot answer stays in the tracker (08-Handover-Call-Pack.md, section h) with the named missing input.
- Where an answer creates new work with no RC id (for example CA-31, franchisee stock), the developer opens a new register item.
Counts. Group A (chartered accountant): 45. Group B (counsel): 17. Group C (labour and payroll adviser): 15. Group D (owner): 17. Total 94.