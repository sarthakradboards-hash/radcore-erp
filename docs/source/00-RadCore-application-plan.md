=== page 1
RadCore application plan
Nov 4, 2026  ·  @Sarthak
RadCore is Radboards' own business system: one app where leads, sales, purchasing,
stock, the workshop, accounts and GST, and staff and payroll all live together, so nothing is
typed twice. It replaces Vyapar for accounts and is built to match Privyr for leads and
Attendo for attendance.
What RadCore is for
RadCore runs Radboards' whole working day in one place: every enquiry, sale, purchase,
stock move, repair, rupee and salary is recorded once and flows on to the next step by
itself.
The business it runs
Radboards Pvt Ltd buys raw materials and parts (some imported), holds finished goods
(vehicles, sub-assemblies, spare parts, accessories), and sells them four ways: to dealers
and franchisees on credit, to walk-in customers at its own store, through its Shopify site,
and through Amazon and Flipkart. It also services vehicles after sale, under warranty or
for a charge.
What it replaces
Today Used for In RadCore
Vyapar (one
desktop)
Invoices, purchases, expenses,
parties, stock, GST
Accounts, GST and purchasing in
the browser, for every role that
needs them
Privyr Leads and follow-ups CRM: leads from Meta, Google,
WhatsApp, the website and walk-
ins, with follow-ups and quick
replies
WhatsApp
messages
Passing a converted walk-in to
accounts
Gone: the lead becomes a
customer in one click and the bill
is made in the same step
RadCore application plan
Page 1 of 17

=== page 2
What it must achieve
The PRD's success measures:
Every store walk-in recorded as a lead, whether or not they buy.
Nothing retyped from lead to invoice: no customer or invoice created from a
WhatsApp message.
A walk-in purchase to a printed or shared GST invoice in under 2 minutes.
One stock number per item, the same for store, dealer and online sales.
Vyapar retired: every invoice, bill, expense and payment from cut-over is in RadCore,
and month-end GST comes out of it.
The founder sees sales, marketing and accounts dashboards without asking anyone.
Rules that never bend
One record per real thing: one lead becomes one customer; one item has one stock
ledger.
A sale from any channel writes its invoice, stock movement and accounting entries
together, or not at all.
An issued invoice cannot be changed; mistakes are corrected with a credit note or a
cancellation with a reason.
Document numbers have no gaps, and every change is recorded with who made it and
when.
Today Used for In RadCore
Shopify's own
stock count
Online orders Orders come into RadCore; there
is one stock number for all
channels
Excel Task lists and maintenance
reminders
Operations: routines, tasks,
projects, assets and maintenance
Attendo / HRMS
app
Attendance HR: hiring, employees,
attendance, leave and payroll
ServiceFlow Repairs Service: job cards, warranty and
supplier claims (added by the
founder's brief of 21 October)
RadCore application plan
Page 2 of 17

=== page 3
At a glance
Selling, buying and the workshop each run top to bottom. The one stock ledger feeds
deliveries and fitted parts, and every money step, payroll included, lands in the same
books that GST returns and the dashboards are read from.
How the sections connect · selling, buying, workshop and pay into one set of books
RadCore application plan
Page 3 of 17

=== page 4
Who uses it
RadCore has 11 roles, and each person signs in with one of them. A role decides which
menus a person sees and what the server lets them do; the admin can change the table on
the Permissions screen.
Role Who it is What they do in
RadCore
What they cannot do
Owner The founder Sees every dashboard
and the owner's
summary; reads sales,
stock, purchasing,
accounts, GST, HR,
operations and service;
approves price lists,
stock adjustments,
purchase orders,
discounts and credit
overrides; reopens a
closed year with a
second person
Create day-to-day
documents such as bills
or payments; manage
users
Admin Whoever sets up the
system
Masters (products,
customers, dealers,
suppliers, employees),
price lists, users and
roles, permissions,
settings, the audit trail;
holds every permission
Nothing is closed to the
admin, which is why the
review asks for a
second person on risky
steps
Marketing The marketing team Lead sources, campaign
links and QR codes, ad
spend and cost per lead,
the marketing
dashboard; reads and
edits leads
Sales orders, invoices,
accounts
RadCore application plan
Page 4 of 17

=== page 5
Role Who it is What they do in
RadCore
What they cannot do
Store Counter staff at the
store
Walk-ins on the tablet,
the quick bill, repeat-
customer lookup,
sharing invoices on
WhatsApp
See costs, purchasing
or the books
Sales The sales team
(walk-in customers
and dealers)
Pipeline and follow-ups,
quick replies, test rides,
quotes and dealer
orders, bookings with an
advance, the sales
dashboard
See costs or payments;
download lists with
phone numbers
Stores Whoever receives
and issues goods
Purchase orders, inward
and QC, stock transfers,
counts and adjustments,
units by serial number,
imports, job work, the
stores dashboard
Approve their own
stock adjustments; post
bills or payments; see
leads
Accounts Whoever runs the
books
Purchase bills, payments
in and out, expenses,
credit notes and
cancellations, the books
and reports, bank
reconciliation, GST and
marking returns filed,
the Vyapar import,
payroll, credit overrides
Approve stock
adjustments; manage
users
HR Whoever runs
people matters
Openings, applicants
and interviews,
employees, attendance
and leave, preparing
payroll, the HR
dashboard
See sales, stock or the
books; approve their
own pay
RadCore application plan
Page 5 of 17

=== page 6
Every person, whatever their role, also has My work: their own tasks, clock-in and clock-
out, leave requests and payslips.
How many users and how much work
RadCore is planned for 20 to 50 people signing in and about 300 documents a day at go-
live, with room to grow ten times on the same design. These are the planning figures used
by the technical review for hosting and cost; the actual names and number of people per
role are still to be listed.
Role Who it is What they do in
RadCore
What they cannot do
Operations Whoever runs the
floor and machines
Projects, tasks, routines
with checklists, assets
and maintenance,
resource allocation, job
work
Sales, accounts, payroll
Technician Workshop staff Job cards: taking a
vehicle in by serial,
diagnosis, fitting parts,
photos
See costs or customers'
contact details;
approve estimates
Service
manager
Head of the
workshop
Everything a technician
does, plus approving
estimates, supplier
warranty claims and the
service reports
Accounts beyond the
service bill
Stage People signing
in
Documents a
day
What changes in hosting
At go-live 20 to 50 about 300 One small server and a managed
database (about Rs 9,627 a month with
GST)
Growth
(3x)
60 to 150 about 900 A bigger server and a database in two
zones (about Rs 21,000 a month before
GST)
RadCore application plan
Page 6 of 17

=== page 7
What the plan assumes about the company:
One legal entity, in one state, filing GSTR-1 and GSTR-3B monthly, with fewer than 100
staff.
One store, a stores warehouse, a rejected-goods area, a service bay, demo units,
franchisee stock and goods in transit, all as locations on one stock ledger.
About 40 MB of attachments a day (bill photos, delivery photos, resumes, bank
statements), about 14.6 GB a year.
Speed targets from the PRD: any list opens in under 1 second with 50,000 rows, and a
quick bill saves in under 2 seconds.
Open: the number of people in each role (owner, store, sales, stores, accounts, HR,
operations, technicians), which sets the per-role limits and who needs a second sign-in
factor.
What it does
RadCore has ten sections, each a menu group, plus dashboards on top and links to
outside services. All of it is built and tested on sample data; the links to outside services
are built but not yet connected to Radboards' real accounts.
Stage People signing
in
Documents a
day
What changes in hosting
Scale (10x) 200 to 500 about 3,000 The app moved to containers, same
database (about Rs 42,000 a month
before GST)
Section What it does Main users
Store Walk-in form on the tablet (phone first, then
name, product, outcome); repeat-customer
lookup; the quick bill, which makes the
customer, order, invoice, stock movement,
payment and accounting entry in one step;
split payments; A4 and thermal invoices;
share on WhatsApp
Store, sales
RadCore application plan
Page 7 of 17

=== page 8
Section What it does Main users
CRM Leads from every source in one list, with an
owner and a follow-up date; the pipeline
(New, Contacted, Interested, Meeting
booked, Converted, Lost with a reason);
quick replies that open WhatsApp; follow-
up plans; campaign links and QR codes; lead
sources; ad spend and cost per lead; test
rides on demo vehicles
Marketing, sales, store
Sales Quotes and orders for dealers and
franchisees at their price list and credit
terms; credit-limit and overdue checks with
an override; vehicle bookings with an
advance and a delivery checklist; part
deliveries; invoices, credit notes and
cancellations; online orders from Shopify,
Amazon and Flipkart; customers and
dealers
Sales, accounts
Stores Purchase orders (approval above a set
amount); inward with QC that splits
accepted and rejected; returns to supplier
with a debit note; stock by location;
transfers, physical counts and adjustments
with approval; units by serial number;
imports with landed cost (duty, freight,
IGST at customs); job work sent out and
received back; products
Stores, accounts
Accounts Purchase bills; payments in and out with
allocation to bills; reminders of what to
collect; advances to suppliers; expenses
with input GST and the bill attached; the
journal and chart of accounts; cash and
bank transfers; bank reconciliation,
including statements read from email; TDS;
books and reports (day book, ledgers,
ageing, trial balance, profit and loss, balance
sheet, stock valuation); year-end close
Accounts, owner
RadCore application plan
Page 8 of 17

=== page 9
Every list and report downloads as Excel or CSV.
Section What it does Main users
GST GSTR-1 and GSTR-3B from the same
records, a file for the GST portal, marking a
month filed so it locks
Accounts
Service Job cards by serial number; warranty
worked out from the sale date; fault codes
and photos; an estimate the customer
approves from a link; parts fitted from the
service bay; the bill for chargeable work;
supplier warranty claims; reports on
failures, comebacks and turnaround
Technicians, service
manager
HR Openings, applicants and interview rounds,
hiring (creates the employee); employees;
attendance register and import; leave;
payroll with PF, ESIC, professional tax,
advances and payslips
HR, accounts
Operations Projects with tasks and a timeline; routines
with checklists that create each person's
tasks; one-off tasks; resource allocation;
assets with maintenance schedules
Operations
Admin Masters (one place for products,
customers, dealers, suppliers and
employees, downloadable as one
workbook); setup and company profile;
moving from Vyapar; users; permissions;
the audit trail
Admin
Dashboards Sales, marketing, accounts, stores, HR and
operations dashboards, the owner's one-
page summary, and a home screen that
shows how many items are waiting at each
step
Each role sees its own
Outside
services
Meta lead ads, Google Ads lead forms,
WhatsApp messages, website forms,
Shopify orders, Amazon and Flipkart order
reports, bank statements by email
Received automatically
RadCore application plan
Page 9 of 17

=== page 10
Not in the app yet: e-invoice and e-way bill, sending stock back to Shopify, invoice PDFs
made by the server, offline billing, phone push alerts, and AI. The technical review sizes
these separately; none is built without a yes.
Operations: critical, routine and minor
An operation is critical when it moves money, tax, stock value or pay, or cannot be undone;
those are all-or-nothing, guarded against double clicks, recorded in the audit trail, and
some need a second person. Routine operations happen many times a day and are easy to
correct. Minor operations are set-up, lookups and reports.
Critical
Operation Who Why it is critical How RadCore guards it
Quick bill or issuing
an invoice
Store, sales,
accounts
Gives a legal invoice
number, takes stock
out, books the sale
and the tax
One transaction; gap-
free numbers; the
invoice cannot be
edited once issued
Taking a payment and
setting it against bills
Accounts, store Decides what each
customer still owes
Allocations are
checked against what
is open; payment
status is worked out,
never typed
Paying a supplier,
staff or an expense
Accounts Money leaves the
bank
Accounts only;
recorded with who and
when
Purchase bill or
expense with GST
Accounts Claims input tax
credit in the GST
return
Locked once that
month's GSTR-3B is
marked filed
Inward and QC Stores Puts stock in at its
cost; rejects must go
back
Only accepted
quantity enters stock;
rejects held apart and
returned with a debit
note
RadCore application plan
Page 10 of 17

=== page 11
Operation Who Why it is critical How RadCore guards it
Stock count or
adjustment
Stores, then
owner or admin
Changes stock value
and cost
Nothing changes until
the owner or admin
approves
Credit note or
cancelling an invoice
Accounts Reverses tax and
stock
Accounts only, with a
reason; an invoice with
a credit note cannot be
cancelled
Credit-limit override
or discount approval
Owner, accounts Lets a dealer owe
more, or sells below
the allowed price
Only these roles;
recorded
Dealer delivery and
vehicle hand-over
Stores, sales Stock leaves; a
vehicle needs
inspection, rider
briefing and warranty
registration
A vehicle is not handed
over without its
delivery checklist
Fitting a part and
handing back a
repaired vehicle
Technician,
service manager
Stock goes on the
vehicle; chargeable
work becomes a bill
Warranty parts go to
warranty expense; the
bill goes through the
normal invoice step
Applying import
costs
Accounts Raises the cost of
goods already in
stock or sold
Previewed line by line
before it is posted
Bank statement
import and matching
Accounts Decides which
receipts and
payments really
cleared
Rows already imported
are skipped; only
unambiguous lines
match automatically
GST month marked
filed, or undone
Accounts; owner
or admin to undo
Locks the month's
sales and purchases
Undoing needs the
owner or admin
Payroll approval and
payment
HR, accounts Salaries and
statutory deductions
Nobody can prepare or
approve their own pay
Period lock, year-end
close, reopening a
year
Accounts,
owner, admin
Freezes the books Years close in order;
reopening needs two
people
RadCore application plan
Page 11 of 17

=== page 12
Routine
Operation Who Why it is critical How RadCore guards it
Bringing balances in
from Vyapar
Accounts, admin Sets every opening
figure
A dry run first; the
whole file is refused if
any line has a problem
Users, roles and
permissions
Admin Decides who can do
all of the above
Admin only; every
change is in the audit
trail
Backups and restore Developer Losing the data loses
the books
Daily encrypted
backups and a monthly
restore drill (to be
hardened before real
data)
Operation Who How often
Recording a walk-in Store Every visitor
Following up a lead, moving its stage, sending a
quick reply
Sales, store Many times a
day
Booking a test ride Sales Daily
Making a quote or dealer order Sales Daily
Raising a purchase order Stores Weekly
Transferring stock between locations Stores Daily
Taking a vehicle into the workshop and
diagnosing it
Technician Daily
Marking attendance, clocking in and out, asking
for leave
HR, everyone Daily
Working through tasks and routine checklists Everyone,
operations
Daily
Logging asset maintenance Operations When due
RadCore application plan
Page 12 of 17

=== page 13
Minor
Adding or editing products, customers, suppliers and employees in Masters, and
drafting price lists (approval needed before use).
Setting up lead sources, campaign links, quick-reply templates, follow-up plans and
ad-spend entries.
Warranty rules and fault codes for the workshop; openings and the hiring board.
Reading dashboards and reports, and downloading lists as Excel or CSV.
Company profile and other settings.
The user flows
Each flow below is one job from start to finish, with who does each step. Whatever one
step records, the next step reads: nothing is typed twice.
1. A walk-in buys at the counter (store)
1. The customer walks in; the store staff types the phone number on the tablet.
2. If the number is known, the name and past purchases appear; otherwise the staff
adds a name.
3. The staff picks the product and the outcome. "Just enquiring" saves a lead with an
owner and a follow-up date, and the flow ends there.
4. "Buying now" opens the quick bill with the customer already filled in.
5. Items are added at the retail price (tax included); the customer pays by cash, UPI or
card, or splits it; anything unpaid stays on credit.
6. Save: one step gives the invoice its number, takes the stock out of the showroom,
books the sale and the tax, and records the payment.
7. The invoice is printed on the thermal printer or shared on WhatsApp.
2. A lead becomes a sale (marketing, sales)
1. An enquiry arrives from a Meta or Google ad, a WhatsApp message, the website or a
campaign QR code, or is added by hand.
2. RadCore checks the phone number: a repeat enquiry joins the existing lead; a new
one gets an owner and a first follow-up date.
3. The salesperson sees it under "Leads waiting for me" and sends a quick reply, which
opens WhatsApp and moves the lead from New to Contacted.
RadCore application plan
Page 13 of 17

=== page 14
4. The lead moves through Interested and Meeting booked as it progresses; for a vehicle,
a test ride is booked on a demo unit and its outcome recorded.
5. A quote is sent. When the customer commits, a booking advance confirms the order
and holds the vehicle by serial number.
6. On delivery, the checklist is completed (inspection, rider briefing, warranty
registered, photo, signed note); the invoice is made and the advance is set against it.
7. A lead that goes nowhere is marked Lost with a reason, and can be reopened if they
return.
3. A dealer order (sales, stores, accounts)
1. Sales makes a quote at the dealer price list and the dealer's terms.
2. Confirming the order checks the dealer's credit limit and overdue bills; accounts or
the owner can override, and the override is recorded.
3. Stores delivers from the warehouse, all at once or in parts, with a delivery challan.
4. Each delivery is invoiced, with IGST for a dealer in another state.
5. Accounts records the dealer's payment and sets it against one or more invoices;
anything extra stays as an advance.
6. Unpaid invoices show on the ageing report and the "To collect" list.
4. An online order (sales, stores)
1. A Shopify order arrives by itself; Amazon and Flipkart orders arrive when their order
report is uploaded.
2. Each becomes a confirmed order, with items matched by product code.
3. Stores packs and delivers it; it is invoiced, and the stock comes off the same single
stock number.
5. Buying goods (stores, accounts)
1. Stores raises a purchase order; above a set amount, the owner approves it.
2. The supplier's bill is recorded by accounts against the order.
3. Goods arrive and are counted at stores; they are not in stock yet.
4. QC splits each line: accepted goods enter stock at the order's rate; rejected goods go
to the Rejected area and cannot be sold.
5. One action returns the rejects and raises a debit note against the bill.
6. Accounts pays the supplier and sets the payment against the bill.
RadCore application plan
Page 14 of 17

=== page 15
6. Importing goods (stores, accounts)
1. An import shipment carries one or more purchase orders through its stages, from
proforma to received.
2. Costs are entered as they come: customs duty, freight and the forwarder's bill; IGST
paid at customs is claimed as input credit.
3. The costs are spread over the goods by value, quantity or weight, previewed line by
line, then posted: stock still on hand costs more, and the share already sold goes to
cost of goods sold.
7. Keeping stock right (stores, owner)
1. Stock moves between locations by transfer, with a reason.
2. A physical count is typed in; RadCore works out the difference.
3. Counts and adjustments change nothing until the owner or admin approves them.
8. A vehicle in the workshop (technician, service manager, accounts)
1. The vehicle is taken in by its serial number; its warranty is worked out from the sale
date, for the vehicle and each part inside it.
2. The technician records the complaint, photos and fault codes, and the diagnosis.
3. An estimate is sent; the customer approves it from a link.
4. Parts are fitted from the service bay: warranty parts are booked as warranty expense,
others as cost.
5. At hand-back, the chargeable work becomes a bill through the normal invoice step,
including the credit check.
6. A failed part under the supplier's warranty becomes a claim, which ends when the
supplier's credit is recorded.
9. A month in accounts (accounts, owner)
1. Every day: receipts, payments and expenses are recorded, and the bank statement
(uploaded or read from email) is matched to them.
2. At month end: GSTR-1 and GSTR-3B are produced from the same records, checked,
and the portal file is downloaded.
3. Once filed on the portal, the month is marked filed in RadCore, which locks its sales
and purchases.
RadCore application plan
Page 15 of 17

=== page 16
4. The period lock stops any change to closed months; on 31 March the year is closed,
moving its profit to retained earnings.
10. A payroll month (everyone, HR, accounts)
1. Staff clock in and out, or HR marks the attendance register or imports it.
2. Leave requests are approved by someone other than the person asking.
3. HR prepares the run: pay by day across any raise, unpaid leave, PF, ESIC, professional
tax and advances.
4. Someone who did not prepare it approves it, and accounts pays it.
5. Each person opens their payslip from a link that expires after 30 days.
11. Daily operations (operations, everyone)
1. Routines (daily, weekly, monthly) create each person's checklist tasks.
2. People tick off their tasks under My work; projects track progress against deadlines.
3. Machine maintenance comes due on its schedule and rolls forward when the work is
logged.
12. Moving from Vyapar, once (accounts, admin)
1. Closing balances are exported from Vyapar: parties, items with stock, and account
balances.
2. Each file is tried as a dry run; any problem refuses the whole file.
3. The balances come in as RadCore's opening balances, and the compare report shows
both systems side by side for the parallel month.
How it goes live
RadCore goes live in five steps, and Vyapar is switched off only after a full month in which
both systems agree.
1. Today: every section is built and tested on sample data. The review copy runs on
Vercel in Singapore and must hold sample data only.
2. Before any real data: the 49 Wave 1 fixes from the technical review (about 120
developer-days: backups, records that can never be changed, personal data, nobody
approving their own pay), the hosting chosen (the review recommends AWS Mumbai)
and Radboards' own web address.
RadCore application plan
Page 16 of 17

=== page 17
3. Set-up: the server in India; the real Meta, Google Ads, WhatsApp, Shopify and bank-
statement connections; the real users and their roles; Vyapar's closing balances
brought in as opening balances.
4. The parallel month: every entry is made in both Vyapar and RadCore on the same day,
and the two are compared every day: sales, tax, receipts, payments, party balances,
cash, bank and stock. Vyapar stays the record during this month.
5. Switch-off: when the month matches, RadCore becomes the only system. Vyapar is
kept read-only as a way back.
After go-live, the first three months cover the review's Wave 3 hardening and any new
features that are picked, such as e-invoice, a faster counter screen, offline billing or phone
alerts.
RadCore application plan
Page 17 of 17