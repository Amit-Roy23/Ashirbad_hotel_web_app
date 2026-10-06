import { formatINR, formatDate, formatDateTime } from '@/lib/hotel-utils'
import { BanquetBill } from '@/types/banquet'

export function triggerPrintBanquetInvoice(bill: BanquetBill | any, settings: Record<string, string> = {}) {
  if (!bill) return

  const hotelName = settings.hotelName || 'Ashirbad Lodge & Banquets'
  const hotelAddress = settings.hotelAddress || 'Station Road, Kolkata'
  const hotelPhone = settings.hotelPhone || '+91 90000 00000'
  const hotelGstin = settings.hotelGstin || ''

  const paidAfterAdvance = (bill.payCash || 0) + (bill.payUpi || 0) + (bill.payCard || 0) + (bill.payBank || 0)
  const totalPaid = (bill.advanceApplied || 0) + paidAfterAdvance
  const balance = Math.max(0, Math.round(((bill.grandTotal || 0) - totalPaid) * 100) / 100)

  const paymentModes: string[] = []
  if (bill.advanceApplied > 0) paymentModes.push(`Advance: ${formatINR(bill.advanceApplied)}`)
  if (bill.payCash > 0) paymentModes.push(`Cash: ${formatINR(bill.payCash)}`)
  if (bill.payUpi > 0) paymentModes.push(`UPI: ${formatINR(bill.payUpi)}`)
  if (bill.payCard > 0) paymentModes.push(`Card: ${formatINR(bill.payCard)}`)
  if (bill.payBank > 0) paymentModes.push(`Bank: ${formatINR(bill.payBank)}`)

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Banquet Invoice ${bill.billNumber} - ${hotelName}</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 10mm;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #111827;
      background: #ffffff;
      padding: 10mm;
      font-size: 13px;
      line-height: 1.5;
    }
    .invoice-card {
      max-width: 720px;
      margin: 0 auto;
      border: 1.5px solid #065f46;
      border-radius: 10px;
      padding: 24px;
      background: #ffffff;
    }
    .header-banner {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid #065f46;
      padding-bottom: 14px;
      margin-bottom: 16px;
    }
    .hotel-name { font-size: 24px; font-weight: 800; color: #065f46; margin-bottom: 2px; }
    .hotel-sub { font-size: 12px; color: #4b5563; margin-bottom: 2px; }
    .invoice-title {
      text-align: right;
    }
    .invoice-badge {
      display: inline-block;
      padding: 4px 12px;
      font-size: 13px;
      font-weight: 800;
      border-radius: 6px;
      background: #065f46;
      color: #ffffff;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 4px;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      margin-bottom: 16px;
      background: #f9fafb;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      padding: 14px;
      font-size: 12px;
    }
    .meta-row { margin-bottom: 4px; color: #4b5563; }
    .meta-row span.val { color: #111827; font-weight: 600; }
    .table-section {
      width: 100%;
      border-collapse: collapse;
      margin-top: 14px;
      margin-bottom: 16px;
    }
    .table-section th {
      background: #065f46;
      color: #ffffff;
      text-align: left;
      padding: 8px 10px;
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
    }
    .table-section td {
      padding: 8px 10px;
      border-bottom: 1px solid #e5e7eb;
      font-size: 12px;
    }
    .table-section tr:nth-child(even) {
      background: #f9fafb;
    }
    .text-right { text-align: right; }
    .totals-area {
      display: flex;
      justify-content: flex-end;
      margin-top: 12px;
    }
    .totals-box {
      width: 320px;
      font-size: 12px;
    }
    .tot-row {
      display: flex;
      justify-content: space-between;
      padding: 4px 0;
      color: #374151;
    }
    .tot-row.grand {
      font-size: 15px;
      font-weight: 800;
      color: #065f46;
      border-top: 2px solid #065f46;
      padding-top: 8px;
      margin-top: 4px;
    }
    .tot-row.balance {
      font-size: 13px;
      font-weight: 700;
      color: ${balance > 0.01 ? '#dc2626' : '#059669'};
      border-top: 1px dashed #9ca3af;
      padding-top: 6px;
      margin-top: 4px;
    }
    .terms-box {
      margin-top: 18px;
      padding: 10px;
      background: #f9fafb;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      font-size: 10px;
      color: #6b7280;
    }
    .signatures {
      display: flex;
      justify-content: space-between;
      margin-top: 36px;
      padding-top: 12px;
    }
    .sig-line {
      width: 180px;
      border-top: 1px solid #9ca3af;
      text-align: center;
      font-size: 11px;
      font-weight: 600;
      color: #374151;
      padding-top: 4px;
    }
    @media print {
      body { padding: 0; }
      .invoice-card { border: none; padding: 0; }
    }
  </style>
</head>
<body>
  <div class="invoice-card">
    <div class="header-banner">
      <div>
        <div class="hotel-name">${hotelName}</div>
        <div class="hotel-sub">Premium Banquets, Luxury Events &amp; Conventions</div>
        <div class="hotel-sub">${hotelAddress}</div>
        <div class="hotel-sub">Phone: ${hotelPhone} ${hotelGstin ? ` · GSTIN: <b>${hotelGstin}</b>` : ''}</div>
      </div>
      <div class="invoice-title">
        <div class="invoice-badge">BANQUET TAX INVOICE</div>
        <div style="font-size: 14px; font-weight: 800; color: #111827;">${bill.billNumber}</div>
        <div style="font-size: 11px; color: #6b7280;">Date: ${formatDateTime(bill.createdAt || bill.eventDate)}</div>
      </div>
    </div>

    <div class="meta-grid">
      <div>
        <div style="font-weight: 700; color: #065f46; margin-bottom: 6px; text-transform: uppercase;">Customer &amp; Host Details</div>
        <div class="meta-row">Client / Host: <span class="val">${bill.customerName}</span></div>
        <div class="meta-row">Contact: <span class="val">${bill.customerPhone}</span></div>
        ${bill.companyName ? `<div class="meta-row">Company / Org: <span class="val">${bill.companyName}</span></div>` : ''}
        ${bill.gstNumber ? `<div class="meta-row">Client GSTIN: <span class="val">${bill.gstNumber}</span></div>` : ''}
        ${bill.customerAddress ? `<div class="meta-row">Address: <span class="val">${bill.customerAddress}</span></div>` : ''}
      </div>
      <div>
        <div style="font-weight: 700; color: #065f46; margin-bottom: 6px; text-transform: uppercase;">Function &amp; Venue Details</div>
        <div class="meta-row">Event / Occasion: <span class="val">${bill.eventName}</span></div>
        <div class="meta-row">Banquet Venue: <span class="val">${bill.hallName}</span></div>
        <div class="meta-row">Event Date: <span class="val">${formatDate(bill.eventDate)}</span></div>
        <div class="meta-row">Time Slot: <span class="val">${bill.slot}</span></div>
        <div class="meta-row">Expected Gathering: <span class="val">${bill.guestCount} Guests</span></div>
      </div>
    </div>

    <table class="table-section">
      <thead>
        <tr>
          <th>Description</th>
          <th style="text-align: center;">Details</th>
          <th class="text-right">Amount</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><b>Venue / Hall Rental</b> (${bill.hallName})</td>
          <td style="text-align: center;">${bill.slot} slot</td>
          <td class="text-right">${formatINR(bill.hallRent)}</td>
        </tr>
        ${
          bill.foodCharges > 0
            ? `<tr>
          <td><b>Catering &amp; Dining Services</b></td>
          <td style="text-align: center;">${bill.guestCount} Guests</td>
          <td class="text-right">${formatINR(bill.foodCharges)}</td>
        </tr>`
            : ''
        }
        ${
          bill.decorCharges > 0
            ? `<tr>
          <td><b>Stage &amp; Theme Decoration</b></td>
          <td style="text-align: center;">Theme Setup</td>
          <td class="text-right">${formatINR(bill.decorCharges)}</td>
        </tr>`
            : ''
        }
        ${
          bill.soundAvCharges > 0
            ? `<tr>
          <td><b>DJ, Sound System &amp; Audio-Visuals</b></td>
          <td style="text-align: center;">Standard AV</td>
          <td class="text-right">${formatINR(bill.soundAvCharges)}</td>
        </tr>`
            : ''
        }
        ${
          bill.extraCharges > 0
            ? `<tr>
          <td><b>Extra Services / Amenities</b></td>
          <td style="text-align: center;">Add-ons</td>
          <td class="text-right">${formatINR(bill.extraCharges)}</td>
        </tr>`
            : ''
        }
        ${
          bill.discount > 0
            ? `<tr>
          <td style="color: #059669;"><b>Special Event Discount</b></td>
          <td style="text-align: center; color: #059669;">Promotional</td>
          <td class="text-right" style="color: #059669;">-${formatINR(bill.discount)}</td>
        </tr>`
            : ''
        }
      </tbody>
    </table>

    <div class="totals-area">
      <div class="totals-box">
        <div class="tot-row">
          <span>Taxable Subtotal:</span>
          <b>${formatINR(bill.taxableAmount)}</b>
        </div>
        ${
          bill.gstPercent > 0
            ? `<div class="tot-row">
          <span>GST (${bill.gstPercent}%):</span>
          <b>${formatINR(bill.gstAmount)}</b>
        </div>`
            : ''
        }
        <div class="tot-row grand">
          <span>Grand Total:</span>
          <span>${formatINR(bill.grandTotal)}</span>
        </div>
        ${
          bill.advanceApplied > 0
            ? `<div class="tot-row">
          <span>Advance Paid:</span>
          <span style="color: #059669; font-weight: 600;">-${formatINR(bill.advanceApplied)}</span>
        </div>`
            : ''
        }
        <div class="tot-row">
          <span>Settled at Completion:</span>
          <b>${formatINR(paidAfterAdvance)}</b>
        </div>
        <div class="tot-row balance">
          <span>${balance <= 0.01 ? 'Status:' : 'Balance Due:'}</span>
          <span>${balance <= 0.01 ? 'PAID IN FULL' : formatINR(balance)}</span>
        </div>
        ${paymentModes.length > 0 ? `<div style="font-size: 10px; color: #6b7280; margin-top: 4px; text-align: right;">Paid via: ${paymentModes.join(' · ')}</div>` : ''}
      </div>
    </div>

    <div class="terms-box">
      <b>Terms &amp; Conditions:</b><br/>
      ${(bill.terms || '1. 100% payment required upon conclusion of the event.\n2. Incase of any property or sound equipment damage, assessment charges will apply.\n3. Outside catering and liquor permitted only with prior approval.').replace(/\n/g, '<br/>')}
    </div>

    <div class="signatures">
      <div class="sig-line">Guest / Host Signature</div>
      <div class="sig-line">Authorized Signatory / Manager</div>
    </div>
  </div>

  <script>
    window.onload = function() {
      setTimeout(function() {
        window.print();
      }, 300);
    };
  </script>
</body>
</html>
`

  const w = window.open('', '_blank', 'width=840,height=960')
  if (w) {
    w.document.open()
    w.document.write(html)
    w.document.close()
  }
}
